import type { DictationOutput, Settings } from '@shared/types';
import { AI_PROVIDERS, TARGET_LANGUAGES } from '@shared/types';

const TIMEOUT_MS = 30_000;

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim();
  if (!/^https?:\/\//i.test(base)) throw new Error('The service URL must start with http:// or https://');
  return `${base.replace(/\/+$/, '')}/${path}`;
}

async function requestJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The response body can contain sensitive request data. Keep errors short.
      throw new Error(`The service returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The service timed out after 30 seconds');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function llmTransform(text: string, settings: Settings, translate: boolean): Promise<string> {
  const selected = translate ? settings.output.ai.translate : settings.output.ai.polish;
  const { apiKey, model } = selected.providers[selected.provider];
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('Set the selected AI provider API key and model in Settings → Output');
  }
  const baseUrl = selected.provider === 'custom'
    ? selected.providers.custom.baseUrl
    : AI_PROVIDERS.find((item) => item.value === selected.provider)!.baseUrl;
  const target = TARGET_LANGUAGES.find((language) => language.value === settings.output.targetLanguage)?.label ?? settings.output.targetLanguage;
  const system = translate
    ? `Translate the user's text into ${target}. Preserve meaning, names, numbers, and formatting. Return only the translation.`
    : `Clean up this dictated text for direct insertion. Remove filler words and false starts, restore punctuation and paragraphs, and preserve meaning, names, numbers, and the original language. Do not add new facts. Return only the polished text.${settings.output.polishPrompt.trim() ? ` Additional user preference: ${settings.output.polishPrompt.trim()}` : ''}`;
  const result = await requestJson(
    endpoint(baseUrl, 'chat/completions'),
    {
      model: model.trim(),
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      stream: false,
      // Grok 4.7 defaults to high reasoning, which adds delay to short text edits.
      ...(selected.provider === 'xai' ? { reasoning_effort: 'low' } : {}),
    },
    { Authorization: `Bearer ${apiKey.trim()}` },
  ) as { choices?: Array<{ message?: { content?: string } }> };
  const output = result.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error('The AI service returned no text');
  return output;
}

async function directTranslate(text: string, settings: Settings): Promise<string> {
  const selected = settings.output.translation;
  const { apiKey, baseUrl, region } = selected.providers[selected.provider];
  if (!apiKey.trim()) throw new Error('Set the selected translation provider API key in Settings → Output');
  if (selected.provider === 'google') {
    const result = await requestJson(
      'https://translation.googleapis.com/language/translate/v2',
      { q: text, target: settings.output.targetLanguage.toLowerCase(), format: 'text' },
      { 'X-Goog-Api-Key': apiKey.trim() },
    ) as { data?: { translations?: Array<{ translatedText?: string }> } };
    const output = result.data?.translations?.[0]?.translatedText?.trim();
    if (!output) throw new Error('Google Cloud Translation returned no text');
    return decodeHtmlEntities(output);
  }
  if (selected.provider === 'azure') {
    const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
    url.searchParams.set('api-version', '3.0');
    url.searchParams.set('to', settings.output.targetLanguage.toLowerCase());
    const result = await requestJson(
      url.toString(), [{ Text: text }],
      {
        'Ocp-Apim-Subscription-Key': apiKey.trim(),
        ...(region.trim() ? { 'Ocp-Apim-Subscription-Region': region.trim() } : {}),
      },
    ) as Array<{ translations?: Array<{ text?: string }> }>;
    const output = result[0]?.translations?.[0]?.text?.trim();
    if (!output) throw new Error('Microsoft Translator returned no text');
    return output;
  }
  const deeplBase = selected.provider === 'deepl-free' ? 'https://api-free.deepl.com/v2'
    : selected.provider === 'deepl-pro' ? 'https://api.deepl.com/v2' : baseUrl;
  const result = await requestJson(
    endpoint(deeplBase, 'translate'),
    { text: [text], target_lang: settings.output.targetLanguage },
    { Authorization: `DeepL-Auth-Key ${apiKey.trim()}` },
  ) as { translations?: Array<{ text?: string }> };
  const output = result.translations?.[0]?.text?.trim();
  if (!output) throw new Error('DeepL returned no translation');
  return output;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|#39);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith('#')) {
      const point = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return match;
  });
}

/** Apply the selected output mode after STT and before insertion. */
export async function processText(raw: string, settings: Settings): Promise<DictationOutput> {
  const text = raw.trim();
  if (!text) return { raw: '', text: '', mode: settings.output.mode };
  let transformed = text;
  switch (settings.output.mode) {
    case 'polish':
      transformed = await llmTransform(text, settings, false);
      break;
    case 'translate-llm':
      transformed = await llmTransform(text, settings, true);
      break;
    case 'translate-api':
      transformed = await directTranslate(text, settings);
      break;
    case 'raw':
      break;
  }
  return { raw: text, text: transformed, mode: settings.output.mode };
}
