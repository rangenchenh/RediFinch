import type { Bridge } from '@/electron/preload';

declare global {
  interface Window {
    /**
     * Injected by the preload script. Absent when the renderer is opened in a
     * plain browser (`next dev` without Electron), which the UI detects to show
     * a "not running in the app" notice instead of crashing.
     */
    vibetype?: Bridge;
  }
}

export {};
