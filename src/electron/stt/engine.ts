import type { Settings } from '@shared/types';

/**
 * The contract every transcription backend implements.
 *
 * Two operating shapes are supported because real engines differ:
 *
 *  - **streaming** engines emit partial text as audio arrives (cloud socket
 *    APIs). `pushAudio` produces interim results.
 *  - **utterance** engines only accept a complete speech segment (the local
 *    SenseVoice model). `pushAudio` accumulates and returns nothing until
 *    `finishUtterance` is called.
 *
 * The session orchestrator treats both uniformly: partials update the preview,
 * finals get injected.
 */

export interface EngineResult {
  text: string;
  /** False for interim hypotheses that will be superseded. */
  final: boolean;
}

export interface SttEngine {
  readonly id: string;
  /** Shown in the UI, e.g. "SenseVoice (local)". */
  readonly label: string;

  /** True when this engine can emit interim text while the user is speaking. */
  readonly streaming: boolean;

  /** Acquire resources. Must be safe to call before every session. */
  start(settings: Settings): Promise<void>;

  /**
   * Feed mono 16 kHz float32 PCM in [-1, 1]. Returns any results the engine
   * can produce right now — an empty array is normal for utterance engines.
   */
  pushAudio(samples: Float32Array): Promise<EngineResult[]>;

  /**
   * Signal that the current utterance ended and flush whatever is buffered.
   * Called on hotkey release and on VAD-detected end of speech.
   */
  finishUtterance(): Promise<EngineResult[]>;

  /** Drop buffered audio without producing a result (user cancelled). */
  reset(): void;

  /** Release resources. */
  dispose(): Promise<void>;
}

/** Thrown for configuration problems the user can fix, e.g. a missing API key. */
export class EngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineConfigError';
  }
}

/** Compose a provider base URL and endpoint without doubling slashes. */
export function joinUrl(base: string, endpoint: string): string {
  return `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

/**
 * Map the app's language choice onto a provider's expected hint value.
 *
 * Only English and Chinese are supported, so this is a straight lookup rather
 * than a detect-and-hope. Naming the language measurably beats `auto`: the
 * decoder commits to one path instead of running its language-ID head, which is
 * faster and avoids the odd mis-detection on short utterances.
 */
export function languageHint(
  primary: Settings['language']['primary'],
  provider: 'iso' | 'name' | 'sensevoice',
): string {
  if (provider === 'sensevoice') return primary; // SenseVoice accepts 'zh' / 'en'
  if (provider === 'iso') return primary; // both are already ISO 639-1
  return primary === 'zh' ? 'Chinese' : 'English';
}

/**
 * Region-qualified tag for the providers that reject a bare `zh`/`en`.
 *
 * Deepgram, Google and Azure all want a BCP-47 tag. This lives in one place
 * because the last time the same mapping was written out inline in a single
 * engine, nothing kept it in step with the language setting and English users
 * silently got Chinese. Anything deriving a language code goes through here.
 */
export function bcp47(primary: Settings['language']['primary']): string {
  return primary === 'zh' ? 'zh-CN' : 'en-US';
}

/** Turn raw PCM into a 16-bit little-endian WAV byte buffer. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a hot mic can exceed [-1, 1] and would wrap around
    // into loud noise rather than clipping.
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Append PCM to a growing buffer, capped so a stuck mic cannot exhaust RAM. */
export class SampleBuffer {
  private chunks: Float32Array[] = [];
  private length = 0;

  constructor(private maxSamples = 16000 * 60) {}

  push(samples: Float32Array): void {
    if (this.length + samples.length > this.maxSamples) {
      const overflow = this.length + samples.length - this.maxSamples;
      this.dropOldest(overflow);
    }
    // Copy: the caller reuses its transfer buffer.
    this.chunks.push(new Float32Array(samples));
    this.length += samples.length;
  }

  private dropOldest(count: number): void {
    while (count > 0 && this.chunks.length > 0) {
      const head = this.chunks[0];
      if (head.length <= count) {
        this.chunks.shift();
        this.length -= head.length;
        count -= head.length;
      } else {
        this.chunks[0] = head.subarray(count);
        this.length -= count;
        count = 0;
      }
    }
  }

  /** Flatten to one contiguous array. */
  toFloat32(): Float32Array {
    const out = new Float32Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** Duration in seconds at 16 kHz. */
  get seconds(): number {
    return this.length / 16000;
  }

  get size(): number {
    return this.length;
  }

  clear(): void {
    this.chunks = [];
    this.length = 0;
  }
}
