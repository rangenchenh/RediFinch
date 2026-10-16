import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SETUP_URL = 'chrome://inspect/#remote-debugging';

function mcpEntrypoint(): string {
  const relative = path.join('node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js');
  const candidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', relative),
    path.join(app.getAppPath(), relative),
    path.join(process.cwd(), relative),
  ];
  const entry = candidates.find((candidate) => fs.existsSync(candidate));
  if (!entry) throw new Error('Chrome DevTools MCP is missing from the installation');
  return entry;
}

function textResult(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? '';
  if (result.isError) throw new Error(text.slice(0, 500) || 'Chrome DevTools MCP call failed');
  return text;
}

function parsePages(text: string): Array<{ id: number; url: string; selected: boolean }> {
  return text.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+):\s+(\S+)(.*)$/);
    return match ? [{ id: Number(match[1]), url: match[2], selected: /\[selected\]/i.test(match[3]) }] : [];
  });
}

export class ChromeTools {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private pageId: number | null = null;

  get isConnected(): boolean { return this.client !== null; }

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.openConnection().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    const client = new Client({ name: 'saykin-agent', version: app.getVersion() });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpEntrypoint(), '--autoConnect', '--no-usageStatistics'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' } as Record<string, string>,
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      // The first tool call connects to the existing Chrome profile and may ask
      // for confirmation in Chrome. It never launches an isolated browser.
      textResult(await client.callTool({ name: 'list_pages', arguments: {} }, { timeout: 90_000 }));
      this.client = client;
      this.transport = transport;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new Error(`Could not connect to your running Chrome. Open ${SETUP_URL}, enable Remote Debugging, then allow the connection prompt. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.pageId = null;
    const client = this.client;
    this.client = null;
    this.transport = null;
    if (client) await client.close().catch(() => undefined);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<string> {
    await this.connect();
    try {
      return textResult(await this.client!.callTool({ name, arguments: args }, { timeout: 60_000 }));
    } catch (error) {
      throw new Error(`Chrome ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listPages(): Promise<Array<{ id: number; url: string; selected: boolean }>> {
    return parsePages(await this.call('list_pages', {}));
  }

  async snapshot(): Promise<{ pageId: number | null; pages: Array<{ id: number; url: string; selected: boolean }>; text: string }> {
    const pages = await this.listPages();
    if (!pages.length) return { pageId: null, pages, text: 'No Chrome tabs are open.' };
    if (this.pageId === null || !pages.some((page) => page.id === this.pageId)) {
      this.pageId = pages.find((page) => page.selected)?.id ?? pages[0].id;
    }
    const text = await this.call('take_snapshot', { pageId: this.pageId });
    return { pageId: this.pageId, pages, text: text.slice(0, 14_000) };
  }

  async openUrl(input: string): Promise<string> {
    const value = input.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP and HTTPS URLs without credentials are supported');
    await this.call('new_page', { url: url.toString() });
    const pages = await this.listPages();
    this.pageId = pages.find((page) => page.url === url.toString())?.id ?? pages.find((page) => page.selected)?.id ?? null;
    return url.toString();
  }

  async selectPage(id: number): Promise<void> {
    const pages = await this.listPages();
    if (!pages.some((page) => page.id === id)) throw new Error('Chrome tab not found');
    await this.call('select_page', { pageId: id, bringToFront: true });
    this.pageId = id;
  }

  async click(uid: string): Promise<void> {
    if (this.pageId === null) throw new Error('No Chrome tab selected');
    await this.call('click', { pageId: this.pageId, uid });
  }

  async fill(uid: string, value: string): Promise<void> {
    if (this.pageId === null) throw new Error('No Chrome tab selected');
    await this.call('fill', { pageId: this.pageId, uid, value });
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    if (this.pageId === null) throw new Error('No Chrome tab selected');
    await this.call('press_key', { pageId: this.pageId, key: direction === 'down' ? 'PageDown' : 'PageUp' });
  }

  openSetup(): void {
    const candidates = [
      path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const chrome = candidates.find((candidate) => fs.existsSync(candidate));
    if (!chrome) throw new Error('Google Chrome is not installed in a standard location');
    const child = spawn(chrome, [SETUP_URL], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  }
}
