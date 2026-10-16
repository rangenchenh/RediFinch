import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/shared/model-catalog.ts', 'src/shared/types.ts', 'src/shared/merge.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  outdir: 'out',
});
const modules = {};
for (const file of bundled.outputFiles) {
  const name = file.path.replaceAll('\\', '/').split('/').at(-1);
  modules[name] = await import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`);
}
const { AI_MODEL_CATALOG, STT_MODEL_CATALOG } = modules['model-catalog.js'];
const { AI_PROVIDERS, DEFAULT_SETTINGS } = modules['types.js'];
const { normaliseSettings } = modules['merge.js'];

test('each named AI provider offers its default model and Custom remains separate', () => {
  for (const provider of AI_PROVIDERS) {
    if (provider.value === 'custom') continue;
    const catalog = AI_MODEL_CATALOG[provider.value];
    assert.ok(catalog, `missing ${provider.value} catalog`);
    assert.ok(catalog.options.some(({ id }) => id === provider.model), `missing ${provider.value} default ${provider.model}`);
    assert.equal(new Set(catalog.options.map(({ id }) => id)).size, catalog.options.length);
  }
});

test('every configurable STT model has a catalog entry and its default is selectable', () => {
  for (const [provider, config] of Object.entries(DEFAULT_SETTINGS.cloud)) {
    if (!('model' in config) || provider === 'speko') continue; // Speko uses a live account catalog.
    const catalog = STT_MODEL_CATALOG[provider];
    assert.ok(catalog, `missing ${provider} catalog`);
    assert.ok(catalog.options.some(({ id }) => id === config.model), `missing ${provider} default ${config.model}`);
    assert.equal(new Set(catalog.options.map(({ id }) => id)).size, catalog.options.length);
  }
});

test('removed STT defaults migrate to selectable replacements', () => {
  const saved = structuredClone(DEFAULT_SETTINGS);
  saved.cloud.elevenlabs.model = 'scribe_v1';
  saved.cloud.assemblyai.model = 'universal';
  const migrated = normaliseSettings(saved);
  assert.equal(migrated.cloud.elevenlabs.model, 'scribe_v2');
  assert.equal(migrated.cloud.assemblyai.model, 'universal-2');
});
