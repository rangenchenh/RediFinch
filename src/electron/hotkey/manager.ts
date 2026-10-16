import { app, globalShortcut } from 'electron';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { createLogger } from '../logger';
import { parseHotkey, type ParsedHotkey } from './keys';

const log = createLogger('hotkey');

export interface HotkeyCallbacks {
  onDown: (id: string) => void;
  onSwitch: (id: string) => void;
  onUp: (id: string) => void;
  /** Fired when the hook could not be used and we degraded to globalShortcut. */
  onDegraded: (reason: string) => void;
}

export interface HotkeyState {
  registered: boolean;
  /** `hook` is true push-to-talk; `accelerator` is a degraded toggle. */
  mode: 'hook' | 'accelerator' | 'none';
  warning?: string;
}

const READY_TIMEOUT_MS = 4000;
const MAX_RESTARTS = 5;
const RESTART_BACKOFF_MS = 1500;

/**
 * Owns the push-to-talk trigger.
 *
 * Preferred path is a `WH_KEYBOARD_LL` hook in a child process, which is the
 * only way to get a true key-DOWN edge for a chord like Alt+Space — holding a
 * key is what makes push-to-talk feel right, and Electron's `globalShortcut`
 * only reports presses, not releases.
 *
 * If the hook cannot start (policy restrictions, another hook swallowing the
 * key, AV interference) we degrade to a `globalShortcut` toggle and say so in
 * the UI rather than failing silently.
 */
/** stdin is `ignore`, so stdout/stderr are the only pipes we hold. */
type HookChild = ChildProcessByStdio<null, Readable, Readable>;

export class HotkeyManager {
  private child: HookChild | null = null;
  private parsed: Array<{ id: string; hotkey: ParsedHotkey }> = [];
  private callbacks: HotkeyCallbacks;
  private restarts = 0;
  private disposed = false;
  private ready = false;
  private pendingSignature: string | null = null;
  private state: HotkeyState = { registered: false, mode: 'none' };

  constructor(callbacks: HotkeyCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): HotkeyState {
    return this.state;
  }

  /**
   * Point the manager at an accelerator. Safe to call repeatedly; an unchanged
   * accelerator is a no-op so settings churn does not restart the hook.
   */
  async register(bindings: Record<string, string>): Promise<HotkeyState> {
    const signature = JSON.stringify(bindings);
    if (this.pendingSignature === signature && this.state.registered) {
      return this.state;
    }
    this.pendingSignature = signature;
    await this.disposeChild();
    globalShortcut.unregisterAll();

    const primary = parseHotkey(bindings.current ?? '');
    if (!primary || (primary.isModifierOnly && primary.modifiers.length < 2)) {
      this.state = {
        registered: false,
        mode: 'none',
        warning: `"${bindings.current}" is not a usable hotkey`,
      };
      log.warn(this.state.warning);
      return this.state;
    }
    const parsed: Array<{ id: string; hotkey: ParsedHotkey }> = [{ id: 'current', hotkey: primary }];
    const seen = new Set([chordKey(primary)]);
    const ignored: string[] = [];
    for (const [id, accelerator] of Object.entries(bindings)) {
      if (id === 'current' || !accelerator?.trim()) continue;
      const hotkey = parseHotkey(accelerator);
      if (!hotkey || (hotkey.isModifierOnly && hotkey.modifiers.length < 2)) {
        ignored.push(`${id}: invalid shortcut`);
        continue;
      }
      const chord = chordKey(hotkey);
      if (seen.has(chord)) {
        ignored.push(`${id}: shortcut already used`);
        continue;
      }
      seen.add(chord);
      parsed.push({ id, hotkey });
    }
    this.parsed = parsed;
    const warning = ignored.length ? `Ignored ${ignored.join(', ')}.` : undefined;

    // The hook is the preferred path unconditionally: it is the only way to get
    // a true hold-to-talk release edge, including for modifier-only chords like
    // Ctrl+Win, where "all modifiers held" is the down edge.
    const ok = await this.startHook(parsed, warning);
    if (ok) return this.state;

    return this.startAcceleratorFallback(parsed, 'keyboard hook unavailable', warning);
  }

  private async startHook(parsed: Array<{ id: string; hotkey: ParsedHotkey }>, warning?: string): Promise<boolean> {
    const script = path.join(__dirname, 'hotkey-hook.cjs');
    const encoded = Buffer.from(JSON.stringify(parsed.map(({ id, hotkey }) => ({ id, vk: hotkey.vk, mods: hotkey.modifiers })))).toString('base64url');

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let child: HookChild;

      try {
        child = spawn(process.execPath, [script, '--bindings', encoded], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        }) as HookChild;
      } catch (err) {
        log.error('failed to spawn hook child:', err);
        resolve(false);
        return;
      }

      this.child = child;
      let buffer = '';

      const finish = (ok: boolean, warning?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = ok;
        if (ok) {
          this.state = { registered: true, mode: 'hook', warning };
          log.info(`keyboard hook active for ${parsed.map((binding) => binding.hotkey.accelerator).join(', ')}`);
        }
        resolve(ok);
        if (!ok && warning) log.warn(warning);
      };

      const timer = setTimeout(() => {
        finish(false, 'hook child did not report ready in time');
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }, READY_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let msg: { type?: string; id?: string; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            log.debug(`hook child said: ${line}`);
            continue;
          }
          if (msg.type === 'ready') {
            finish(true);
          } else if (msg.type === 'down') {
            this.callbacks.onDown(msg.id ?? 'current');
          } else if (msg.type === 'switch') {
            this.callbacks.onSwitch(msg.id ?? 'current');
          } else if (msg.type === 'up') {
            this.callbacks.onUp(msg.id ?? 'current');
          } else if (msg.type === 'fatal') {
            finish(false, `hook child failed: ${msg.error}`);
          }
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        const text = chunk.trim();
        if (text) log.debug(`hook stderr: ${text}`);
      });

      child.on('error', (err) => {
        finish(false, `hook child error: ${err.message}`);
      });

      child.on('exit', (code, signal) => {
        const wasReady = this.ready;
        this.ready = false;
        this.child = null;
        if (!settled) {
          finish(false, `hook child exited early (code=${code} signal=${signal})`);
          return;
        }
        if (this.disposed) return;
        if (wasReady) {
          log.warn(`hook child exited (code=${code}); restarting`);
          this.rescheduleRestart();
        }
      });
    });
  }

  private rescheduleRestart(): void {
    if (this.disposed) return;
    if (restartsExhausted(this.restarts)) {
      this.callbacks.onDegraded('keyboard hook kept crashing');
      void this.startAcceleratorFallback(
        this.parsed,
        'keyboard hook kept crashing',
      );
      return;
    }
    this.restarts++;
    // Back off linearly; a hook that dies instantly every time is a policy
    // problem, not a transient one, and hammering it just burns CPU.
    const delay = RESTART_BACKOFF_MS * this.restarts;
    setTimeout(() => {
      if (this.disposed || !this.parsed.length) return;
      void this.startHook(this.parsed);
    }, delay);
  }

  private async startAcceleratorFallback(
    parsed: Array<{ id: string; hotkey: ParsedHotkey }>,
    reason: string,
    extraWarning?: string,
  ): Promise<HotkeyState> {
    let registered = false;
    const failed: string[] = [];
    for (const { id, hotkey } of parsed) {
      try {
        const ok = globalShortcut.register(hotkey.accelerator, () => this.callbacks.onDown(id));
        if (id === 'current') registered = ok;
        if (!ok) failed.push(hotkey.accelerator);
      } catch (err) {
        failed.push(hotkey.accelerator);
        log.error('globalShortcut.register threw:', err);
      }
    }

    this.state = {
      registered,
      mode: registered ? 'accelerator' : 'none',
      warning: (registered
        ? `Push-to-talk unavailable (${reason}). Using press-to-start / press-to-stop toggle.`
        : `Could not register ${parsed[0]?.hotkey.accelerator} (${reason}).`) +
        (failed.length ? ` Failed: ${failed.join(', ')}.` : '') + (extraWarning ? ` ${extraWarning}` : ''),
    };
    log.warn(this.state.warning ?? 'hotkey unavailable');
    if (registered) this.callbacks.onDegraded(this.state.warning!);
    return this.state;
  }

  private async disposeChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (!child) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once('exit', finish);
      try {
        child.kill();
      } catch {
        finish();
      }
      // A wedged child must not block the whole settings save.
      setTimeout(finish, 800);
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.disposeChild();
    globalShortcut.unregisterAll();
  }
}

function restartsExhausted(count: number): boolean {
  return count >= MAX_RESTARTS;
}

function chordKey(hotkey: ParsedHotkey): string {
  return `${hotkey.vk}:${[...hotkey.modifiers].sort((a, b) => a - b).join(',')}`;
}

/** Resolve the path of the compiled hook script inside the packaged app. */
export function resolveHookScriptCandidates(): string[] {
  const candidates = [path.join(__dirname, 'hotkey-hook.cjs')];
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'hotkey-hook.cjs'),
    );
  }
  return candidates;
}
