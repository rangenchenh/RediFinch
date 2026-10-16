import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { createLogger } from './logger';

const log = createLogger('window');

export interface WindowDeps {
  origin: string;
  isDev: boolean;
  preloadPath: string;
  /** Directory holding the exported renderer, used for the dev fallback. */
  rendererRoot: string;
  /**
   * Path to the window icon, or null when it could not be generated. Passed in
   * rather than derived here so this module stays unaware of the build layout.
   */
  iconPath: string | null;
}

/**
 * The always-on-top recording indicator: a small waveform, no panel.
 *
 * Sized tightly around the bars rather than generously, because the window is
 * transparent and click-through — any extra area is invisible but still swallows
 * clicks it cannot see, which is the kind of thing users experience as "this
 * rectangle on my screen is eating my mouse".
 */
export function createOverlayWindow(deps: WindowDeps, opacity: number): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const OVERLAY_WIDTH = 190;
  const OVERLAY_HEIGHT = 56;

  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: Math.round((width - OVERLAY_WIDTH) / 2),
    // Sits just above the taskbar, where a recording indicator is least likely to
    // cover the thing being dictated into.
    y: Math.round(height - OVERLAY_HEIGHT - 80),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    opacity,
    // Never let the overlay steal focus: doing so would break the whole trick,
    // because injection targets the focused window.
    focusable: false,
    acceptFirstMouse: true,
    hasShadow: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  loadRoute(win, deps, '/overlay/');
  return win;
}

/** The main control window. */
export function createMainWindow(deps: WindowDeps, startHidden: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#fbfbfa',
    title: 'Vokluna',
    // Without this the taskbar and Alt-Tab show the stock Electron icon on
    // Windows, even when the executable itself has a proper icon resource.
    ...(deps.iconPath ? { icon: deps.iconPath } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  loadRoute(win, deps, '/');

  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // External links belong in the real browser, never in an app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(deps.origin)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  return win;
}

function loadRoute(win: BrowserWindow, deps: WindowDeps, route: string): void {
  const url = new URL(route, deps.origin).toString();
  win.loadURL(url).catch((err) => {
    log.error(`failed to load ${url}:`, err);
    // Fall back to reading the exported file directly if the loopback server
    // failed for any reason. Router navigation will be degraded but the user
    // still gets a working window rather than a blank one.
    const file = path.join(deps.rendererRoot, route.replace(/^\//, ''), 'index.html');
    win.loadFile(file).catch((fileErr) => log.error(`file fallback failed:`, fileErr));
  });
}
