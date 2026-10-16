import type { IpcEventMap, IpcInvokeMap, Settings } from './types';

/**
 * Channel names are `namespace:action`. Keeping them in one place means a typo
 * is a compile error on both sides rather than a silent no-op at runtime.
 */
export const INVOKE_CHANNELS = [
  'settings:get',
  'settings:set',
  'settings:reset',
  'runtime:status',
  'runtime:providers',
  'speko:models',
  'dictation:start',
  'dictation:stop',
  'dictation:cancel',
  'dictation:commit',
  'text:process',
  'agent:start',
  'agent:tasks',
  'agent:cancel',
  'agent:approve',
  'agent:connectChrome',
  'agent:openChromeSetup',
  'models:list',
  'models:download',
  'audio:devices',
  'audio:levels',
  'window:hide',
  'window:minimize',
  'window:show',
  'window:setOverlay',
  'hotkey:suspend',
  'app:openLogs',
  'app:version',
] as const satisfies readonly (keyof IpcInvokeMap)[];

export const EVENT_CHANNELS = [
  'agent:updated',
  'dictation:state',
  'dictation:segment',
  'dictation:output',
  'dictation:level',
  'runtime:status',
  'models:progress',
  'hotkey:trigger',
  'app:error',
  'settings:changed',
] as const satisfies readonly (keyof IpcEventMap)[];

/** Preload bridge surface, also declared globally for the renderer. */
export interface VibeTypeBridge {
  invoke<C extends keyof IpcInvokeMap>(
    channel: C,
    ...args: IpcInvokeMap[C]['args']
  ): Promise<IpcInvokeMap[C]['result']>;

  on<C extends keyof IpcEventMap>(
    channel: C,
    listener: (payload: IpcEventMap[C]) => void,
  ): () => void;

  /** Raw PCM frames from the AudioWorklet, fire-and-forget. */
  sendAudio(frame: ArrayBuffer): void;
}

/** Deep-partial patch, used by `settings:set`. */
export type SettingsPatch = DeepPartial<Settings>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
