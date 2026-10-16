import type { Settings, SpekoRoutingObjective, SpekoSttModel } from '@shared/types';
import { createLogger } from '../logger';
import {
  EngineConfigError,
  SampleBuffer,
  encodeWav,
  type EngineResult,
  type SttEngine,
} from './engine';

const log = createLogger('stt:speko');

/** Speko holds the synchronous batch request open until its route is ready. */
const REQUEST_TIMEOUT_MS = 45_000;
const MIN_UTTERANCE_SAMPLES = 16_000 * 0.2;
const SPEKO_TRANSCRIPTIONS_URL = 'https://router.speko.dev/v1/stt/transcriptions';

type SpekoRequest = {
  routing: { mode: 'auto'; objective: SpekoRoutingObjective }
    | { mode: 'explicit'; provider: string; model: string };
  language: 'en' | 'zh';
};

type SpekoResponse = {
  text?: string;
};

/** The authenticated, region-specific list is the source of model choices. */
export async function listSpekoModels(key: string): Promise<SpekoSttModel[]> {
  const apiKey = key.trim();
  if (!apiKey) throw new EngineConfigError('Add a Speko API key to load its models.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://router.speko.dev/v1/models?path=batch', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw new Error(`Speko model list returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = (await res.json()) as { models?: Array<{ id?: unknown; provider?: unknown; kind?: unknown }> };
    if (!Array.isArray(data.models)) throw new Error('Speko returned an invalid model list');
    const seen = new Set<string>();
    return data.models.flatMap((item) => {
      if (item.kind !== 'stt' || typeof item.provider !== 'string' || typeof item.id !== 'string') return [];
      const provider = item.provider.trim();
      const id = item.id.trim();
      if (!provider || !id) return [];
      const key = `${provider}\u0000${id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ provider, id }];
    }).sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('Speko model list timed out after 10s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Speko Router's synchronous batch STT endpoint.
 *
 * The endpoint requires the JSON request part before the audio part. FormData
 * preserves insertion order, so the two append calls in `transcribe` are
 * intentionally kept adjacent and in that order. The router also requires a
 * fresh idempotency key for every utterance; it is generated per request and
 * never included in logs or user-facing errors.
 */
export class SpekoEngine implements SttEngine {
  readonly id = 'speko';
  readonly label = 'Speko Router';
  readonly streaming = false;

  private buffer = new SampleBuffer();
  private settings: Settings | null = null;

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    this.buffer.clear();

    const apiKey = settings.cloud.speko.apiKey.trim();
    if (!apiKey) {
      throw new EngineConfigError(
        `No API key set for ${this.label}. Add one in Settings, or switch to the on-device engine.`,
      );
    }
  }

  async pushAudio(samples: Float32Array): Promise<EngineResult[]> {
    this.buffer.push(samples);
    return [];
  }

  async finishUtterance(): Promise<EngineResult[]> {
    const samples = this.buffer.toFloat32();
    this.buffer.clear();

    // Avoid spending a request on a click or a tiny VAD segment.
    if (samples.length < MIN_UTTERANCE_SAMPLES) return [];

    const settings = this.settings;
    if (!settings) throw new EngineConfigError(`${this.label}: engine not started`);

    const text = (await this.transcribe(samples, settings)).trim();
    if (!text) log.debug(`empty transcript for ${samples.length} samples`);
    return text ? [{ text, final: true }] : [];
  }

  reset(): void {
    this.buffer.clear();
  }

  async dispose(): Promise<void> {
    this.buffer.clear();
    this.settings = null;
  }

  private async transcribe(samples: Float32Array, settings: Settings): Promise<string> {
    const apiKey = settings.cloud.speko.apiKey.trim();
    if (!apiKey) {
      throw new EngineConfigError(
        `No API key set for ${this.label}. Add one in Settings, or switch to the on-device engine.`,
      );
    }

    const selection = settings.cloud.speko;
    if (selection.routingMode === 'explicit' && (!selection.provider.trim() || !selection.model.trim())) {
      throw new EngineConfigError('Choose a Speko model or enter a Custom provider and model ID in Settings.');
    }
    const request: SpekoRequest = {
      routing: selection.routingMode === 'explicit'
        ? { mode: 'explicit', provider: selection.provider.trim(), model: selection.model.trim() }
        : { mode: 'auto', objective: selection.objective || 'latency' },
      language: settings.language.primary,
    };
    const wav = encodeWav(samples, 16_000);
    const form = new FormData();

    // Speko requires exactly these two parts and rejects reordered parts. Keep
    // `request` first; do not add metadata fields to this form.
    form.append(
      'request',
      new Blob([JSON.stringify(request)], { type: 'application/json' }),
    );
    form.append(
      'audio',
      new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      'audio.wav',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(SPEKO_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'idempotency-key': createIdempotencyKey(),
        },
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(`${this.label} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }

      const json = (await res.json()) as SpekoResponse;
      return json.text ?? '';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`${this.label} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      if (err instanceof Error) throw err;
      throw new Error(`${this.label} request failed`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Generate the per-utterance key required by Speko's idempotency contract. */
function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  // Electron's supported runtime has randomUUID. This fallback only protects
  // older test/runtime shims while retaining the UUID format expected by the
  // endpoint; it does not include any credential or audio data.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300).trim();
  } catch {
    return '';
  }
}
