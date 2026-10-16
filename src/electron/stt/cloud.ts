import type { Settings } from '@shared/types';
import { createLogger } from '../logger';
import {
  EngineConfigError,
  SampleBuffer,
  encodeWav,
  joinUrl,
  languageHint,
  type EngineResult,
  type SttEngine,
} from './engine';

const log = createLogger('stt:cloud');

const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Cloud transcription over an OpenAI-compatible `/audio/transcriptions`
 * endpoint.
 *
 * One implementation covers the providers using OpenAI's audio API shape:
 *
 *   - OpenAI      https://api.openai.com/v1            whisper-1
 *   - Groq        https://api.groq.com/openai/v1       whisper-large-v3-turbo
 *   - SiliconFlow https://api.siliconflow.cn/v1        FunAudioLLM/SenseVoiceSmall
 *   - any other OpenAI-compatible gateway               (base URL is editable)
 *
 * These APIs are batch, not streaming — the whole utterance is POSTed and the
 * transcript comes back in one response. The session orchestrator therefore
 * closes a segment on each VAD pause and posts it, which keeps perceived
 * latency low without pretending to be a websocket.
 */
export class OpenAiCompatibleEngine implements SttEngine {
  readonly streaming = false;

  constructor(
    readonly id: string,
    readonly label: string,
    private provider: 'openai' | 'groq' | 'siliconflow',
  ) {}

  private settings: Settings | null = null;
  private buffer = new SampleBuffer();

  private get config() {
    if (!this.settings) throw new EngineConfigError('engine not started');
    return this.settings.cloud[this.provider];
  }

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    const { apiKey, baseUrl, model } = this.config;

    if (!apiKey.trim()) {
      throw new EngineConfigError(
        `No API key set for ${this.label}. Add one in Settings, or switch to the on-device engine.`,
      );
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new EngineConfigError(`${this.label} base URL must start with http:// or https://`);
    }
    if (!model.trim()) {
      throw new EngineConfigError(`${this.label} needs a model name`);
    }

    this.buffer.clear();
  }

  async pushAudio(samples: Float32Array): Promise<EngineResult[]> {
    // Batch APIs produce nothing until the utterance closes.
    this.buffer.push(samples);
    return [];
  }

  async finishUtterance(): Promise<EngineResult[]> {
    const samples = this.buffer.toFloat32();
    this.buffer.clear();

    // Under ~200 ms there is rarely real speech; posting it wastes a request
    // and invites hallucinated output from the model.
    if (samples.length < 16000 * 0.2) return [];

    const text = await this.transcribe(samples);
    return text ? [{ text, final: true }] : [];
  }

  private async transcribe(samples: Float32Array): Promise<string> {
    const settings = this.settings!;
    const { apiKey, baseUrl, model } = this.config;

    const wav = encodeWav(samples, 16000);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const iso = languageHint(settings.language.primary, 'iso');
    if (iso) {
      if (this.id === 'openai' && model === 'gpt-transcribe') form.append('languages[]', iso);
      else form.append('language', iso);
    }
    if (settings.language.prompt.trim()) {
      // Acts as a vocabulary/style bias on Whisper-family models.
      form.append('prompt', settings.language.prompt.trim());
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(joinUrl(baseUrl, 'audio/transcriptions'), {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await safeText(res);
        throw new Error(`${this.label} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }

      const json = (await res.json()) as { text?: string };
      const text = (json.text ?? '').trim();
      if (!text) log.debug(`${this.id}: empty transcript for ${samples.length} samples`);
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`${this.label} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  reset(): void {
    this.buffer.clear();
  }

  async dispose(): Promise<void> {
    this.buffer.clear();
    this.settings = null;
  }
}

/**
 * Deepgram over its websocket streaming API.
 *
 * Kept as a genuinely streaming engine because it is the one provider here that
 * returns interim hypotheses, which makes the overlay feel live. Audio is sent
 * as raw 16-bit PCM — no container needed — and `KeepAlive` keeps the socket
 * from idling out between utterances.
 */
export class DeepgramEngine implements SttEngine {
  readonly id = 'deepgram';
  readonly label = 'Deepgram (streaming)';
  readonly streaming = true;

  private socket: WebSocket | null = null;
  private settings: Settings | null = null;
  private finals: string[] = [];
  private interim = '';

  async start(settings: Settings): Promise<void> {
    this.settings = settings;
    const { apiKey, model } = settings.cloud.deepgram;

    if (!apiKey.trim()) {
      throw new EngineConfigError(
        'No Deepgram API key set. Add one in Settings, or switch to the on-device engine.',
      );
    }

    // Derived from the dictation language, never a separate stored value.
    // Deepgram wants a region-tagged code rather than bare `zh`/`en`; for these
    // two, the primary monolingual models are the right choice (`en-US`,
    // `zh-CN`).
    const language = settings.language.primary === 'zh' ? 'zh-CN' : 'en-US';

    await this.connect(apiKey, model, language);
  }

  private connect(apiKey: string, model: string, language: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        model,
        language,
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true',
        smart_format: 'true',
        punctuate: 'true',
        // ~1.5 s of silence closes an utterance server-side, matching the
        // local engine's endpointing behaviour.
        utterance_end_ms: '1500',
        vad_events: 'true',
      });

      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      // Node's undici WebSocket does not accept arbitrary headers, but it does
      // honour the subprotocol slot; Deepgram documents `token` here.
      const socket = new WebSocket(url, ['token', apiKey]);
      this.socket = socket;

      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        log.info('deepgram socket open');
        resolve();
      });

      socket.addEventListener('error', () => {
        fail(new Error('Deepgram websocket failed to open (check the API key and network)'));
      });

      socket.addEventListener('close', (ev) => {
        log.info(`deepgram socket closed code=${ev.code}`);
        this.socket = null;
        if (!settled) {
          fail(new Error(`Deepgram socket closed before opening (code ${ev.code})`));
        }
      });

      socket.addEventListener('message', (ev) => {
        this.handleMessage(String(ev.data));
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: {
      type?: string;
      is_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'Results') {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (!transcript) return;
      if (msg.is_final) {
        this.finals.push(transcript);
        this.interim = '';
      } else {
        this.interim = transcript;
      }
    } else if (msg.type === 'UtteranceEnd') {
      // Nothing to do — `is_final` already captured the text.
    }
  }

  async pushAudio(samples: Float32Array): Promise<EngineResult[]> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 /* OPEN */) return [];

    // Deepgram wants linear16 little-endian; convert without a container.
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = Math.round(s * 32767);
    }
    socket.send(pcm.buffer);

    return this.drain();
  }

  private drain(): EngineResult[] {
    const results: EngineResult[] = [];

    // Collapse accumulated finals into a single result so the orchestrator
    // injects one coherent chunk rather than a burst of fragments.
    if (this.finals.length > 1) {
      const merged = this.finals.slice(0, -1).join(' ').trim();
      if (merged) results.push({ text: merged, final: true });
      this.finals = [this.finals[this.finals.length - 1]];
    } else if (this.finals.length === 1) {
      results.push({ text: this.finals[0], final: true });
      this.finals = [];
    }

    if (this.interim) {
      results.push({ text: this.interim, final: false });
    }

    return results;
  }

  async finishUtterance(): Promise<EngineResult[]> {
    const socket = this.socket;
    if (socket && socket.readyState === 1) {
      // Ask Deepgram to flush what it has instead of waiting for its own VAD.
      socket.send(JSON.stringify({ type: 'Finalize' }));
      await new Promise((r) => setTimeout(r, 350));
    }

    const results = this.drain();
    if (this.finals.length) {
      const rest = this.finals.join(' ').trim();
      if (rest) results.push({ text: rest, final: true });
      this.finals = [];
    }
    this.interim = '';
    return results;
  }

  reset(): void {
    this.finals = [];
    this.interim = '';
  }

  async dispose(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === 1) {
      try {
        socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        /* ignore */
      }
      socket.close();
    }
    this.reset();
    this.settings = null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Cheap reachability probe used by the engine factory's `auto` strategy.
 * Deliberately short so a dead provider cannot stall startup.
 */
export async function probeProvider(
  provider: 'openai' | 'groq' | 'siliconflow',
  baseUrl: string,
  apiKey: string,
): Promise<{ reachable: boolean; detail: string }> {
  if (!apiKey.trim()) return { reachable: false, detail: 'no API key' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(joinUrl(baseUrl, 'models'), {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (res.ok) return { reachable: true, detail: `HTTP ${res.status}` };
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, detail: `API key rejected (HTTP ${res.status})` };
    }
    // Any other status still proves the host is up and answering.
    return { reachable: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, detail: message };
  } finally {
    clearTimeout(timer);
    void provider;
  }
}
