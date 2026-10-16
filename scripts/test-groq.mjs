import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/electron/stt/cloud.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  tsconfig: 'tsconfig.json',
  plugins: [{
    name: 'electron-app-stub',
    setup(plugin) {
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const app = { getPath: () => "." };', loader: 'js' }));
    },
  }],
});
const { OpenAiCompatibleEngine } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('Groq sends audio to the documented OpenAI-compatible endpoint', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ text: 'Hello from Groq.' }) };
  };
  try {
    const engine = new OpenAiCompatibleEngine('groq', 'Groq Whisper', 'groq');
    await engine.start({
      cloud: { groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', model: 'whisper-large-v3-turbo' } },
      language: { primary: 'en', prompt: '' },
    });
    await engine.pushAudio(new Float32Array(4000));
    assert.deepEqual(await engine.finishUtterance(), [{ text: 'Hello from Groq.', final: true }]);
    assert.equal(request.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(request.init.headers.authorization, 'Bearer test-key');
    assert.equal(request.init.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(request.init.body.get('language'), 'en');
    assert.equal(request.init.body.get('file').type, 'audio/wav');
    await engine.dispose();
  } finally { globalThis.fetch = original; }
});
