import type { Settings } from '@shared/types';
import { createLogger } from '../logger';
import {
  EngineConfigError,
  SampleBuffer,
  bcp47,
  encodeWav,
  type EngineResult,
  type SttEngine,
} from './engine';

const log = createLogger('stt:providers');

/** Applied to a single HTTP round trip. */
const REQUEST_TIMEOUT_MS = 45_000;
/** AssemblyAI is upload + create + poll, so the whole operation needs longer. */
const JOB_TIMEOUT_MS = 120_000;
/** AssemblyAI has no webhook configured, so its job is polled at this interval. */
const POLL_INTERVAL_MS = 1_000;

/**
 * Shared machinery for the batch providers.
 *
 * Every provider in this file posts one complete utterance and gets text back —
 * none of them stream, and all of them make the same three moves: accumulate
 * audio, ignore utterances too short to be speech, and wrap a network failure in
 * something the UI can show. Writing that out four times would mean four places
 * to fix the same bug, so only `transcribe` differs per provider.
 *
 * `finishUtterance` must reject with a message fit for the user; the session
 * orchestrator surfaces it verbatim.
 */
abstract class BatchEngine implements SttEngine {
  readonly streaming = false;

  private buffer = new SampleBuffer();
  protected settings: Settings | null = null;

  constructor(
    readonly id: string,
    readonly label: string,
  ) {}

  abstract start(settings: Settings): Promise<void>;

  /** Turn one complete utterance into text. Empty string means "no speech". */
  protected abstract transcribe(samples: Float32Array, settings: Settings): Promise<string>;

  async pushAudio(samples: Float32Array): Promise<EngineResult[]> {
    this.buffer.push(samples);
    return [];
  }

  async finishUtterance(): Promise<EngineResult[]> {
    const samples = this.buffer.toFloat32();
    this.buffer.clear();

    // Under ~200 ms there is rarely real speech; posting it wastes a request and
    // invites hallucinated output from the model.
    if (samples.length < 16000 * 0.2) return [];

    const settings = this.settings;
    if (!settings) throw new EngineConfigError(`${this.label}: engine not started`);

    const text = (await this.transcribe(samples, settings)).trim();
    if (!text) log.debug(`${this.id}: empty transcript for ${samples.length} samples`);
    return text ? [{ text, final: true }] : [];
  }

  reset(): void {
    this.buffer.clear();
  }

  async dispose(): Promise<void> {
    this.buffer.clear();
    this.settings = null;
  }
}

// --------------------------------------------------------------------- helpers

/** `fetch` with a hard deadline, reported as a sentence rather than a DOMException. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Response body, trimmed to something a toast can hold. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? `: ${text.slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

/** Assert a non-empty credential, so the failure names the missing field. */
function requireKey(value: string, field: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EngineConfigError(
      `No ${field} set for ${label}. Add one in Settings, or switch to the on-device engine.`,
    );
  }
  return trimmed;
}

/** Encode PCM as base64, the form every JSON-bodied audio API wants. */
function pcmToBase64(samples: Float32Array, sampleRate = 16000): string {
  return encodeWav(samples, sampleRate).toString('base64');
}

// ----------------------------------------------------------------- ElevenLabs

/**
 * ElevenLabs Scribe.
 *
 * Multipart upload to a single endpoint — the simplest of the four, and the same
 * request shape as the OpenAI-compatible engines, just under a different header
 * and field name.
 */
export class ElevenLabsEngine extends BatchEngine {
  constructor() {
    super('elevenlabs', 'ElevenLabs Scribe');
  }

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    requireKey(settings.cloud.elevenlabs.apiKey, 'API key', this.label);
    requireKey(settings.cloud.elevenlabs.model, 'model', this.label);
  }

  protected async transcribe(samples: Float32Array): Promise<string> {
    const settings = this.settings!;
    const { apiKey, model } = settings.cloud.elevenlabs;

    const form = new FormData();
    form.append('model_id', model);
    form.append(
      'file',
      new Blob([new Uint8Array(encodeWav(samples, 16000))], { type: 'audio/wav' }),
      'audio.wav',
    );
    // Scribe takes a bare ISO 639-1 code, and only accepts this field when a
    // single language is expected — which is exactly our case.
    form.append('language_code', settings.language.primary);

    const res = await fetchWithTimeout(
      'https://api.elevenlabs.io/v1/speech-to-text',
      { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form },
      this.label,
    );

    if (!res.ok) throw new Error(`${this.label} returned HTTP ${res.status}${await errorDetail(res)}`);

    const json = (await res.json()) as { text?: string };
    return json.text ?? '';
  }
}

// -------------------------------------------------------------------- AssemblyAI

/**
 * AssemblyAI.
 *
 * A three-step job rather than one request: upload the bytes, create a
 * transcript pointing at the returned URL, then poll until it completes. There
 * is no synchronous endpoint, so `transcribe` owns the whole sequence.
 */
export class AssemblyAiEngine extends BatchEngine {
  constructor() {
    super('assemblyai', 'AssemblyAI');
  }

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    requireKey(settings.cloud.assemblyai.apiKey, 'API key', this.label);
  }

  protected async transcribe(samples: Float32Array): Promise<string> {
    const settings = this.settings!;
    const { apiKey, model } = settings.cloud.assemblyai;
    const auth = { authorization: apiKey };

    // 1. Upload. AssemblyAI stores the audio and hands back a URL to reference.
    const wav = encodeWav(samples, 16000);
    const uploadRes = await fetchWithTimeout(
      'https://api.assemblyai.com/v2/upload',
      {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(wav),
      },
      `${this.label} upload`,
    );
    if (!uploadRes.ok) {
      throw new Error(
        `${this.label} upload returned HTTP ${uploadRes.status}${await errorDetail(uploadRes)}`,
      );
    }
    const { upload_url: audioUrl } = (await uploadRes.json()) as { upload_url?: string };
    if (!audioUrl) throw new Error(`${this.label} did not return an upload URL`);

    // 2. Create the transcript job.
    const created = await fetchWithTimeout(
      'https://api.assemblyai.com/v2/transcript',
      {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_url: audioUrl,
          // The current pre-recorded API takes an ordered model list. Retain
          // compatibility with settings saved under the old `universal` ID.
          speech_models: [model.trim() === 'universal' ? 'universal-2' : model.trim() || 'universal-2'],
          language_code: settings.language.primary,
        }),
      },
      this.label,
    );
    if (!created.ok) {
      throw new Error(`${this.label} returned HTTP ${created.status}${await errorDetail(created)}`);
    }
    const job = (await created.json()) as { id?: string };
    if (!job.id) throw new Error(`${this.label} did not return a transcript id`);

    // 3. Poll. Bounded overall rather than per-request, so a job that never
    //    settles cannot hold the session open indefinitely.
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(`${this.label} did not finish within ${JOB_TIMEOUT_MS / 1000}s`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const poll = await fetchWithTimeout(
        `https://api.assemblyai.com/v2/transcript/${job.id}`,
        { headers: auth },
        this.label,
      );
      if (!poll.ok) {
        throw new Error(`${this.label} poll returned HTTP ${poll.status}${await errorDetail(poll)}`);
      }

      const state = (await poll.json()) as { status?: string; text?: string; error?: string };
      if (state.status === 'completed') return state.text ?? '';
      if (state.status === 'error') {
        throw new Error(`${this.label}: ${state.error ?? 'transcription failed'}`);
      }
      // `queued` / `processing` — loop.
    }
  }
}

// ---------------------------------------------------------------- Google Cloud

/**
 * Google Cloud Speech-to-Text v1, synchronous `speech:recognize`.
 *
 * Chosen over the v2 or streaming endpoints because it is one authenticated
 * JSON POST and the app already segments utterances at VAD boundaries. The
 * key travels as a query parameter, which is Google's documented scheme for
 * API-key callers and therefore ends up in URLs and logs — worth knowing, and
 * the reason the log line below never includes the request URL.
 */
export class GoogleEngine extends BatchEngine {
  constructor() {
    super('google', 'Google Cloud STT');
  }

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    requireKey(settings.cloud.google.apiKey, 'API key', this.label);
  }

  protected async transcribe(samples: Float32Array): Promise<string> {
    const settings = this.settings!;
    const { apiKey, model } = settings.cloud.google;

    const body = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: bcp47(settings.language.primary),
        model: model.trim() || 'latest_long',
        enableAutomaticPunctuation: true,
      },
      audio: { content: pcmToBase64(samples) },
    };

    const res = await fetchWithTimeout(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.label,
    );

    if (!res.ok) throw new Error(`${this.label} returned HTTP ${res.status}${await errorDetail(res)}`);

    const json = (await res.json()) as {
      results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
    };

    // One `results` entry per detected phrase; joining them reconstructs the
    // utterance, and dropping any would silently lose the middle of a sentence.
    return (json.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();
  }
}

// ----------------------------------------------------------------------- Azure

/**
 * Azure Speech-to-Text, short-audio REST endpoint.
 *
 * The endpoint is per-region rather than global, so the user supplies a region
 * instead of a base URL — a wrong region is the most likely misconfiguration and
 * surfaces as a 404, which the error below reports as such rather than as a bad key.
 */
export class AzureEngine extends BatchEngine {
  constructor() {
    super('azure', 'Azure Speech');
  }

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    requireKey(settings.cloud.azure.apiKey, 'API key', this.label);
    requireKey(settings.cloud.azure.region, 'region', this.label);
  }

  protected async transcribe(samples: Float32Array): Promise<string> {
    const settings = this.settings!;
    const { apiKey, region } = settings.cloud.azure;

    const url =
      `https://${encodeURIComponent(region)}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(bcp47(settings.language.primary))}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          // Azure needs the container spelled out; a bare `audio/wav` is rejected.
          'content-type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          accept: 'application/json',
        },
        body: new Uint8Array(encodeWav(samples, 16000)),
      },
      this.label,
    );

    if (res.status === 404) {
      throw new Error(
        `${this.label}: region "${region}" not found — check the region in Settings (e.g. eastasia, westus).`,
      );
    }
    if (!res.ok) throw new Error(`${this.label} returned HTTP ${res.status}${await errorDetail(res)}`);

    const json = (await res.json()) as {
      RecognitionStatus?: string;
      DisplayText?: string;
      ErrorDetails?: string;
    };

    // Azure answers 200 with a status field; a silent failure here would look
    // like the model hearing nothing.
    if (json.RecognitionStatus && json.RecognitionStatus !== 'Success') {
      if (json.RecognitionStatus === 'NoMatch') return ''; // genuinely no speech
      throw new Error(
        `${this.label}: ${json.RecognitionStatus}${json.ErrorDetails ? ` — ${json.ErrorDetails}` : ''}`,
      );
    }

    return json.DisplayText ?? '';
  }
}
