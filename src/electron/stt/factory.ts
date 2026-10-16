import type { EngineId, Settings } from '@shared/types';
import { createLogger } from '../logger';
import { isInstalled } from '../models/paths';
import { DeepgramEngine, OpenAiCompatibleEngine, probeProvider } from './cloud';
import { EngineConfigError, type SttEngine } from './engine';
import { LocalEngine } from './local';
import { SpekoEngine } from './speko';
import {
  AssemblyAiEngine,
  AzureEngine,
  ElevenLabsEngine,
  GoogleEngine,
} from './providers';

const log = createLogger('stt:factory');

export interface ResolvedEngine {
  engine: SttEngine;
  /** Why this engine, shown in the UI so the choice is never a black box. */
  reason: string;
}

/** How long a probe result stays warm, so we are not pinging on every press. */
const PROBE_TTL_MS = 60_000;
const probeCache = new Map<string, { at: number; reachable: boolean; detail: string }>();

/**
 * Pick and construct the engine for the current settings.
 *
 * The user's strategy choice maps as follows:
 *
 *   `local` — always the on-device model, and a clear error if it is missing
 *             rather than a silent fallback to the network.
 *   `cloud` — always the configured provider, and a clear error if it is not
 *             configured rather than silently going local.
 *   `auto`  — on-device when the model is present (privacy, zero latency, works
 *             offline), upgrading to a configured cloud provider only when the
 *             local model is absent and a provider both has a key and answers a
 *             reachability probe.
 *
 * `auto` deliberately prefers local. Dictation is a keystroke-level interaction
 * and a network round trip per utterance is felt; more importantly the user's
 * audio never leaves the machine unless they asked for a cloud provider.
 */
export async function resolveEngine(settings: Settings): Promise<ResolvedEngine> {
  switch (settings.strategy) {
    case 'local':
      return {
        engine: new LocalEngine(),
        reason: 'On-device model selected',
      };

    case 'cloud':
      return {
        engine: buildCloud(settings),
        reason: `Cloud provider selected manually (${settings.cloudProvider})`,
      };

    case 'auto':
    default:
      return resolveAuto(settings);
  }
}

async function resolveAuto(settings: Settings): Promise<ResolvedEngine> {
  const localReady = isInstalled('asr') && isInstalled('vad');

  if (localReady) {
    return {
      engine: new LocalEngine(),
      reason: 'On-device model installed — transcription stays on this machine',
    };
  }

  const cloud = tryBuildCloud(settings);
  if (!cloud) {
    return {
      engine: new LocalEngine(),
      reason: 'No cloud provider configured, and the on-device model is not downloaded yet',
    };
  }

  const probe = await cachedProbe(settings);
  if (probe.reachable) {
    return {
      engine: cloud.engine,
      reason: `On-device model not downloaded — using ${cloud.engine.label} (${probe.detail})`,
    };
  }

  // Nothing works. Hand back the local engine so the failure message the user
  // sees names the real problem (missing model) rather than a network error.
  log.warn(`auto: cloud unreachable (${probe.detail}) and local model missing`);
  return {
    engine: new LocalEngine(),
    reason: `Cloud provider unreachable (${probe.detail}); on-device model not downloaded`,
  };
}

/** Build the explicitly-chosen cloud provider, throwing if it is unusable. */
function buildCloud(settings: Settings): SttEngine {
  const built = tryBuildCloud(settings);
  if (!built) {
    throw new EngineConfigError(
      `Cloud provider "${settings.cloudProvider}" is not fully configured. Add its API key in Settings.`,
    );
  }
  return built.engine;
}

/**
 * Build the configured cloud provider, or `null` when it is not configured.
 *
 * "Configured" means the credential the provider needs is present — a provider
 * selected without a key is treated as unset rather than as a hard failure, so
 * `auto` can fall through to the on-device model instead of surfacing an error
 * for a choice the user made and has not finished filling in.
 */
function tryBuildCloud(settings: Settings): { engine: SttEngine } | null {
  const provider = settings.cloudProvider;

  switch (provider) {
    case 'deepgram':
      if (!settings.cloud.deepgram.apiKey.trim()) return null;
      return { engine: new DeepgramEngine() };

    case 'speko':
      if (!settings.cloud.speko.apiKey.trim()) return null;
      return { engine: new SpekoEngine() };

    case 'siliconflow':
      if (!settings.cloud.siliconflow.apiKey.trim()) return null;
      return { engine: new OpenAiCompatibleEngine('siliconflow', 'SiliconFlow', 'siliconflow') };

    case 'groq':
      if (!settings.cloud.groq.apiKey.trim()) return null;
      return { engine: new OpenAiCompatibleEngine('groq', 'Groq Whisper', 'groq') };

    case 'openai':
      if (!settings.cloud.openai.apiKey.trim()) return null;
      return { engine: new OpenAiCompatibleEngine('openai', 'OpenAI Whisper', 'openai') };

    case 'assemblyai':
      if (!settings.cloud.assemblyai.apiKey.trim()) return null;
      return { engine: new AssemblyAiEngine() };

    case 'elevenlabs':
      if (!settings.cloud.elevenlabs.apiKey.trim()) return null;
      return { engine: new ElevenLabsEngine() };

    case 'google':
      if (!settings.cloud.google.apiKey.trim()) return null;
      return { engine: new GoogleEngine() };

    case 'azure':
      // Azure needs both halves: a key alone cannot form an endpoint.
      if (!settings.cloud.azure.apiKey.trim() || !settings.cloud.azure.region.trim()) return null;
      return { engine: new AzureEngine() };

    default:
      return null;
  }
}

/**
 * Providers with no cheap authenticated endpoint to ping.
 *
 * Probing any of these means either uploading audio or paying for a request, so
 * `auto` treats a present key as good enough and lets a real failure surface
 * during the session — where the error is attached to an actual utterance and
 * is far easier for the user to act on than a silent pre-flight failure.
 */
const NO_PROBE: ReadonlySet<string> = new Set([
  'deepgram',
  'assemblyai',
  'elevenlabs',
  'google',
  'azure',
  'speko',
]);

async function cachedProbe(
  settings: Settings,
): Promise<{ reachable: boolean; detail: string }> {
  const provider = settings.cloudProvider;

  if (NO_PROBE.has(provider)) {
    const configured = tryBuildCloud(settings) !== null;
    return {
      reachable: configured,
      detail: configured ? 'key present' : 'not configured',
    };
  }

  // OpenAI-compatible providers expose a `/models` endpoint that
  // proves both the host and the key in one call.
  const probeKind = provider === 'groq' || provider === 'siliconflow' ? provider : 'openai';
  const cfg = settings.cloud[probeKind];
  const key = `${probeKind}:${cfg.baseUrl}:${cfg.apiKey.slice(-6)}`;

  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) {
    return { reachable: hit.reachable, detail: hit.detail };
  }

  const result = await probeProvider(probeKind, cfg.baseUrl, cfg.apiKey);
  probeCache.set(key, { at: Date.now(), ...result });
  return result;
}

/**
 * Report every provider's usability for the settings screen.
 *
 * Only the OpenAI-compatible pair are genuinely contacted; the rest report
 * whether they are configured, which is all that can be established without
 * spending a request. The `detail` strings say which of those two things the
 * answer means, so a green row is never mistaken for a verified key.
 */
export async function checkProviders(settings: Settings): Promise<
  Array<{ provider: EngineId; reachable: boolean; detail: string }>
> {
  const localReady = isInstalled('asr') && isInstalled('vad');
  const out: Array<{ provider: EngineId; reachable: boolean; detail: string }> = [
    {
      provider: 'local',
      reachable: localReady,
      detail: localReady ? 'model installed' : 'model not downloaded',
    },
  ];

  const openai = await probeProvider(
    'openai',
    settings.cloud.openai.baseUrl,
    settings.cloud.openai.apiKey,
  );
  out.push({ provider: 'openai', ...openai });

  const groq = await probeProvider(
    'groq',
    settings.cloud.groq.baseUrl,
    settings.cloud.groq.apiKey,
  );
  out.push({ provider: 'groq', ...groq });

  const siliconflow = await probeProvider(
    'siliconflow',
    settings.cloud.siliconflow.baseUrl,
    settings.cloud.siliconflow.apiKey,
  );
  out.push({ provider: 'siliconflow', ...siliconflow });

  // The remaining providers depend on a key we cannot verify without a billable
  // request, so these rows report configuration rather than reachability.
  const keyOnly: Array<[EngineId, boolean]> = [
    ['deepgram', !!settings.cloud.deepgram.apiKey.trim()],
    ['assemblyai', !!settings.cloud.assemblyai.apiKey.trim()],
    ['elevenlabs', !!settings.cloud.elevenlabs.apiKey.trim()],
    ['google', !!settings.cloud.google.apiKey.trim()],
    ['azure', !!settings.cloud.azure.apiKey.trim() && !!settings.cloud.azure.region.trim()],
    ['speko', !!settings.cloud.speko.apiKey.trim()],
  ];
  for (const [provider, ready] of keyOnly) {
    out.push({ provider, reachable: ready, detail: ready ? 'key present' : 'not configured' });
  }

  return out;
}
