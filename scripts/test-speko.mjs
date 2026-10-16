import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/electron/stt/speko.ts'],
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
const { SpekoEngine, listSpekoModels } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('Speko sends the ordered Router multipart contract and reads transcript', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ text: 'Hello from Speko.' }) };
  };
  try {
    const engine = new SpekoEngine();
    await engine.start({ cloud: { speko: { apiKey: 'test-key' } }, language: { primary: 'en' } });
    await engine.pushAudio(new Float32Array(4000));
    assert.deepEqual(await engine.finishUtterance(), [{ text: 'Hello from Speko.', final: true }]);
    assert.equal(request.url, 'https://router.speko.dev/v1/stt/transcriptions');
    assert.equal(request.init.headers.authorization, 'Bearer test-key');
    assert.match(request.init.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
    const parts = [...request.init.body.entries()];
    assert.deepEqual(parts.map(([name]) => name), ['request', 'audio']);
    assert.deepEqual(JSON.parse(await parts[0][1].text()), { routing: { mode: 'auto', objective: 'latency' }, language: 'en' });
    assert.equal(parts[1][1].type, 'audio/wav');
    await engine.dispose();
  } finally { globalThis.fetch = original; }
});

test('Speko skips very short audio without a request', async () => {
  const engine = new SpekoEngine();
  await engine.start({ cloud: { speko: { apiKey: 'test-key' } }, language: { primary: 'zh' } });
  await engine.pushAudio(new Float32Array(1000));
  assert.deepEqual(await engine.finishUtterance(), []);
  await engine.dispose();
});

test('Speko pins the selected provider and model in explicit mode', async () => {
  const original = globalThis.fetch;
  let routing;
  globalThis.fetch = async (_url, init) => {
    const parts = [...init.body.entries()];
    routing = JSON.parse(await parts[0][1].text()).routing;
    return { ok: true, json: async () => ({ text: 'Pinned model output.' }) };
  };
  try {
    const engine = new SpekoEngine();
    await engine.start({ cloud: { speko: { apiKey: 'test-key', routingMode: 'explicit', provider: 'deepgram', model: 'nova-3' } }, language: { primary: 'zh' } });
    await engine.pushAudio(new Float32Array(4000));
    assert.deepEqual(await engine.finishUtterance(), [{ text: 'Pinned model output.', final: true }]);
    assert.deepEqual(routing, { mode: 'explicit', provider: 'deepgram', model: 'nova-3' });
    await engine.dispose();
  } finally { globalThis.fetch = original; }
});

test('Speko model list uses the account catalog and keeps only batch STT routes', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ models: [
      { kind: 'stt', provider: 'deepgram', id: 'nova-3' },
      { kind: 'stt', provider: 'deepgram', id: 'nova-3' },
      { kind: 'llm', provider: 'openai', id: 'gpt-6-luna' },
      { kind: 'stt', provider: 'openai', id: 'gpt-transcribe' },
    ] }) };
  };
  try {
    assert.deepEqual(await listSpekoModels('test-key'), [
      { provider: 'deepgram', id: 'nova-3' },
      { provider: 'openai', id: 'gpt-transcribe' },
    ]);
    assert.equal(request.url, 'https://router.speko.dev/v1/models?path=batch');
    assert.equal(request.init.headers.authorization, 'Bearer test-key');
  } finally { globalThis.fetch = original; }
});
