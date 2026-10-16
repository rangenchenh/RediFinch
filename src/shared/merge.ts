import type { Settings } from './types';
import { AI_PROVIDERS, CLOUD_PROVIDER_IDS, DEFAULT_SETTINGS, OUTPUT_MODES, TARGET_LANGUAGES, TRANSLATION_PROVIDERS } from './types';

/** Plain-object check that stops at arrays, Dates and class instances. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively merge a patch into defaults, ignoring `undefined` so a partial
 * settings object never clobbers a stored value with nothing.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(current) && isPlainObject(value)
      ? deepMerge(current, value)
      : value;
  }
  return out as T;
}

/**
 * Coerce arbitrary parsed JSON into a valid Settings object: start from
 * defaults, merge whatever the file had, then clamp the values that would
 * otherwise crash or misbehave at runtime.
 */
export function normaliseSettings(raw: unknown): Settings {
  const merged = deepMerge(DEFAULT_SETTINGS, raw ?? {});
  const s = merged;

  // Preserve keys and models saved by builds with one shared AI endpoint and
  // one DeepL endpoint. A known URL becomes its preset; unknown URLs remain
  // editable under Custom instead of silently changing where text is sent.
  const oldOutput = isPlainObject(raw) && isPlainObject(raw.output) ? raw.output : null;
  if (oldOutput && !isPlainObject(oldOutput.ai) && isPlainObject(oldOutput.llm)) {
    const old = oldOutput.llm;
    const baseUrl = typeof old.baseUrl === 'string' ? old.baseUrl.trim() : '';
    const provider = AI_PROVIDERS.find((item) => item.value !== 'custom' && item.baseUrl.toLowerCase() === baseUrl.replace(/\/+$/, '').toLowerCase())?.value ?? 'custom';
    for (const mode of ['polish', 'translate'] as const) {
      s.output.ai[mode].provider = provider;
      s.output.ai[mode].providers[provider] = {
        apiKey: typeof old.apiKey === 'string' ? old.apiKey : '',
        model: typeof old.model === 'string' ? old.model : '',
        baseUrl: provider === 'custom' ? baseUrl : '',
      };
    }
  }
  if (oldOutput && !isPlainObject(oldOutput.translation) && isPlainObject(oldOutput.deepl)) {
    const old = oldOutput.deepl;
    const baseUrl = typeof old.baseUrl === 'string' ? old.baseUrl.trim().replace(/\/+$/, '') : '';
    const provider = baseUrl === 'https://api-free.deepl.com/v2' ? 'deepl-free'
      : baseUrl === 'https://api.deepl.com/v2' ? 'deepl-pro' : 'custom';
    s.output.translation.provider = provider;
    s.output.translation.providers[provider] = {
      apiKey: typeof old.apiKey === 'string' ? old.apiKey : '',
      region: '',
      baseUrl: provider === 'custom' ? baseUrl : '',
    };
  }
  const outputRecord = s.output as unknown as Record<string, unknown>;
  delete outputRecord.llm;
  delete outputRecord.deepl;

  s.cloud.openai.baseUrl ||= DEFAULT_SETTINGS.cloud.openai.baseUrl;
  s.cloud.groq.baseUrl ||= DEFAULT_SETTINGS.cloud.groq.baseUrl;
  s.cloud.siliconflow.baseUrl ||= DEFAULT_SETTINGS.cloud.siliconflow.baseUrl;
  // These older defaults have been replaced or removed by their providers.
  if (s.cloud.elevenlabs.model === 'scribe_v1') s.cloud.elevenlabs.model = 'scribe_v2';
  if (s.cloud.assemblyai.model === 'universal') s.cloud.assemblyai.model = 'universal-2';
  if (s.cloud.speko.routingMode !== 'explicit') s.cloud.speko.routingMode = 'auto';
  if (!['balanced', 'quality', 'latency', 'cost'].includes(s.cloud.speko.objective)) {
    s.cloud.speko.objective = DEFAULT_SETTINGS.cloud.speko.objective;
  }
  s.cloud.speko.provider = typeof s.cloud.speko.provider === 'string' ? s.cloud.speko.provider : '';
  s.cloud.speko.model = typeof s.cloud.speko.model === 'string' ? s.cloud.speko.model : '';
  if (!isPlainObject(s.agent)) s.agent = structuredClone(DEFAULT_SETTINGS.agent);
  if (!isPlainObject(s.agent.ai)) s.agent.ai = structuredClone(DEFAULT_SETTINGS.agent.ai);
  if (!isPlainObject(s.agent.tools)) s.agent.tools = { ...DEFAULT_SETTINGS.agent.tools };
  for (const selection of [s.output.ai.polish, s.output.ai.translate, s.agent.ai]) {
    if (!AI_PROVIDERS.some((item) => item.value === selection.provider)) {
      selection.provider = DEFAULT_SETTINGS.agent.ai.provider;
    }
    if (!isPlainObject(selection.providers)) selection.providers = structuredClone(DEFAULT_SETTINGS.agent.ai.providers);
    for (const { value } of AI_PROVIDERS) {
      const config = selection.providers[value];
      if (!config || typeof config !== 'object') {
        selection.providers[value] = { ...DEFAULT_SETTINGS.agent.ai.providers[value] };
        continue;
      }
      config.apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
      config.model = typeof config.model === 'string' ? config.model : '';
      config.baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : '';
    }
  }
  for (const tool of ['chromeRead', 'chromeNavigate', 'localCommands'] as const) {
    if (typeof s.agent.tools[tool] !== 'boolean') s.agent.tools[tool] = DEFAULT_SETTINGS.agent.tools[tool];
  }
  if (!['off', 'ask', 'auto'].includes(s.agent.tools.chromeInteract)) {
    s.agent.tools.chromeInteract = DEFAULT_SETTINGS.agent.tools.chromeInteract;
  }
  if (!TRANSLATION_PROVIDERS.some((item) => item.value === s.output.translation.provider)) {
    s.output.translation.provider = DEFAULT_SETTINGS.output.translation.provider;
  }
  for (const { value } of TRANSLATION_PROVIDERS) {
    const config = s.output.translation.providers[value];
    if (!config || typeof config !== 'object') {
      s.output.translation.providers[value] = { ...DEFAULT_SETTINGS.output.translation.providers[value] };
      continue;
    }
    config.apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
    config.region = typeof config.region === 'string' ? config.region : '';
    config.baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : '';
  }
  if (!OUTPUT_MODES.some((item) => item.value === s.output.mode)) {
    s.output.mode = DEFAULT_SETTINGS.output.mode;
  }
  if (!TARGET_LANGUAGES.some((item) => item.value === s.output.targetLanguage)) {
    s.output.targetLanguage = DEFAULT_SETTINGS.output.targetLanguage;
  }

  // Azure without a region cannot form an endpoint, and an empty string would
  // produce a request to `https://.stt.speech.microsoft.com` rather than a
  // useful error. Restore the default so the failure mode is a wrong region
  // message telling the user what to fix.
  s.cloud.azure.region ||= DEFAULT_SETTINGS.cloud.azure.region;

  // A settings file written by an older build can only ever name providers that
  // existed then, so this is really a guard against a corrupted or hand-edited
  // file pointing `cloudProvider` at something with no engine behind it — which
  // would leave `cloud` strategy failing with no way to recover from the UI.
  if (!CLOUD_PROVIDER_IDS.includes(s.cloudProvider)) {
    s.cloudProvider = DEFAULT_SETTINGS.cloudProvider;
  }

  s.audio.vadThreshold = clamp(s.audio.vadThreshold, 0.05, 0.95);
  s.audio.silenceMs = clamp(Math.round(s.audio.silenceMs), 120, 5000);
  s.audio.maxSegmentMs = clamp(Math.round(s.audio.maxSegmentMs), 2000, 120000);
  s.hotkey.minDurationMs = clamp(Math.round(s.hotkey.minDurationMs), 0, 3000);
  s.ui.overlayOpacity = clamp(s.ui.overlayOpacity, 0.2, 1);

  if (!s.hotkey.accelerator?.trim()) s.hotkey.accelerator = DEFAULT_SETTINGS.hotkey.accelerator;
  if (!s.hotkey.modeShortcuts || typeof s.hotkey.modeShortcuts !== 'object') {
    s.hotkey.modeShortcuts = { ...DEFAULT_SETTINGS.hotkey.modeShortcuts };
  }
  for (const { value } of OUTPUT_MODES) {
    const shortcut = s.hotkey.modeShortcuts[value];
    s.hotkey.modeShortcuts[value] = typeof shortcut === 'string' ? shortcut.trim() : '';
  }

  // Language is restricted to English and Chinese. A settings file written by an
  // earlier build may hold `mixed` or `auto`, neither of which the engine
  // accepts any more; coerce rather than leaving an unusable value in place.
  if (s.language.primary !== 'en' && s.language.primary !== 'zh') {
    s.language.primary = DEFAULT_SETTINGS.language.primary;
  }

  return s;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
