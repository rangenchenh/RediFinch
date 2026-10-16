import type { IpcEventMap, IpcInvokeMap, Settings } from '@shared/types';

/**
 * Typed access to the preload bridge.
 *
 * `window.vibetype` is missing when the renderer is loaded in a plain browser
 * (useful for iterating on UI without Electron). Rather than sprinkling null
 * checks everywhere, `hasBridge()` gates a single "not in the app" state and the
 * helpers below throw a clear error if used without it.
 */

export function getBridge() {
  const bridge = typeof window !== 'undefined' ? window.vibetype : undefined;
  if (!bridge) {
    throw new Error('Vokluna bridge unavailable — this UI must run inside the desktop app.');
  }
  return bridge;
}

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.vibetype;
}

export async function invoke<C extends keyof IpcInvokeMap>(
  channel: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return getBridge().invoke(channel, ...args);
}

/** Subscribe to a main-process event; returns an unsubscribe function. */
export function subscribe<C extends keyof IpcEventMap>(
  channel: C,
  listener: (payload: IpcEventMap[C]) => void,
): () => void {
  if (!hasBridge()) return () => undefined;
  return getBridge().on(channel, listener);
}

export function sendAudio(samples: Float32Array): void {
  const bridge = typeof window !== 'undefined' ? window.vibetype : undefined;
  if (!bridge) return;
  // Slice to a standalone ArrayBuffer so transferring cannot detach the caller's
  // view of a shared buffer.
  bridge.sendAudio(samples.buffer.slice(0) as ArrayBuffer);
}

/** Read settings once, for bootstrapping component state. */
export async function loadSettings(): Promise<Settings | null> {
  if (!hasBridge()) return null;
  try {
    return await invoke('settings:get');
  } catch {
    return null;
  }
}

/**
 * Persist a partial settings patch. Debounced by the caller where it matters;
 * the main process also coalesces writes to disk.
 */
export async function patchSettings(patch: unknown): Promise<Settings | null> {
  if (!hasBridge()) return null;
  try {
    return await invoke('settings:set', patch as never);
  } catch {
    return null;
  }
}
