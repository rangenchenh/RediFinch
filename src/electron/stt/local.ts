import fs from 'node:fs';
import os from 'node:os';
import type { Settings } from '@shared/types';
import { createLogger } from '../logger';
import { modelDir, status } from '../models/paths';
import {
  EngineConfigError,
  SampleBuffer,
  type EngineResult,
  type SttEngine,
} from './engine';

const log = createLogger('stt:local');

interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  isDetected(): boolean;
  pop(): void;
  /**
   * `false` copies the samples out; the default hands back a native view that
   * dies with the next `pop()`. Callers must not retain the default.
   */
  front(enableExternalBuffer?: boolean): { start: number; samples: Float32Array };
  flush(): void;
  reset(): void;
}

interface SherpaOfflineStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void;
  /** Per-stream option, e.g. `language`. Supported since sherpa-onnx 1.10. */
  setOption?(key: string, value: string): void;
}

interface SherpaRecognizer {
  createStream(): SherpaOfflineStream;
  decode(stream: SherpaOfflineStream): void;
  getResult(stream: SherpaOfflineStream): { text: string; lang?: string };
}

/**
 * The recognizer is built once and kept warm for the process lifetime.
 *
 * This is the difference between a hotkey that responds instantly and one that
 * does not: constructing `OfflineRecognizer` reads the 937 MB ONNX graph and was
 * measured at **~3.3 s** on this machine. Rebuilding it per session meant every
 * press paid that cost before the microphone could even start — the reported
 * "it takes a moment to show the green bar" symptom.
 *
 * Held in a module-level cache rather than on the engine instance because the
 * engine object itself is created per session by the factory; the expensive
 * native handle has to outlive it.
 */
let cached: {
  recognizer: SherpaRecognizer;
  vad: SherpaVad;
  modelPath: string;
  threads: number;
  vadKey: string;
} | null = null;

/** Why the last load failed, so the UI can explain rather than just fail. */
let loadError: string | null = null;

/** True once a recognizer is resident and a session can start with no disk I/O. */
export function isLocalEngineWarm(): boolean {
  return cached !== null;
}

/**
 * Build the native recognizer ahead of the first hotkey press.
 *
 * Called during startup so the first dictation is as fast as every later one.
 * Resolves `false` (never throws) when the model is absent — the app still runs
 * with a cloud provider in that case.
 */
export async function preloadLocalEngine(settings: Settings): Promise<boolean> {
  if (cached) return true;
  try {
    await loadNative(settings);
    log.info('local engine preloaded and warm');
    return true;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    log.info(`local engine not preloaded: ${loadError}`);
    return false;
  }
}

/** Tear the recognizer down. For app quit, or when the model files change. */
export function shutdownLocalEngine(): void {
  cached = null;
  loadError = null;
  log.info('local engine shut down');
}

function threadsFor(): number {
  // Half the logical cores, capped: ONNX Runtime gains little past this for a
  // model this size, and leaving headroom keeps the rest of the system snappy
  // while dictating.
  return Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));
}

/** Everything that would require rebuilding the native handles if it changed. */
function vadKeyFor(settings: Settings): string {
  const { vadThreshold, silenceMs, maxSegmentMs } = settings.audio;
  return `${vadThreshold}|${silenceMs}|${maxSegmentMs}`;
}

async function loadNative(settings: Settings): Promise<NonNullable<typeof cached>> {
  const asr = status('asr');
  const vadStatus = status('vad');

  if (!asr.installed || !vadStatus.installed) {
    throw new EngineConfigError(
      'On-device model not installed yet. Download it from Settings, or switch to a cloud engine.',
    );
  }

  // Required lazily: the native addon must not load before Electron's paths are
  // initialised.
  const sherpa = require('sherpa-onnx-node') as {
    Vad: new (config: unknown, bufferSeconds: number) => SherpaVad;
    OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  };

  const asrDir = modelDir('asr');
  const modelPath = `${asrDir}/model.onnx`;
  const tokensPath = `${asrDir}/tokens.txt`;
  const vadPath = `${modelDir('vad')}/silero_vad.onnx`;

  for (const p of [modelPath, tokensPath, vadPath]) {
    if (!fs.existsSync(p)) throw new EngineConfigError(`Missing model file: ${p}`);
  }

  const threads = threadsFor();
  const startedAt = Date.now();

  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: vadPath,
        threshold: settings.audio.vadThreshold,
        minSilenceDuration: settings.audio.silenceMs / 1000,
        minSpeechDuration: 0.2,
        maxSpeechDuration: settings.audio.maxSegmentMs / 1000,
        windowSize: 512,
      },
      sampleRate: 16000,
      numThreads: 1,
      provider: 'cpu',
      debug: false,
    },
    60,
  );

  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: modelPath,
        // The per-stream option below overrides this; `auto` here just avoids
        // pinning the shared recognizer to one language.
        language: 'auto',
        // Turns spoken numbers into digits and phrases like "October 7 2024"
        // into a date.
        useInverseTextNormalization: 1,
      },
      tokens: tokensPath,
      numThreads: threads,
      provider: 'cpu',
      debug: false,
    },
  });

  cached = { recognizer, vad, modelPath, threads, vadKey: vadKeyFor(settings) };
  loadError = null;
  log.info(`model loaded in ${Date.now() - startedAt}ms (threads=${threads})`);
  return cached;
}

/**
 * On-device transcription via sherpa-onnx, backed by a process-wide warm
 * recognizer.
 *
 * The model is **SenseVoice-Small**: multilingual (zh/en/ja/ko/yue), handles
 * code-switching within one utterance, ships inverse text normalisation so
 * spoken numbers become digits, and is small enough to run comfortably
 * real-time on the hardware this targets.
 *
 * There is no true streaming variant of SenseVoice, so "real time" here means
 * segment-level: a Silero VAD endpointing detector slices the mic stream at
 * natural pauses, and each slice is decoded the moment it closes. Text lands
 * roughly 300–600 ms after the speaker stops.
 */
export class LocalEngine implements SttEngine {
  readonly id = 'local';
  readonly label = 'SenseVoice (on-device)';
  /** Utterance-based: partials would need a second, weaker model. */
  readonly streaming = false;

  private settings: Settings | null = null;
  private buffer = new SampleBuffer();
  private pendingSamples = new Float32Array(0);

  /** Samples per VAD window; Silero expects 512 at 16 kHz. */
  private static readonly WINDOW = 512;

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    const state = cached;

    // Rebuild only when something structural changed. A language change does
    // NOT rebuild — it is applied per stream, which keeps switching languages
    // free instead of costing another 3.3 s model load.
    const needsRebuild =
      !state ||
      state.modelPath !== `${modelDir('asr')}/model.onnx` ||
      state.threads !== threadsFor() ||
      state.vadKey !== vadKeyFor(settings);

    if (needsRebuild) await loadNative(settings);

    // Fresh utterance: clear detector state and any carried-over audio.
    cached!.vad.reset();
    this.buffer.clear();
    this.pendingSamples = new Float32Array(0);
  }

  async pushAudio(samples: Float32Array): Promise<EngineResult[]> {
    const state = cached;
    if (!state) return [];

    const results: EngineResult[] = [];
    const window = LocalEngine.WINDOW;

    // The VAD consumes fixed 512-sample windows, so carry any remainder over to
    // the next call rather than misaligning the detector.
    const pending = this.pendingSamples.length ? concat(this.pendingSamples, samples) : samples;
    const usable = pending.length - (pending.length % window);

    for (let offset = 0; offset < usable; offset += window) {
      state.vad.acceptWaveform(pending.subarray(offset, offset + window));

      // Each completed segment is decoded immediately, so the user sees text as
      // soon as they pause.
      while (!state.vad.isEmpty()) {
        const segment = this.takeSegment();
        if (segment) {
          const text = this.decode(segment);
          if (text) results.push({ text, final: true });
        }
      }
    }

    this.pendingSamples =
      usable < pending.length ? new Float32Array(pending.subarray(usable)) : new Float32Array(0);

    return results;
  }

  /**
   * Pop the front speech segment and return a private copy of its samples.
   *
   * `front(true)` (the default) hands back a view into the detector's native
   * buffer, which is wrong in two ways here:
   *
   *  - It throws `External buffers are not allowed` in the packaged app.
   *  - Even where it works, the view is invalidated by the following `pop()`,
   *    so holding it across a decode would point at memory the detector may
   *    reuse. That is silent corruption, not just an error.
   *
   * `front(false)` copies, which is what a value outliving the call needs.
   */
  private takeSegment(): Float32Array | null {
    const state = cached;
    if (!state) return null;
    try {
      const segment = state.vad.front(false) as { samples?: Float32Array } | undefined;
      const samples = segment?.samples;
      return samples && samples.length ? samples : null;
    } catch (err) {
      log.warn('could not read a VAD segment:', err);
      return null;
    } finally {
      // Always advance, even if reading failed, or the same broken segment would
      // be retried forever and block all further audio.
      try {
        state.vad.pop();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Decode one segment. Synchronous on purpose: the decode itself is a blocking
   * native call, and pretending otherwise by awaiting only added scheduling
   * delay between a pause and the text appearing.
   */
  private decode(samples: Float32Array): string {
    const state = cached;
    if (!state || samples.length < 1600) return ''; // < 100 ms: noise, not speech

    const stream = state.recognizer.createStream();

    // Pin the language for this utterance. Naming it skips the language-ID head
    // and keeps the decoder on one path, which is both faster and more accurate
    // than `auto` for the two languages this app supports.
    const language = this.settings?.language.primary ?? 'en';
    try {
      stream.setOption?.('language', language);
    } catch (err) {
      // Non-fatal: the recognizer's own default still applies.
      log.debug(`could not set language "${language}":`, err);
    }

    stream.acceptWaveform({ samples, sampleRate: 16000 });
    state.recognizer.decode(stream);
    return cleanSenseVoiceOutput(state.recognizer.getResult(stream)?.text ?? '');
  }

  async finishUtterance(): Promise<EngineResult[]> {
    const state = cached;
    if (!state) return [];

    const results: EngineResult[] = [];

    // Flush whatever the VAD is holding so a short final phrase is not lost when
    // the user releases the key mid-pause.
    state.vad.acceptWaveform(new Float32Array(LocalEngine.WINDOW));
    state.vad.flush();
    while (!state.vad.isEmpty()) {
      const segment = this.takeSegment();
      if (!segment) continue;
      const text = this.decode(segment);
      if (text) results.push({ text, final: true });
    }

    state.vad.reset();
    this.pendingSamples = new Float32Array(0);
    this.buffer.clear();
    return results;
  }

  /**
   * Drop buffered audio for a cancelled session. Deliberately does NOT release
   * the recognizer — the whole point of the warm cache is that ending a session
   * is instant and the next press is too.
   */
  reset(): void {
    cached?.vad.reset();
    this.buffer.clear();
    this.pendingSamples = new Float32Array(0);
  }

  /** Release the shared recognizer. Only for app quit or a model change. */
  async dispose(): Promise<void> {
    this.reset();
    this.settings = null;
    shutdownLocalEngine();
  }
}

/**
 * SenseVoice prefixes each result with a language/emotion token block, e.g.
 * `<|zh|><|NEUTRAL|><|Speech|><|woitn|>`. Strip it — the user wants text.
 */
export function cleanSenseVoiceOutput(raw: string): string {
  return raw
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
