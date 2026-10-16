import type { AiProviderId, CloudProviderId } from './types';

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelCatalog {
  options: readonly ModelOption[];
  docsUrl: string;
}

// These are curated IDs for the endpoints this app actually calls, not every
// model a provider offers. Keep Custom available for account-specific/new IDs.
export const AI_MODEL_CATALOG: Record<Exclude<AiProviderId, 'custom'>, ModelCatalog> = {
  openai: {
    docsUrl: 'https://developers.openai.com/api/docs/models',
    options: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna · fast' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
  },
  google: {
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    options: [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · fast' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  xai: {
    docsUrl: 'https://docs.x.ai/developers/models',
    options: [
      { id: 'grok-4.3', label: 'Grok 4.3' },
      { id: 'grok-4.7', label: 'Grok 4.7' },
    ],
  },
  groq: {
    docsUrl: 'https://console.groq.com/docs/models',
    options: [
      { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B · fast' },
      { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B · preview' },
    ],
  },
  openrouter: {
    docsUrl: 'https://openrouter.ai/models',
    options: [
      { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna · fast' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
    ],
  },
  deepseek: {
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    options: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash · fast' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
};

export const STT_MODEL_CATALOG: Partial<Record<CloudProviderId, ModelCatalog>> = {
  openai: {
    docsUrl: 'https://developers.openai.com/api/docs/guides/speech-to-text',
    options: [
      { id: 'whisper-1', label: 'Whisper' },
      { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe · fast' },
      { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
      { id: 'gpt-transcribe', label: 'GPT Transcribe' },
    ],
  },
  groq: {
    docsUrl: 'https://console.groq.com/docs/models',
    options: [
      { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo · fast' },
      { id: 'whisper-large-v3', label: 'Whisper Large v3' },
    ],
  },
  siliconflow: {
    docsUrl: 'https://docs.siliconflow.cn/docs/api/audio-transcriptions-post',
    options: [
      { id: 'FunAudioLLM/SenseVoiceSmall', label: 'SenseVoice Small' },
      { id: 'TeleAI/TeleSpeechASR', label: 'TeleSpeech ASR' },
    ],
  },
  deepgram: {
    docsUrl: 'https://developers.deepgram.com/docs/models-languages-overview/',
    options: [
      { id: 'nova-3', label: 'Nova-3 · recommended' },
      { id: 'nova-3-general', label: 'Nova-3 General' },
      { id: 'nova-2', label: 'Nova-2' },
    ],
  },
  elevenlabs: {
    docsUrl: 'https://elevenlabs.io/docs/api-reference/speech-to-text/convert',
    options: [
      { id: 'scribe_v2', label: 'Scribe v2' },
      { id: 'scribe_v2_medical', label: 'Scribe v2 Medical' },
    ],
  },
  assemblyai: {
    docsUrl: 'https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model',
    options: [
      { id: 'universal-3-5-pro', label: 'Universal-3.5 Pro' },
      { id: 'universal-2', label: 'Universal-2 · multilingual' },
    ],
  },
  google: {
    docsUrl: 'https://docs.cloud.google.com/speech-to-text/docs/v1/transcription-model',
    options: [
      { id: 'latest_short', label: 'Latest Short · brief dictation' },
      { id: 'latest_long', label: 'Latest Long' },
      { id: 'command_and_search', label: 'Command & Search' },
      { id: 'default', label: 'Default' },
    ],
  },
};
