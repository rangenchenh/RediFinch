import type { InjectionMethod, InjectionResult } from '@shared/types';
import { createLogger } from '../logger';
import {
  VK,
  clipboardSequenceNumber,
  getForegroundWindow,
  isKeyDown,
  isWin32Available,
  keyUp,
  readClipboardText,
  releaseModifiers,
  tapChord,
  typeUnicode,
  win32InitError,
  writeClipboardText,
} from './win32';

const log = createLogger('injector');

/**
 * Delivers transcribed text into whatever window currently has focus.
 *
 * Two strategies, because they fail in opposite directions:
 *
 *  - **paste**  put the text on the clipboard, send Ctrl+V, restore. Instant and
 *    handles any length or script. But it clobbers the user's clipboard, and
 *    apps that block synthetic Ctrl+V (some games, a few remote-desktop
 *    clients) ignore it.
 *  - **type**   send the characters as Unicode key events. No clipboard
 *    involvement and works in more places, but it is slow for long text and
 *    some editors run it through autocomplete or auto-indent.
 *
 * `auto` prefers paste and falls back to typing when the clipboard is
 * unavailable.
 */

export interface InjectOptions {
  method: InjectionMethod;
  keepInClipboard: boolean;
  restoreClipboard: boolean;
  trailingSpace: boolean;
}

interface SelfWindowInfo {
  /** Window handles belonging to this app, which must never receive injected text. */
  hwnds: Set<string>;
  /** Our own pid, used to detect focus landing on a renderer window. */
  pid: number;
}

let selfInfo: SelfWindowInfo = { hwnds: new Set(), pid: -1 };

/**
 * Normalise a window handle for comparison. koffi hands back a BigInt for
 * `void*`, and Electron's `getNativeWindowHandle()` is a Buffer, so both sides
 * are reduced to the same decimal string before they meet.
 */
function normaliseHwnd(value: unknown): string | null {
  try {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return BigInt(Math.trunc(value)).toString();
    if (Buffer.isBuffer(value)) return value.readBigUInt64LE(0).toString();
    if (typeof value === 'string') return BigInt(value).toString();
  } catch {
    return null;
  }
  return null;
}

/** Teach the injector about our own windows so we never type into ourselves. */
export function registerSelfWindows(hwndValues: unknown[], pid: number): void {
  const normalised = hwndValues
    .map(normaliseHwnd)
    .filter((h): h is string => h !== null);
  selfInfo = { hwnds: new Set(normalised), pid };
  log.debug(`self windows: pid=${pid} hwnds=${[...selfInfo.hwnds].join(',')}`);
}

/**
 * True when the foreground window belongs to this app.
 *
 * The pid check is the reliable half; the handle set is a backstop for the case
 * where our process hosts several windows and one is a child of a different
 * process (Electron's GPU process, for instance).
 */
export function isSelfFocused(): boolean {
  const fg = getForegroundWindow();
  if (!fg) return false;

  // Same process is conclusive on its own.
  if (fg.pid === selfInfo.pid) return true;

  const hwnd = normaliseHwnd(fg.hwnd);
  return hwnd !== null && selfInfo.hwnds.has(hwnd);
}

const PASTE_DELAY_MS = 35;
const RESTORE_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function injectText(
  text: string,
  opts: InjectOptions,
): Promise<InjectionResult> {
  const payload = opts.trailingSpace && !/\s$/.test(text) ? `${text} ` : text;

  if (!payload.trim()) {
    return { ok: false, method: 'none', chars: 0, error: 'nothing to insert' };
  }

  if (!isWin32Available()) {
    return {
      ok: false,
      method: 'none',
      chars: 0,
      error: `Windows input layer unavailable (${win32InitError() ?? 'unknown'})`,
    };
  }

  if (isSelfFocused()) {
    log.warn('refusing to inject into our own window');
    return {
      ok: false,
      method: 'none',
      chars: 0,
      error: 'RediFinch is focused; switch to the app you want to dictate into',
    };
  }

  // A stuck modifier from the push-to-talk chord would corrupt Ctrl+V.
  releaseModifiers();
  await sleep(10);

  const wantPaste = opts.method === 'auto' || opts.method === 'paste';
  if (wantPaste) {
    const result = await injectViaPaste(payload, opts);
    if (result.ok) return result;
    if (opts.method === 'paste') return result;
    log.warn(`paste injection failed (${result.error}); falling back to typing`);
  }

  return injectViaTyping(payload);
}

async function injectViaPaste(
  payload: string,
  opts: InjectOptions,
): Promise<InjectionResult> {
  const hadText = readClipboardText();
  const seqBefore = clipboardSequenceNumber();

  if (!writeClipboardText(payload)) {
    return {
      ok: false,
      method: 'paste',
      chars: 0,
      error: 'could not write to the clipboard',
    };
  }

  // Give the clipboard owner (often another process) a moment to post
  // WM_CLIPBOARDUPDATE before the target app reads it.
  await sleep(PASTE_DELAY_MS);

  if (!tapChord([VK.CONTROL], VK.V)) {
    return { ok: false, method: 'paste', chars: 0, error: 'SendInput rejected Ctrl+V' };
  }

  await sleep(RESTORE_DELAY_MS);

  if (opts.keepInClipboard) {
    return { ok: true, method: 'paste', chars: payload.length };
  }

  // Restoring is only safe if nobody else changed the clipboard in the
  // meantime — otherwise we would delete what the user just copied.
  const seqAfter = clipboardSequenceNumber();
  if (opts.restoreClipboard && hadText !== null && seqAfter !== seqBefore) {
    // Our own write bumped the sequence by at least one; anything beyond that
    // means a third party intervened.
    if (seqAfter - seqBefore <= 1) {
      writeClipboardText(hadText);
    } else {
      log.info('clipboard changed by another app; leaving it alone');
    }
  } else if (hadText === null && seqAfter - seqBefore <= 1) {
    // The clipboard held no text before us — it held an image or nothing.
    // We cannot faithfully restore that, so at least stop lying about it being
    // the user's previous text.
    log.debug('clipboard held non-text content; not restored');
  }

  return { ok: true, method: 'paste', chars: payload.length };
}

async function injectViaTyping(payload: string): Promise<InjectionResult> {
  // Typing while a modifier is held would produce the wrong characters.
  if (isKeyDown(VK.CONTROL) || isKeyDown(VK.MENU)) {
    releaseModifiers();
    await sleep(15);
  }

  const sent = typeUnicode(payload);
  if (sent === 0) {
    return { ok: false, method: 'type', chars: 0, error: 'SendInput rejected the keystrokes' };
  }
  return { ok: true, method: 'type', chars: payload.length };
}

/**
 * Turn spoken punctuation into symbols. Mixed zh/en because the dictation
 * languages are mixed — the user may say either word in the same sentence.
 */
const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u53e5\u53f7|\u3002)\s*/g, '\u3002'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u9017\u53f7|\uff0c)\s*/g, '\uff0c'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u95ee\u53f7|\uff1f)\s*/g, '\uff1f'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u611f\u53f9\u53f7|\u53f9\u53f7|\uff01)\s*/g, '\uff01'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u987f\u53f7|\u3001)\s*/g, '\u3001'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u5192\u53f7|\uff1a)\s*/g, '\uff1a'],
  [/(?<=[\u4e00-\u9fff\w])\s*(?:\u5206\u53f7|\uff1b)\s*/g, '\uff1b'],
  [/\bperiod\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (?:mark|point)\b/gi, '!'],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
  [/\bnew ?line\b/gi, '\n'],
  [/\bnew ?paragraph\b/gi, '\n\n'],
];

export function applySpokenPunctuation(text: string): string {
  let out = text;
  for (const [re, replacement] of SPOKEN_PUNCTUATION) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** Prepend a space when joining onto existing text that lacks one. */
export function smartJoin(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  const needsSpace = /[\u4e00-\u9fff]$/.test(previous)
    ? false // Chinese does not use inter-word spaces
    : !/\s$/.test(previous) && !/^[\s\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b,.!?]/.test(next);
  return needsSpace ? `${previous} ${next}` : previous + next;
}
