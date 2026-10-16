import { contextBridge, ipcRenderer } from 'electron';
import type { IpcEventMap, IpcInvokeMap } from '@shared/types';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc';

/**
 * The only bridge between the renderer and the main process.
 *
 * Context isolation is on and node integration is off, so the renderer cannot
 * touch Node or Electron APIs directly. Everything it needs is enumerated here;
 * in particular there is no generic `send(channel)` escape hatch, so a bug in
 * the renderer cannot reach an unintended handler.
 */

const invokeAllow = new Set<string>(INVOKE_CHANNELS);
const eventAllow = new Set<string>(EVENT_CHANNELS);

const bridge = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!invokeAllow.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC invoke on unknown channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!eventAllow.has(channel)) {
      throw new Error(`Blocked IPC listener on unknown channel: ${channel}`);
    }
    // Wrap so the renderer receives only the payload, never the IpcRendererEvent
    // (which would expose `sender` and leak a capability across the bridge).
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  sendAudio(frame: ArrayBuffer): void {
    // Microphone frames are high frequency; send them over a dedicated channel
    // that the main process treats as a plain buffer, not a JSON message.
    ipcRenderer.send('audio:frame', frame);
  },
};

export type PreloadBridge = typeof bridge;

contextBridge.exposeInMainWorld('vibetype', bridge);

// A typed re-export for the renderer's global declaration.
export type Bridge = {
  invoke<C extends keyof IpcInvokeMap>(
    channel: C,
    ...args: IpcInvokeMap[C]['args']
  ): Promise<IpcInvokeMap[C]['result']>;
  on<C extends keyof IpcEventMap>(channel: C, listener: (payload: IpcEventMap[C]) => void): () => void;
  sendAudio(frame: ArrayBuffer): void;
};
