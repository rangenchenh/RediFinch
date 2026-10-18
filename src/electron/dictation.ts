import { EventEmitter } from 'node:events';
import type {
  AudioLevel,
  DictationState,
  OutputMode,
  Settings,
  TranscriptSegment,
} from '@shared/types';
import { createLogger } from './logger';
import { applySpokenPunctuation, injectText, smartJoin } from './injection/injector';
import { processText } from './output/process';
import { EngineConfigError, type SttEngine } from './stt/engine';
import { resolveEngine } from './stt/factory';

const log = createLogger('dictation');

/**
 * Owns one dictation session: mic frames in, injected text out.
 *
 * Flow for a hold-to-talk press:
 *   1. `begin()` resolves an engine and starts it.
 *   2. The renderer streams 16 kHz PCM; every frame goes to `pushAudio`, which
 *      also drives the UI level meter and decides when a segment is final.
 *   3. On release, `end()` flushes the engine, applies text cleanup, joins the
 *      pieces, and injects once.
 *
 * Injection happens **once per session** rather than per segment. Injecting
 * mid-sentence would move the user's cursor while they are still speaking, and
 * a partial hypothesis being typed into their editor then rewritten is worse
 * than a short wait. Finals are still emitted to the UI as they arrive so the
 * transcript appears live.
 */
export class DictationSession extends EventEmitter {
  private state: DictationState = 'idle';
  private engine: SttEngine | null = null;
  private engineReason = '';
  private settings: Settings;
  private settingsSnapshot: Settings | null = null;

  /** Finalised text from completed segments, in order. */
  private committed: string[] = [];
  /** Latest unfinalised hypothesis, replaced as the engine revises it. */
  private interim = '';
  /** Text already delivered for the current segment run. */
  private segmentSeq = 0;
  private startedAt = 0;
  private busy = false;
  private beginTask: Promise<void> | null = null;

  constructor(settings: Settings) {
    super();
    this.settings = settings;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  /** A mode shortcut can upgrade the output mode while a chord is held. */
  selectOutputMode(mode: OutputMode): void {
    if (this.settingsSnapshot) {
      this.settingsSnapshot = {
        ...this.settingsSnapshot,
        output: { ...this.settingsSnapshot.output, mode },
      };
    }
  }

  getStatus(): { state: DictationState; engine: string; reason: string } {
    return {
      state: this.state,
      engine: this.engine?.label ?? 'none',
      reason: this.engineReason,
    };
  }

  private setState(next: DictationState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('state', next);
  }

  /** Resolve, construct and start an engine. Idempotent per session. */
  begin(): Promise<void> {
    if (this.state === 'listening') return Promise.resolve();
    if (this.beginTask) return this.beginTask;

    const task = this.startSession();
    this.beginTask = task;
    void task.finally(() => {
      if (this.beginTask === task) this.beginTask = null;
    }).catch(() => undefined);
    return task;
  }

  private async startSession(): Promise<void> {
    this.committed = [];
    this.interim = '';
    this.segmentSeq = 0;
    this.settingsSnapshot = this.settings;
    this.startedAt = Date.now();

    try {
      const { engine, reason } = await resolveEngine(this.settings);
      this.engine = engine;
      this.engineReason = reason;
      await engine.start(this.settings);
      this.setState('listening');
      log.info(`session started with ${engine.label} (${reason})`);
    } catch (err) {
      const message =
        err instanceof EngineConfigError
          ? err.message
          : `Could not start transcription: ${err instanceof Error ? err.message : String(err)}`;
      log.error('failed to start session:', err);
      this.engine = null;
      this.setState('error');
      this.emit('error', { message });
      throw err;
    }
  }

  /**
   * Feed one frame of mono 16 kHz float32 audio. Returns nothing; results are
   * emitted as `segment` events.
   */
  async pushAudio(samples: Float32Array): Promise<void> {
    if (this.state !== 'listening') return;

    this.emit('level', computeLevel(samples));

    if (!this.engine || this.busy) {
      // A previous decode is still running. Dropping frames would lose speech,
      // so queue this one behind it instead of interleaving native calls.
      this.queued.push(samples);
      return;
    }

    await this.drainEngine(samples);
    while (this.queued.length) {
      const next = this.queued.shift()!;
      await this.drainEngine(next);
    }
  }

  private queued: Float32Array[] = [];

  private async drainEngine(samples: Float32Array): Promise<void> {
    if (!this.engine) return;
    this.busy = true;
    try {
      const results = await this.engine.pushAudio(samples);
      for (const r of results) this.acceptResult(r);
    } catch (err) {
      log.error('engine pushAudio failed:', err);
      this.emit('error', {
        message: `Transcription error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.busy = false;
    }
  }

  private acceptResult(result: { text: string; final: boolean }): void {
    const text = normalise(result.text, this.settings);
    if (!text) return;

    if (result.final) {
      this.committed.push(text);
      this.interim = '';
    } else {
      this.interim = text;
    }

    this.segmentSeq++;
    const segment: TranscriptSegment = {
      id: `seg-${this.startedAt}-${this.segmentSeq}`,
      text: this.previewText(),
      final: result.final,
      startedAt: this.startedAt,
      engine: this.engine?.label ?? 'unknown',
      latencyMs: Date.now() - this.startedAt,
    };
    this.emit('segment', segment);
  }

  /** Everything known so far, joined the way the final output will be. */
  private previewText(): string {
    let out = '';
    for (const piece of this.committed) out = joinText(out, piece, this.settings);
    if (this.interim) out = joinText(out, this.interim, this.settings);
    return out;
  }

  /** Full text for the session, used by the UI's copy action. */
  getText(): string {
    return this.previewText();
  }

  /**
   * End the session, flush the engine, and inject the result.
   * Returns the final text (whether or not injection succeeded).
   */
  async end(opts: { inject?: boolean; process?: boolean } = {}): Promise<{ text: string; injected: boolean; error?: string }> {
    if (this.state !== 'listening' && this.state !== 'error') {
      return { text: this.previewText(), injected: false };
    }

    // Anything still queued belongs to the utterance the user just finished.
    while (this.queued.length) {
      const next = this.queued.shift()!;
      await this.drainEngine(next);
    }

    this.setState('processing');

    try {
      if (this.engine) {
        const flushed = await this.engine.finishUtterance();
        for (const r of flushed) this.acceptResult(r);
      }
    } catch (err) {
      log.error('engine flush failed:', err);
      this.emit('error', {
        message: `Could not finish transcribing: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const rawText = this.previewText();
    const heldMs = Date.now() - this.startedAt;

    // A tap shorter than the threshold is almost always an accidental keypress.
    if (heldMs < this.settings.hotkey.minDurationMs) {
      log.info(`ignoring ${heldMs}ms activation (below ${this.settings.hotkey.minDurationMs}ms)`);
      await this.disposeEngine();
      this.setState('idle');
      return { text: '', injected: false };
    }

    if (!rawText.trim()) {
      log.info('session produced no text');
      await this.disposeEngine();
      this.setState('idle');
      return { text: '', injected: false };
    }

    let text = rawText;
    try {
      if (opts.process !== false) {
        const output = await processText(rawText, this.settingsSnapshot ?? this.settings);
        text = output.text;
        this.emit('output', output);
      }
    } catch (err) {
      const error = `Could not process text: ${err instanceof Error ? err.message : String(err)}`;
      log.warn(error);
      this.emit('error', { message: error });
      await this.disposeEngine();
      this.setState('error');
      return { text: rawText, injected: false, error };
    }

    const wantInject = opts.inject !== false;
    if (!wantInject) {
      await this.disposeEngine();
      this.setState('idle');
      return { text, injected: false };
    }

    const result = await injectText(text, {
      method: this.settings.injection.method,
      keepInClipboard: this.settings.injection.keepInClipboard,
      restoreClipboard: this.settings.injection.restoreClipboard,
      trailingSpace: this.settings.injection.trailingSpace,
    });

    await this.disposeEngine();
    this.setState(result.ok ? 'idle' : 'error');

    if (!result.ok) {
      log.warn(`injection failed: ${result.error}`);
      this.emit('error', { message: result.error ?? 'Could not insert the text' });
    } else {
      log.info(`injected ${result.chars} chars via ${result.method}`);
    }

    return { text, injected: result.ok, error: result.error };
  }

  /** Abandon the session: drop audio, inject nothing. */
  async cancel(): Promise<void> {
    this.queued = [];
    this.committed = [];
    this.interim = '';
    this.engine?.reset();
    await this.disposeEngine();
    this.setState('idle');
    log.info('session cancelled');
  }

  private async disposeEngine(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      await engine.dispose();
    } catch (err) {
      log.warn('engine dispose failed:', err);
    }
  }

  get currentState(): DictationState {
    return this.state;
  }
}

// ------------------------------------------------------------------- helpers

/**
 * Squared-mean level with a gentle attack/decay so the meter moves like a
 * physical one instead of jittering per frame.
 */
let smoothedLevel = 0;
function computeLevel(samples: Float32Array): AudioLevel {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  // Perceptual curve: quiet speech should still move the meter.
  const scaled = Math.min(1, Math.pow(rms * 4, 0.6));
  smoothedLevel = scaled > smoothedLevel ? scaled : smoothedLevel * 0.85 + scaled * 0.15;
  return { level: smoothedLevel, speaking: smoothedLevel > 0.06 };
}

function normalise(text: string, settings: Settings): string {
  let out = text.trim();
  if (!out) return '';
  if (settings.injection.spokenPunctuation) out = applySpokenPunctuation(out);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Join two pieces with punctuation-aware spacing: no space between Chinese
 * characters, a space between Latin words, and never a space before a
 * punctuation mark.
 */
function joinText(left: string, right: string, settings: Settings): string {
  if (!left) return right;
  if (!right) return left;
  if (!settings.injection.spokenPunctuation && /\s$/.test(left)) return left + right;
  return smartJoin(left, right);
}
