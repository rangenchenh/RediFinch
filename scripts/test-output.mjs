import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/electron/output/process.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  tsconfig: 'tsconfig.json',
});
const { processText } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const typesBundle = await build({ entryPoints: ['src/shared/types.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { DEFAULT_SETTINGS, AI_PROVIDERS } = await import(`data:text/javascript;base64,${Buffer.from(typesBundle.outputFiles[0].text).toString('base64')}`);
const mergeBundle = await build({ entryPoints: ['src/shared/merge.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { normaliseSettings } = await import(`data:text/javascript;base64,${Buffer.from(mergeBundle.outputFiles[0].text).toString('base64')}`);

test('older settings gain an independent Agent model with conservative tools', () => {
  const old = structuredClone(DEFAULT_SETTINGS);
  old.output.ai.polish.providers.openai.apiKey = 'polish-only-key';
  delete old.agent;
  const upgraded = normaliseSettings(old);
  assert.equal(upgraded.agent.ai.providers.openai.apiKey, '');
  assert.equal(upgraded.output.ai.polish.providers.openai.apiKey, 'polish-only-key');
  assert.equal(upgraded.agent.tools.chromeInteract, 'ask');
  assert.equal(upgraded.agent.tools.localCommands, false);
});

function settings(mode) {
  const result = structuredClone(DEFAULT_SETTINGS);
  result.output.mode = mode;
  result.output.targetLanguage = 'JA';
  result.output.polishPrompt = 'Use short sentences.';
  for (const selected of [result.output.ai.polish, result.output.ai.translate]) {
    selected.provider = 'custom';
    selected.providers.custom = { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' };
  }
  result.output.translation.providers['deepl-free'].apiKey = 'deepl-key';
  return result;
}

test('raw mode preserves text and does not call a network service', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected network call'); };
  try {
    assert.deepEqual(await processText('  hello world  ', settings('raw')), {
      raw: 'hello world', text: 'hello world', mode: 'raw',
    });
  } finally { globalThis.fetch = original; }
});

test('polish uses configured model and keeps the original', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Hello world.' } }] }) };
  };
  try {
    const result = await processText('um hello world', settings('polish'));
    assert.equal(result.raw, 'um hello world');
    assert.equal(result.text, 'Hello world.');
    assert.equal(request.url, 'https://example.test/v1/chat/completions');
    const body = JSON.parse(request.init.body);
    assert.equal(body.model, 'test-model');
    assert.match(body.messages[0].content, /preserve meaning/i);
    assert.match(body.messages[0].content, /Use short sentences/);
  } finally { globalThis.fetch = original; }
});

test('direct translation calls DeepL with the target language', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ translations: [{ text: 'こんにちは' }] }) };
  };
  try {
    const result = await processText('hello', settings('translate-api'));
    assert.equal(result.text, 'こんにちは');
    assert.equal(request.url, 'https://api-free.deepl.com/v2/translate');
    assert.equal(request.init.headers.Authorization, 'DeepL-Auth-Key deepl-key');
    assert.equal(JSON.parse(request.init.body).target_lang, 'JA');
  } finally { globalThis.fetch = original; }
});

test('AI translation asks for the named target language', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'こんにちは' } }] }) };
  };
  try {
    assert.equal((await processText('hello', settings('translate-llm'))).text, 'こんにちは');
    assert.match(request.messages[0].content, /Japanese/);
  } finally { globalThis.fetch = original; }
});

test('missing AI key fails clearly instead of silently inserting raw speech', async () => {
  const config = settings('translate-llm');
  config.output.ai.translate.providers.custom.apiKey = '';
  await assert.rejects(processText('hello', config), /selected AI provider API key/);
});

test('each AI preset sends to its fixed provider endpoint and keeps separate mode settings', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'done' } }] }) };
  };
  try {
    for (const preset of AI_PROVIDERS.filter((item) => item.value !== 'custom')) {
      const config = settings('translate-llm');
      config.output.ai.translate.provider = preset.value;
      config.output.ai.translate.providers[preset.value].apiKey = `${preset.value}-key`;
      config.output.ai.translate.providers[preset.value].baseUrl = 'https://wrong.example/v1';
      await processText('hello', config);
      const request = requests.at(-1);
      assert.equal(request.url, `${preset.baseUrl}/chat/completions`);
      assert.equal(request.init.headers.Authorization, `Bearer ${preset.value}-key`);
      assert.equal(JSON.parse(request.init.body).model, preset.model);
    }
    const polish = settings('polish');
    polish.output.ai.translate.providers.custom.apiKey = 'translate-only';
    await processText('hello', polish);
    assert.equal(requests.at(-1).init.headers.Authorization, 'Bearer test-key');
  } finally { globalThis.fetch = original; }
});

test('Google Cloud and Microsoft Translator use their own API formats', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => requests.length === 1
      ? ({ data: { translations: [{ translatedText: 'Tom &amp; Jerry' }] } })
      : ([{ translations: [{ text: 'こんにちは' }] }]) };
  };
  try {
    const config = settings('translate-api');
    config.output.translation.provider = 'google';
    config.output.translation.providers.google.apiKey = 'google-key';
    assert.equal((await processText('Tom & Jerry', config)).text, 'Tom & Jerry');
    assert.equal(requests[0].url, 'https://translation.googleapis.com/language/translate/v2');
    assert.equal(requests[0].init.headers['X-Goog-Api-Key'], 'google-key');
    assert.equal(JSON.parse(requests[0].init.body).target, 'ja');

    config.output.translation.provider = 'azure';
    config.output.translation.providers.azure.apiKey = 'azure-key';
    config.output.translation.providers.azure.region = 'eastasia';
    assert.equal((await processText('hello', config)).text, 'こんにちは');
    assert.match(requests[1].url, /api-version=3.0&to=ja/);
    assert.equal(requests[1].init.headers['Ocp-Apim-Subscription-Region'], 'eastasia');
    assert.deepEqual(JSON.parse(requests[1].init.body), [{ Text: 'hello' }]);
  } finally { globalThis.fetch = original; }
});

test('DeepL Pro and custom translation select their matching endpoints', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ translations: [{ text: 'bonjour' }] }) };
  };
  try {
    const config = settings('translate-api');
    config.output.translation.provider = 'deepl-pro';
    config.output.translation.providers['deepl-pro'].apiKey = 'pro-key';
    await processText('hello', config);
    config.output.translation.provider = 'custom';
    config.output.translation.providers.custom = { apiKey: 'custom-key', baseUrl: 'https://translator.example/v2', region: '' };
    await processText('hello', config);
    assert.deepEqual(urls, [
      'https://api.deepl.com/v2/translate',
      'https://translator.example/v2/translate',
    ]);
  } finally { globalThis.fetch = original; }
});

test('legacy output settings migrate without losing keys or custom URLs', () => {
  const migrated = normaliseSettings({ output: {
    llm: { baseUrl: 'https://my-model.example/v1', apiKey: 'old-ai-key', model: 'old-model' },
    deepl: { baseUrl: 'https://api.deepl.com/v2', apiKey: 'old-deepl-key' },
  } });
  assert.equal(migrated.output.ai.polish.provider, 'custom');
  assert.equal(migrated.output.ai.translate.providers.custom.baseUrl, 'https://my-model.example/v1');
  assert.equal(migrated.output.ai.polish.providers.custom.apiKey, 'old-ai-key');
  assert.equal(migrated.output.translation.provider, 'deepl-pro');
  assert.equal(migrated.output.translation.providers['deepl-pro'].apiKey, 'old-deepl-key');
  assert.equal('llm' in migrated.output, false);
  assert.equal('deepl' in migrated.output, false);
});
