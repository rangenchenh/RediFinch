import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetype-runner-test-'));
process.env.VIBETYPE_AGENT_TEST_DATA = testData;
try {
  const bundle = path.join(testData, 'runner.mjs');
  await build({
    entryPoints: [path.join(root, 'src/electron/agent/runner.ts')],
    outfile: bundle, bundle: true, platform: 'node', format: 'esm',
    alias: { '@shared/types': path.join(root, 'src/shared/types.ts') },
    plugins: [{ name: 'fake-electron', setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fake' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export const app = { getPath: () => process.env.VIBETYPE_AGENT_TEST_DATA };', loader: 'js' }));
    } }],
  });
  const { AgentRunner } = await import(pathToFileURL(bundle).href);
  const settings = {
    output: { ai: { polish: { provider: 'custom', providers: { custom: { apiKey: '', model: '', baseUrl: '' } } } } },
    agent: {
      ai: { provider: 'custom', providers: { custom: { apiKey: 'agent-key', model: 'agent-model', baseUrl: 'http://127.0.0.1:1' } } },
      tools: { chromeRead: false, chromeNavigate: false, chromeInteract: 'off', localCommands: false },
    },
  };
  const chrome = { isConnected: false };
  let proposedAction = { action: 'run_command', command: 'Write-Output approved' };
  global.fetch = async (_url, opts) => {
    assert.equal(opts.headers.Authorization, 'Bearer agent-key');
    const context = JSON.parse(JSON.parse(opts.body).messages[1].content);
    const action = context.previousSteps.length
      ? { action: 'done', summary: 'Finished' }
      : proposedAction;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(action) } }] }) };
  };
  const runner = new AgentRunner(() => settings, () => {}, chrome);
  async function waitFor(id, expected) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const task = runner.list().find((item) => item.id === id);
      if (task.status === expected) return task;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${expected}`);
  }
  const disabled = runner.start('Run a harmless local command');
  const disabledResult = await waitFor(disabled.id, 'failed');
  assert.match(disabledResult.error, /run_command tool is disabled/);
  assert.equal(disabledResult.approval, undefined);

  proposedAction = { action: 'open_url', url: 'https://example.com' };
  const blockedBrowser = runner.start('Open an example page');
  assert.match((await waitFor(blockedBrowser.id, 'failed')).error, /open_url tool is disabled/);

  proposedAction = { action: 'run_command', command: 'Write-Output approved' };
  settings.agent.tools.localCommands = true;
  const denied = runner.start('Run a harmless local command');
  await waitFor(denied.id, 'awaiting-approval');
  assert.equal(runner.approve(denied.id, false), true);
  const deniedResult = await waitFor(denied.id, 'completed');
  assert.equal(deniedResult.steps.some((step) => step.action === 'run_command'), false);

  const accepted = runner.start('Run a harmless local command');
  await waitFor(accepted.id, 'awaiting-approval');
  assert.equal(runner.approve(accepted.id, true), true);
  const acceptedResult = await waitFor(accepted.id, 'completed');
  assert.match(acceptedResult.steps.find((step) => step.action === 'run_command')?.detail ?? '', /approved/);
  console.log('PASS independent Agent model, disabled tool enforcement, and local command approval');
} finally {
  if (testData.startsWith(os.tmpdir() + path.sep)) fs.rmSync(testData, { recursive: true, force: true });
}
