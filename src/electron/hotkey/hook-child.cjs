/**
 * Low-level keyboard hook, run in a dedicated child process.
 *
 * Why a separate process? `SetWindowsHookEx(WH_KEYBOARD_LL)` requires a message
 * pump on the installing thread. Electron's main thread already runs one, and
 * the hook callback is invoked synchronously from it — any JS work inside the
 * callback stalls *system-wide* input until it returns. Isolating the hook here
 * means a slow callback can only stall a mostly-idle child.
 *
 * The hook never swallows a key. `CallNextHookEx` is always called, and the
 * callback does nothing but record a timestamp and post a short line to stdout,
 * so the keyboard behaves exactly as it would without us.
 *
 * Protocol on stdout, one JSON object per line:
 *   {"type":"ready"}
 *   {"type":"down","id":"current","ts":...}
 *   {"type":"switch","id":"translate-llm","ts":...}
 *   {"type":"up","id":"translate-llm","ts":...}
 *   {"type":"fatal","error":"..."}
 *
 * Plain CommonJS on purpose: this file is spawned directly by Node, not bundled.
 */

'use strict';

const koffi = require('koffi');

const args = parseArgs(process.argv.slice(2));
let bindings;
try {
  bindings = args.bindings
    ? JSON.parse(Buffer.from(args.bindings, 'base64url').toString('utf8'))
    : [{ id: 'current', vk: Number(args.vk), mods: String(args.mods || '').split(',').map(Number).filter((n) => n > 0) }];
  if (!Array.isArray(bindings) || !bindings.length || bindings.some((b) =>
    typeof b.id !== 'string' || !Number.isInteger(b.vk) || b.vk < 0 ||
    !Array.isArray(b.mods) || b.mods.some((m) => !Number.isInteger(m) || m <= 0) ||
    (b.vk === 0 && b.mods.length < 2)
  )) throw new Error('invalid shortcut bindings');
} catch (err) {
  emit({ type: 'fatal', error: `bad bindings: ${err.message}` });
  process.exit(2);
}

let user32;
try {
  user32 = koffi.load('user32.dll');
} catch (err) {
  emit({ type: 'fatal', error: `load user32: ${err.message}` });
  process.exit(3);
}

// ------------------------------------------------------------- types first

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });

const MSG = koffi.struct('MSG', {
  hwnd: 'void*',
  message: 'uint32',
  wParam: 'uintptr',
  lParam: 'intptr',
  time: 'uint32',
  pt: POINT,
});

/**
 * The hook procedure is called after `SetWindowsHookExW` has already returned,
 * so it must be a *registered* callback, not a transient one: koffi only
 * guarantees the trampoline lives for the duration of the call that received it.
 */
const HOOKPROC = koffi.proto(
  'intptr __stdcall HOOKPROC(int code, uintptr wParam, void* lParam)',
);
const HOOKPROC_PTR = koffi.pointer(HOOKPROC);

// The parameter is written as `HOOKPROC *cb` — koffi resolves the trailing star
// against the proto's declared name. A `void*` here would let the call succeed
// but crash the moment Windows invoked the callback.
const SetWindowsHookExW = user32.func(
  'void* __stdcall SetWindowsHookExW(int idHook, HOOKPROC *cb, void* hMod, uint32 threadId)',
);
const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void* hhk)');
const CallNextHookEx = user32.func(
  'intptr __stdcall CallNextHookEx(void* hhk, int code, uintptr wParam, void* lParam)',
);
const GetMessageW = user32.func(
  'int __stdcall GetMessageW(_Out_ MSG* msg, void* hwnd, uint32 min, uint32 max)',
);
const TranslateMessage = user32.func('bool __stdcall TranslateMessage(const MSG* msg)');
const DispatchMessageW = user32.func('intptr __stdcall DispatchMessageW(const MSG* msg)');

// ---------------------------------------------------------------- hook logic

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;

// Matcher lives in its own module so it can be unit-tested without a message
// pump. A low-level hook reports left/right-specific codes (left Ctrl is 0xA2,
// never 0x11), which is the trap that made this hotkey silently dead.
const { createMultiMatcher, modifierGroup } = require('./keymatch.cjs');
const matcher = createMultiMatcher(bindings);

let hook = null;
let hookCallback = null;

function onHookEvent(code, wParam, lParam) {
  // Per Win32 docs: a negative code means "pass it along without processing".
  if (code < 0) return CallNextHookEx(hook, code, wParam, lParam);

  let info;
  try {
    info = koffi.decode(lParam, KBDLLHOOKSTRUCT);
  } catch {
    return CallNextHookEx(hook, code, wParam, lParam);
  }

  const vk = info.vkCode;
  const isDown = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
  const isUp = wParam === WM_KEYUP || wParam === WM_SYSKEYUP;

  const event = matcher.transition(vk, isDown, isUp);
  if (event) {
    emit({ ...event, ts: Date.now() });
    if (modifierGroup(vk) !== null) note(`mod vk=0x${vk.toString(16)} ${isDown ? 'down' : 'up'} => ${event.type}:${event.id}`);
  }

  return CallNextHookEx(hook, code, wParam, lParam);
}

function emit(obj) {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* parent may have gone away */
  }
}

/** Diagnostic line to stderr; the parent logs it at debug level. */
function note(message) {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    /* parent may have gone away */
  }
}

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (hook) UnhookWindowsHookEx(hook);
  } catch {
    /* ignore */
  }
  try {
    if (hookCallback) koffi.unregister(hookCallback);
  } catch {
    /* ignore */
  }
  hook = null;
  hookCallback = null;
  process.exit(code ?? 0);
}

// An exception inside the callback would otherwise take the child down silently
// and leave push-to-talk dead with no explanation.
process.on('uncaughtException', (err) => {
  emit({ type: 'fatal', error: `uncaught: ${err && err.message}` });
  shutdown(4);
});

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('disconnect', () => shutdown(0));

// ------------------------------------------------------------------ install

try {
  hookCallback = koffi.register(onHookEvent, HOOKPROC_PTR);
  hook = SetWindowsHookExW(WH_KEYBOARD_LL, hookCallback, null, 0);
  if (!hook) throw new Error('SetWindowsHookExW returned null');
} catch (err) {
  emit({ type: 'fatal', error: `install hook: ${err.message}` });
  shutdown(5);
}

emit({ type: 'ready' });

// Standard Win32 message pump: the hook callback runs on this thread while we
// block inside GetMessageW, with no JS of ours interleaving.
const msg = koffi.alloc(MSG, 1);
for (;;) {
  const ret = GetMessageW(msg, null, 0, 0);
  if (ret === 0 || ret === -1) break;
  TranslateMessage(msg);
  DispatchMessageW(msg);
}

shutdown(0);

// ---------------------------------------------------------------- arg parsing

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}
