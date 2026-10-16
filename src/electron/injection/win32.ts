import koffi from 'koffi';
import { createLogger } from '../logger';

const log = createLogger('win32');

/**
 * Thin, typed wrapper over the Win32 calls needed to (a) find out what window
 * has focus and (b) synthesise keystrokes into it.
 *
 * Everything is loaded lazily and defensively: if any export is missing we mark
 * the whole layer unavailable and the app falls back to a clearly-reported
 * degraded mode rather than crashing on launch.
 */

// ---------------------------------------------------------------- constants

export const VK = {
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  LWIN: 0x5b,
  RWIN: 0x5c,
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  INSERT: 0x2d,
  DELETE: 0x2e,
  A: 0x41,
  C: 0x43,
  V: 0x56,
  X: 0x58,
} as const;

const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const INPUT_KEYBOARD = 1;

const SMTO_ABORTIFHUNG = 0x0002;
const WM_GETTEXT = 0x000d;
const WM_GETTEXT_LENGTH = 0x000e;

// ------------------------------------------------------------- koffi setup

interface Win32Api {
  GetForegroundWindow(): unknown;
  GetWindowThreadProcessId(hwnd: unknown, pidOut: Uint32Array): number;
  GetClassNameW(hwnd: unknown, out: Uint16Array, max: number): number;
  GetWindowTextW(hwnd: unknown, out: Uint16Array, max: number): number;
  SendInput(count: number, inputs: unknown, size: number): number;
  OpenClipboard(hwnd: unknown): boolean;
  CloseClipboard(): boolean;
  EmptyClipboard(): boolean;
  GetClipboardData(format: number): unknown;
  SetClipboardData(format: number, handle: unknown): unknown;
  IsClipboardFormatAvailable(format: number): boolean;
  GetClipboardSequenceNumber(): number;
  GlobalAlloc(flags: number, bytes: number): unknown;
  GlobalLock(handle: unknown): unknown;
  GlobalUnlock(handle: unknown): boolean;
  GlobalFree(handle: unknown): unknown;
  SendMessageTimeoutW(
    hwnd: unknown,
    msg: number,
    wParam: number,
    /** A Uint16Array for WM_GETTEXT, or a plain number for WM_GETTEXTLENGTH. */
    lParam: unknown,
    flags: number,
    timeout: number,
    result: Uint32Array,
  ): unknown;
  GetAsyncKeyState(vKey: number): number;
  AttachThreadInput(a: number, b: number, attach: boolean): boolean;
  GetCurrentThreadId(): number;
  keybd_event(vKey: number, scan: number, flags: number, extra: number): void;
}

let api: Win32Api | null = null;
let initError: string | null = null;

/**
 * The INPUT struct. On x64 it is 40 bytes: a 4-byte type followed by 4 bytes of
 * padding, then the largest union member (MOUSEINPUT at 32 bytes). Getting this
 * size wrong makes SendInput silently reject every call, so it is asserted
 * below rather than trusted.
 */
const MOUSEINPUT_SIZE = 32;
const INPUT_SIZE = 40;

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const INPUT_UNION = koffi.union('INPUT_UNION', {
  ki: KEYBDINPUT,
  // The mouse branch only exists to get the union size right.
  padding: koffi.array('uint8', MOUSEINPUT_SIZE),
});

const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: INPUT_UNION,
});

function init(): Win32Api | null {
  if (api) return api;
  if (initError) return null;

  if (process.platform !== 'win32') {
    initError = `unsupported platform: ${process.platform}`;
    log.warn(initError);
    return null;
  }

  try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    const built: Win32Api = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)',
      ),
      GetClassNameW: user32.func(
        'int __stdcall GetClassNameW(void* hwnd, _Out_ uint16* buf, int max)',
      ),
      GetWindowTextW: user32.func(
        'int __stdcall GetWindowTextW(void* hwnd, _Out_ uint16* buf, int max)',
      ),
      SendInput: user32.func(
        'uint32 __stdcall SendInput(uint32 count, const INPUT* inputs, int size)',
      ),
      OpenClipboard: user32.func('bool __stdcall OpenClipboard(void* hwnd)'),
      CloseClipboard: user32.func('bool __stdcall CloseClipboard()'),
      EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()'),
      GetClipboardData: user32.func('void* __stdcall GetClipboardData(uint32 format)'),
      SetClipboardData: user32.func(
        'void* __stdcall SetClipboardData(uint32 format, void* handle)',
      ),
      IsClipboardFormatAvailable: user32.func(
        'bool __stdcall IsClipboardFormatAvailable(uint32 format)',
      ),
      GetClipboardSequenceNumber: user32.func(
        'uint32 __stdcall GetClipboardSequenceNumber()',
      ),
      GlobalAlloc: kernel32.func('void* __stdcall GlobalAlloc(uint32 flags, uintptr bytes)'),
      GlobalLock: kernel32.func('void* __stdcall GlobalLock(void* handle)'),
      GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void* handle)'),
      GlobalFree: kernel32.func('void* __stdcall GlobalFree(void* handle)'),
      // lParam is typed as a uint16 pointer rather than `void*` so koffi accepts
      // a Uint16Array directly and marshals it as the buffer Windows fills.
      SendMessageTimeoutW: user32.func(
        'void* __stdcall SendMessageTimeoutW(void* hwnd, uint32 msg, uintptr wParam, _In_ uint16* lParam, uint32 flags, uint32 timeout, _Out_ uintptr* result)',
      ),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      AttachThreadInput: user32.func(
        'bool __stdcall AttachThreadInput(uint32 from, uint32 to, bool attach)',
      ),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
      keybd_event: user32.func(
        'void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)',
      ),
    };

    if (koffi.sizeof(INPUT) !== INPUT_SIZE) {
      throw new Error(
        `INPUT struct is ${koffi.sizeof(INPUT)} bytes, expected ${INPUT_SIZE}`,
      );
    }

    api = built;
    log.info('win32 layer ready');
    return api;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    log.error('win32 layer unavailable:', err);
    return null;
  }
}

export function isWin32Available(): boolean {
  return init() !== null;
}

export function win32InitError(): string | null {
  init();
  return initError;
}

// -------------------------------------------------------------- window info

function readWideBuffer(
  fn: (hwnd: unknown, out: Uint16Array, max: number) => number,
  hwnd: unknown,
  size = 512,
): string {
  const buf = new Uint16Array(size);
  const n = fn(hwnd, buf, size);
  if (!n) return '';
  return Buffer.from(buf.buffer, 0, Math.min(n, size) * 2)
    .toString('utf16le')
    .replace(/\0[\s\S]*$/, '');
}

export interface ForegroundWindow {
  hwnd: unknown;
  pid: number;
  title: string;
  className: string;
}

export function getForegroundWindow(): ForegroundWindow | null {
  const a = init();
  if (!a) return null;
  const hwnd = a.GetForegroundWindow();
  if (!hwnd) return null;

  const pidBuf = new Uint32Array(1);
  a.GetWindowThreadProcessId(hwnd, pidBuf);

  return {
    hwnd,
    pid: pidBuf[0],
    title: readWideBuffer(a.GetWindowTextW, hwnd),
    className: readWideBuffer(a.GetClassNameW, hwnd, 256),
  };
}

/**
 * Some apps (notably Chromium/Electron ones) do not respond to
 * `GetWindowTextW`; the real text is in the child window that actually holds
 * focus, or only retrievable via `WM_GETTEXT`. We try the cheap path first and
 * fall back to a timeout-guarded `SendMessage`.
 *
 * Returns `null` when the title cannot be determined at all — callers must
 * treat that as "unknown", never as "empty window".
 */
export function getWindowTitle(hwnd: unknown): string | null {
  const a = init();
  if (!a || !hwnd) return null;

  const direct = readWideBuffer(a.GetWindowTextW, hwnd);
  if (direct) return direct;

  const result = new Uint32Array(1);
  const ok = a.SendMessageTimeoutW(
    hwnd,
    WM_GETTEXT_LENGTH,
    0,
    0,
    SMTO_ABORTIFHUNG,
    120,
    result,
  );
  // SendMessageTimeout returns 0 on failure/timeout; the length arrives in result.
  if (!ok || !result[0]) return null;

  const len = Math.min(result[0] + 1, 1024);
  const buf = new Uint16Array(len);
  // koffi marshals a TypedArray as a pointer to its backing store, so the
  // buffer is filled in place by the target window.
  const got = a.SendMessageTimeoutW(hwnd, WM_GETTEXT, len, buf, SMTO_ABORTIFHUNG, 120, result);
  if (!got) return null;

  const text = Buffer.from(buf.buffer).toString('utf16le').replace(/\0[\s\S]*$/, '');
  return text || null;
}

// ------------------------------------------------------------ key synthesis

function makeKeyEvent(
  wVk: number,
  wScan: number,
  flags: number,
): Record<string, unknown> {
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk, wScan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
  };
}

function sendInputs(events: Array<Record<string, unknown>>): number {
  const a = init();
  if (!a || events.length === 0) return 0;
  // koffi marshals the JS array into a contiguous INPUT[] for us.
  return a.SendInput(events.length, events, INPUT_SIZE);
}

/**
 * Press or release a virtual key. Used for modifier combos (Ctrl+V, Ctrl+C).
 */
export function keyDown(vk: number): boolean {
  return sendInputs([makeKeyEvent(vk, 0, 0)]) === 1;
}

export function keyUp(vk: number): boolean {
  return sendInputs([makeKeyEvent(vk, 0, KEYEVENTF_KEYUP)]) === 1;
}

/**
 * Type a whole string as Unicode keystrokes, bypassing the keyboard layout.
 *
 * `KEYEVENTF_UNICODE` with `wVk = 0` sends the literal UTF-16 code unit, so
 * Chinese text lands correctly regardless of the active IME or layout. Anything
 * outside the BMP is sent as a surrogate pair, which is exactly how a real
 * keyboard would deliver it.
 */
export function typeUnicode(text: string, perChunk = 64): number {
  const a = init();
  if (!a || !text) return 0;

  let sent = 0;
  const units: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp);
    }
  }

  // Batching keeps each SendInput call small so a slow target app posts its
  // message queue between chunks instead of backing up.
  for (let i = 0; i < units.length; i += perChunk) {
    const slice = units.slice(i, i + perChunk);
    const events: Array<Record<string, unknown>> = [];
    for (const u of slice) {
      events.push(makeKeyEvent(0, u, KEYEVENTF_UNICODE));
      events.push(makeKeyEvent(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    sent += sendInputs(events);
  }
  return sent;
}

/** Tap a chord: modifiers down, key down, key up, modifiers up. */
export function tapChord(modifiers: number[], vk: number): boolean {
  const events: Array<Record<string, unknown>> = [];
  for (const m of modifiers) events.push(makeKeyEvent(m, 0, 0));
  events.push(makeKeyEvent(vk, 0, 0));
  events.push(makeKeyEvent(vk, 0, KEYEVENTF_KEYUP));
  for (const m of [...modifiers].reverse()) events.push(makeKeyEvent(m, 0, KEYEVENTF_KEYUP));
  return sendInputs(events) === events.length;
}

/**
 * Best-effort "are the modifiers physically down" check.
 *
 * This matters because a user dictating with Alt+Space still has Alt held when
 * we inject. Pasting while Alt is down turns Ctrl+V into Alt+Ctrl+V in most
 * apps, so the injector releases anything stuck first.
 */
export function isKeyDown(vk: number): boolean {
  const a = init();
  if (!a) return false;
  // The high bit of the return value signals "currently down", so test it
  // explicitly — the whole value is not a boolean.
  return (Number(a.GetAsyncKeyState(vk)) & 0x8000) !== 0;
}

/** Force-release modifiers we might have left logically held. */
export function releaseModifiers(vks: number[] = [VK.SHIFT, VK.CONTROL, VK.MENU]): void {
  for (const vk of vks) {
    if (isKeyDown(vk)) keyUp(vk);
  }
}

// ----------------------------------------------------------------- clipboard

const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

let clipboardWarned = false;

/**
 * Read the clipboard as text. Returns `null` when it holds no text at all,
 * which is different from an empty string and must be preserved so restoring
 * the clipboard does not turn "an image" into "nothing".
 */
export function readClipboardText(): string | null {
  const a = init();
  if (!a) return null;
  if (!a.OpenClipboard(null)) {
    if (!clipboardWarned) {
      clipboardWarned = true;
      log.warn('could not open clipboard for read');
    }
    return null;
  }
  try {
    if (!a.IsClipboardFormatAvailable(CF_UNICODETEXT)) return null;
    const handle = a.GetClipboardData(CF_UNICODETEXT);
    if (!handle) return null;
    const ptr = a.GlobalLock(handle);
    if (!ptr) return null;
    try {
      return decodeUtf16(ptr);
    } finally {
      a.GlobalUnlock(handle);
    }
  } finally {
    a.CloseClipboard();
  }
}

/** Walk a UTF-16 pointer in chunks until the NUL terminator. */
function decodeUtf16(ptr: unknown): string {
  const CHUNK = 512;
  const parts: number[] = [];
  for (let offset = 0; offset < 1024 * 64; offset += CHUNK * 2) {
    const chunk = koffi.decode(ptr, offset, koffi.array('uint16', CHUNK)) as Uint16Array;
    for (const unit of chunk) {
      if (unit === 0) return String.fromCharCode(...parts);
      parts.push(unit);
    }
  }
  return String.fromCharCode(...parts);
}

export function writeClipboardText(text: string): boolean {
  const a = init();
  if (!a) return false;

  // JS strings are UTF-16, so `charCodeAt` already yields the code units the
  // clipboard wants; astral characters arrive as surrogate pairs for free.
  const view = new Uint16Array(text.length + 1);
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
  view[text.length] = 0;

  const handle = a.GlobalAlloc(GMEM_MOVEABLE, view.length * 2);
  if (!handle) return false;

  const ptr = a.GlobalLock(handle);
  if (!ptr) {
    a.GlobalFree(handle);
    return false;
  }
  try {
    koffi.encode(ptr, 0, koffi.array('uint16', view.length), view);
  } finally {
    // The block must be unlocked before it is handed to the clipboard.
    a.GlobalUnlock(handle);
  }

  if (!a.OpenClipboard(null)) {
    a.GlobalFree(handle);
    if (!clipboardWarned) {
      clipboardWarned = true;
      log.warn('could not open clipboard for write');
    }
    return false;
  }
  try {
    a.EmptyClipboard();
    if (!a.SetClipboardData(CF_UNICODETEXT, handle)) {
      a.GlobalFree(handle);
      return false;
    }
    // Ownership transferred to the clipboard; do not free.
    return true;
  } finally {
    a.CloseClipboard();
  }
}

function copyToPointer(dest: unknown, source: Uint16Array): void {
  const CHUNK = 512;
  for (let i = 0; i < source.length; i += CHUNK) {
    const slice = source.subarray(i, Math.min(i + CHUNK, source.length));
    koffi.encode(dest, i * 2, koffi.array('uint16', slice.length), slice);
  }
}

export function clipboardSequenceNumber(): number {
  const a = init();
  return a ? a.GetClipboardSequenceNumber() : 0;
}
