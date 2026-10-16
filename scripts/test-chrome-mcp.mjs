import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'vibetype-chrome-check', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.env.VIBETYPE_TEST_NODE_EXE || process.execPath,
  args: [process.env.VIBETYPE_TEST_MCP_ENTRY || path.join(root, 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'), '--autoConnect', '--no-usageStatistics'],
  env: process.env.VIBETYPE_TEST_NODE_EXE ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : undefined,
  stderr: 'pipe',
});
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>vibeType agent test</title><input aria-label="Search" /><button onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'input\').value">Go</button><p id="result"></p>');
});
let openedPageId = null;

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, { timeout: 30_000 });
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') ?? '';
  if (result.isError) throw new Error(text);
  return text;
}

try {
  await client.connect(transport);
  const text = await call('list_pages', {});
  const pages = text.split('\n').filter((line) => /^\s*\d+:\s+\S+/.test(line));
  console.log(`Connected to the user's Chrome: ${pages.length} tab(s) visible`);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await call('new_page', { url });
  const current = await call('list_pages', {});
  const line = current.split('\n').find((item) => item.includes(url));
  assert.ok(line, 'test tab should appear in the existing Chrome profile');
  openedPageId = Number(line.match(/^\s*(\d+):/)?.[1]);
  assert.ok(Number.isInteger(openedPageId));
  const snapshot = await call('take_snapshot', { pageId: openedPageId });
  const search = snapshot.split('\n').find((item) => item.includes('Search'));
  const go = snapshot.split('\n').find((item) => item.includes('Go'));
  const fieldUid = search?.match(/uid=([^\s]+)/)?.[1];
  const buttonUid = go?.match(/uid=([^\s]+)/)?.[1];
  assert.ok(fieldUid && buttonUid, 'snapshot should expose field and button IDs');
  await call('fill', { pageId: openedPageId, uid: fieldUid, value: 'vibeType' });
  await call('click', { pageId: openedPageId, uid: buttonUid });
  const after = await call('take_snapshot', { pageId: openedPageId });
  assert.match(after, /vibeType/);
  console.log('PASS existing Chrome open tab, inspect, fill, click');
} finally {
  if (openedPageId !== null) await call('close_page', { pageId: openedPageId }).catch(() => undefined);
  server.close();
  await client.close().catch(() => undefined);
}
