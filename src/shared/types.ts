/**
 * Types shared by the Electron main process and the Next.js renderer.
 *
 * Nothing in here may import from `electron` or `react` — it is loaded by both
 * sides and by the plain-Node build scripts.
 */

export type EngineId =
  | 'auto'
  | 'local'
  | 'openai'
  | 'groq'
  | 'siliconflow'
  | 'deepgram'
  | 'assemblyai'
  | 'elevenlabs'
  | 'azure'
  | 'google'
  | 'speko';

/**
 * How the app decides where to transcribe.
 * - `local`  on-device only, works offline
 * - `cloud`  always use a cloud provider (fails loudly if unconfigured)
 * - `auto`   local unless a cloud provider is configured AND reachable
 */
export type EngineStrategy = 'local' | 'cloud' | 'auto';

/**
 * The providers that can actually transcribe.
 *
 * Deliberately excludes `auto` (not a provider) and `local` (not cloud). Kept
 * separate from `EngineId` so `settings.cloudProvider` cannot be assigned a
 * value that has no engine behind it.
 */
export type CloudProviderId = Exclude<EngineId, 'auto' | 'local'>;

export type DictationMode = 'hold' | 'toggle';

export type InjectionMethod = 'auto' | 'paste' | 'type';

/**
 * The two dictation languages.
 *
 * SenseVoice can do more, but restricting the surface keeps the settings honest,
 * removes a class of misconfiguration, and lets the engine pass a definite
 * language tag rather than `auto` — which measurably cuts decode latency.
 *
 * `label` is English-only on purpose. An earlier version also carried the
 * language's own script name and printed both side by side; the app is aimed at
 * a general audience, so the UI stays in one language.
 */
export type DictationLanguage = 'en' | 'zh';

export const DICTATION_LANGUAGES: ReadonlyArray<{
  value: DictationLanguage;
  label: string;
}> = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
];

/**
 * Display names for the provider status list.
 *
 * A plain map rather than CSS `text-transform: capitalize`, which renders
 * `assemblyai` as "Assemblyai" and `siliconflow` as "Siliconflow".
 */
export const CLOUD_PROVIDER_LABELS: Record<CloudProviderId, string> = {
  openai: 'OpenAI',
  groq: 'Groq Whisper',
  siliconflow: 'SiliconFlow',
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
  assemblyai: 'AssemblyAI',
  google: 'Google Cloud STT',
  azure: 'Azure Speech',
  speko: 'Speko Router',
};

export const CLOUD_PROVIDER_IDS = Object.keys(CLOUD_PROVIDER_LABELS) as CloudProviderId[];

export interface CloudProviderConfig {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** A provider addressed only by key, with no configurable endpoint. */
export interface KeyedProviderConfig {
  apiKey: string;
  model: string;
}

/**
 * Azure Speech is the odd one out: the endpoint is derived from a region rather
 * than being a fixed host, and the language comes from the dictation setting, so
 * there is no model to name.
 */
export interface AzureProviderConfig {
  apiKey: string;
  /** Deployment region, e.g. `eastasia`. Forms the host of the endpoint. */
  region: string;
}

export type SpekoRoutingObjective = 'balanced' | 'quality' | 'latency' | 'cost';

export interface SpekoProviderConfig {
  apiKey: string;
  routingMode: 'auto' | 'explicit';
  objective: SpekoRoutingObjective;
  provider: string;
  model: string;
}

export interface SpekoSttModel {
  provider: string;
  id: string;
}

export interface CloudConfig {
  openai: CloudProviderConfig;
  groq: CloudProviderConfig;
  siliconflow: CloudProviderConfig;
  deepgram: KeyedProviderConfig;
  assemblyai: KeyedProviderConfig;
  elevenlabs: KeyedProviderConfig;
  google: KeyedProviderConfig;
  azure: AzureProviderConfig;
  speko: SpekoProviderConfig;
}

export type OutputMode = 'raw' | 'polish' | 'translate-llm' | 'translate-api';

export const OUTPUT_MODES: ReadonlyArray<{ value: OutputMode; label: string }> = [
  { value: 'raw', label: 'Transcribe' },
  { value: 'polish', label: 'Polish' },
  { value: 'translate-llm', label: 'AI translate' },
  { value: 'translate-api', label: 'Translate' },
];

/** Preset endpoints are owned by the app; only Custom exposes a Base URL field. */
export const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { value: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
  { value: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7' },
  { value: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
  { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { value: 'custom', label: 'Custom (OpenAI compatible)', baseUrl: '', model: '' },
] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number]['value'];

export interface AiProviderConfig {
  apiKey: string;
  model: string;
  /** Read only for Custom; presets always use their verified endpoint. */
  baseUrl: string;
}
export interface AiModeConfig {
  provider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig>;
}

export interface AgentToolsConfig {
  chromeRead: boolean;
  chromeNavigate: boolean;
  chromeInteract: 'off' | 'ask' | 'auto';
  localCommands: boolean;
}

export const TRANSLATION_PROVIDERS = [
  { value: 'deepl-free', label: 'DeepL Free' },
  { value: 'deepl-pro', label: 'DeepL Pro' },
  { value: 'google', label: 'Google Cloud Translation' },
  { value: 'azure', label: 'Microsoft Translator' },
  { value: 'custom', label: 'Custom (DeepL compatible)' },
] as const;
export type TranslationProviderId = (typeof TRANSLATION_PROVIDERS)[number]['value'];
export interface TranslationProviderConfig {
  apiKey: string;
  /** Used by Azure regional resources. */
  region: string;
  /** Read only for Custom. */
  baseUrl: string;
}
export interface TranslationConfig {
  provider: TranslationProviderId;
  providers: Record<TranslationProviderId, TranslationProviderConfig>;
}

export const TARGET_LANGUAGES = [
  { value: 'EN', label: 'English' },
  { value: 'ZH', label: 'Chinese' },
  { value: 'JA', label: 'Japanese' },
  { value: 'KO', label: 'Korean' },
  { value: 'ES', label: 'Spanish' },
  { value: 'FR', label: 'French' },
  { value: 'DE', label: 'German' },
  { value: 'PT-BR', label: 'Portuguese' },
] as const;

export interface Settings {
  /** Which engine to prefer. */
  strategy: EngineStrategy;
  /** Explicit cloud provider when strategy is `cloud`. */
  cloudProvider: CloudProviderId;

  /**
   * No `language` field on any provider here, on purpose. Deepgram used to have
   * one, defaulting to `zh-CN`; since nothing ever synced it to
   * `language.primary`, choosing English still sent Chinese. The dictation
   * language is the single source of truth, and each engine derives whatever
   * code its API wants at connect time.
   */
  cloud: CloudConfig;

  output: {
    mode: OutputMode;
    targetLanguage: string;
    ai: { polish: AiModeConfig; translate: AiModeConfig };
    /** Additional guidance for polish mode. */
    polishPrompt: string;
    translation: TranslationConfig;
  };

  agent: {
    ai: AiModeConfig;
    tools: AgentToolsConfig;
  };

  language: {
    /**
     * Dictation language. Deliberately limited to English and Chinese: naming
     * the language lets the model commit to one decoding path instead of
     * hedging, which is both faster and more accurate than auto-detection for
     * the two languages this app is used for.
     */
    primary: DictationLanguage;
    /** Strip punctuation the model emits, for continuous prose. */
    prompt: string;
  };

  hotkey: {
    /** Electron accelerator, e.g. `Alt+Space`. */
    accelerator: string;
    /** Optional dedicated hotkeys that select a mode and begin dictation. */
    modeShortcuts: Record<OutputMode, string>;
    mode: DictationMode;
    /** Ignore activations shorter than this (ms) — avoids stray clicks. */
    minDurationMs: number;
  };

  audio: {
    deviceId: string | null;
    /** VAD sensitivity, 0..1. Higher = needs louder speech to trigger. */
    vadThreshold: number;
    /** Trailing silence (ms) before a segment is finalised. */
    silenceMs: number;
    /** Hard cap on a single utterance so a stuck mic cannot grow forever. */
    maxSegmentMs: number;
  };

  injection: {
    method: InjectionMethod;
    /** Put the transcript on the clipboard afterwards so ⌘/Ctrl+V can re-paste. */
    keepInClipboard: boolean;
    /** Insert a trailing space after each dictation. */
    trailingSpace: boolean;
    /** Turn spoken punctuation words ("comma", "period") into symbols. */
    spokenPunctuation: boolean;
    /** Restore the clipboard contents that were present before injection. */
    restoreClipboard: boolean;
  };

  ui: {
    startHidden: boolean;
    showOverlay: boolean;
    overlayOpacity: number;
    theme: 'system' | 'light' | 'dark';
    launchAtLogin: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  strategy: 'auto',
  cloudProvider: 'openai',
  cloud: {
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', model: 'whisper-large-v3-turbo' },
    siliconflow: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'FunAudioLLM/SenseVoiceSmall',
    },
    deepgram: { apiKey: '', model: 'nova-3' },
    assemblyai: { apiKey: '', model: 'universal-2' },
    elevenlabs: { apiKey: '', model: 'scribe_v2' },
    google: { apiKey: '', model: 'latest_long' },
    azure: { apiKey: '', region: 'eastasia' },
    speko: { apiKey: '', routingMode: 'auto', objective: 'latency', provider: '', model: '' },
  },
  output: {
    mode: 'raw',
    targetLanguage: 'ZH',
    ai: { polish: defaultAiMode(), translate: defaultAiMode() },
    polishPrompt: '',
    translation: {
      provider: 'deepl-free',
      providers: {
        'deepl-free': { apiKey: '', region: '', baseUrl: '' },
        'deepl-pro': { apiKey: '', region: '', baseUrl: '' },
        google: { apiKey: '', region: '', baseUrl: '' },
        azure: { apiKey: '', region: '', baseUrl: '' },
        custom: { apiKey: '', region: '', baseUrl: '' },
      },
    },
  },
  agent: {
    ai: defaultAiMode(),
    tools: { chromeRead: true, chromeNavigate: true, chromeInteract: 'ask', localCommands: false },
  },
  language: { primary: 'en', prompt: '' },
  // Ctrl+Win: a chord almost nothing else claims, and there is no default Win
  // binding on either key when they are pressed together.
  hotkey: {
    accelerator: 'Ctrl+Super',
    modeShortcuts: { raw: '', polish: '', 'translate-llm': 'Ctrl+Super+Shift', 'translate-api': '' },
    mode: 'hold',
    minDurationMs: 120,
  },
  audio: {
    deviceId: null,
    vadThreshold: 0.5,
    silenceMs: 480,
    maxSegmentMs: 20000,
  },
  injection: {
    method: 'auto',
    keepInClipboard: false,
    trailingSpace: true,
    spokenPunctuation: true,
    restoreClipboard: true,
  },
  ui: {
    startHidden: false,
    showOverlay: true,
    overlayOpacity: 0.96,
    theme: 'system',
    launchAtLogin: false,
  },
};

function defaultAiMode(): AiModeConfig {
  return {
    provider: 'openai',
    providers: Object.fromEntries(AI_PROVIDERS.map(({ value, model }) => [
      value, { apiKey: '', model, baseUrl: '' },
    ])) as Record<AiProviderId, AiProviderConfig>,
  };
}

/** Lifecycle of the dictation session, mirrored into the UI. */
export type DictationState = 'idle' | 'listening' | 'processing' | 'error';

export interface TranscriptSegment {
  id: string;
  text: string;
  /** True once the segment will not change again. */
  final: boolean;
  /** Epoch ms when the segment started. */
  startedAt: number;
  /** Which engine produced it, for the UI badge. */
  engine: string;
  /** Wall-clock ms spent transcribing, when known. */
  latencyMs?: number;
}

export interface DictationOutput {
  raw: string;
  text: string;
  mode: OutputMode;
}

export interface AudioLevel {
  /** RMS in 0..1, already smoothed by the worklet. */
  level: number;
  /** True while the VAD believes speech is present. */
  speaking: boolean;
}

export interface ModelStatus {
  kind: 'vad' | 'asr';
  installed: boolean;
  path: string;
  bytes: number;
  /** 0..1 while downloading, null when unknown/not downloading. */
  progress: number | null;
  error?: string;
}

export interface RuntimeStatus {
  state: DictationState;
  /** Engine actually in use right now (resolved from strategy). */
  activeEngine: string;
  /** Human-readable explanation of why that engine was chosen. */
  engineReason: string;
  models: ModelStatus[];
  hotkeyRegistered: boolean;
  hotkeyMode: DictationMode;
  /** Non-null when the hook child process degraded to the fallback path. */
  hotkeyWarning?: string;
  audioDeviceLabel?: string;
  lastError?: string;
}

export interface InjectionResult {
  ok: boolean;
  method: 'paste' | 'type' | 'none';
  chars: number;
  error?: string;
}

export interface ProviderCheck {
  provider: EngineId;
  reachable: boolean;
  detail: string;
}

/** Channels the renderer invokes on the main process. */
export interface IpcInvokeMap {
  'settings:get': { args: []; result: Settings };
  'settings:set': { args: [Partial<Settings>]; result: Settings };
  'settings:reset': { args: []; result: Settings };

  'runtime:status': { args: []; result: RuntimeStatus };
  'runtime:providers': { args: []; result: ProviderCheck[] };
  'speko:models': { args: []; result: SpekoSttModel[] };

  'dictation:start': { args: []; result: { ok: boolean; error?: string } };
  'dictation:stop': { args: [opts?: { inject?: boolean; process?: boolean }]; result: { ok: boolean; text: string; error?: string } };
  'dictation:cancel': { args: []; result: { ok: boolean } };
  'dictation:commit': {
    args: [text: string, opts?: { inject?: boolean }];
    result: InjectionResult;
  };
  'text:process': { args: [text: string]; result: DictationOutput };
  'agent:start': { args: [instruction: string]; result: AgentTask };
  'agent:tasks': { args: []; result: AgentTask[] };
  'agent:cancel': { args: [id: string]; result: boolean };
  'agent:approve': { args: [id: string, approved: boolean]; result: boolean };
  'agent:connectChrome': { args: []; result: { ok: boolean; error?: string } };
  'agent:openChromeSetup': { args: []; result: void };

  'models:list': { args: []; result: ModelStatus[] };
  'models:download': { args: [kind: 'vad' | 'asr']; result: { ok: boolean; error?: string } };

  'audio:devices': { args: []; result: MediaDeviceInfoLike[] };
  'audio:levels': { args: []; result: { supported: boolean } };

  'window:hide': { args: []; result: void };
  'window:minimize': { args: []; result: void };
  'window:show': { args: []; result: void };
  'window:setOverlay': { args: [enabled: boolean]; result: void };
  'hotkey:suspend': { args: [suspended: boolean]; result: void };

  'app:openLogs': { args: []; result: void };
  'app:version': { args: []; result: { app: string; electron: string; node: string; chrome: string } };
}

/** Structured-clone-safe stand-in for `MediaDeviceInfo`. */
export interface MediaDeviceInfoLike {
  deviceId: string;
  label: string;
  kind: string;
}

/** Channels the main process pushes to the renderer. */
export interface IpcEventMap {
  'agent:updated': AgentTask;
  'dictation:state': DictationState;
  'dictation:segment': TranscriptSegment;
  'dictation:output': DictationOutput;
  'dictation:level': AudioLevel;
  'runtime:status': RuntimeStatus;
  'models:progress': ModelStatus;
  'hotkey:trigger': { edge: 'down' | 'up' };
  'app:error': { message: string; detail?: string };
  'settings:changed': Settings;
}

export type AgentTaskStatus = 'running' | 'awaiting-approval' | 'completed' | 'failed' | 'cancelled';
export interface AgentTask {
  id: string;
  instruction: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  steps: Array<{ at: number; action: string; detail: string }>;
  approval?: { action: string; detail: string };
  result?: string;
  error?: string;
}

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;
