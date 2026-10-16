import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  session as electronSession,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { OutputMode, RuntimeStatus, Settings } from '@shared/types';
import { DICTATION_LANGUAGES, DEFAULT_SETTINGS, OUTPUT_MODES } from '@shared/types';
import { DictationSession } from './dictation';
import { processText } from './output/process';
import { HotkeyManager } from './hotkey/manager';
import { describeHotkey } from './hotkey/keys';
import { registerSelfWindows } from './injection/injector';
import { isWin32Available, win32InitError } from './injection/win32';
import { createLogger, getLogPath } from './logger';
import { ModelDownloader } from './models/downloader';
import { allStatuses, logModelLayout, migrateLegacyModels, modelsRoot } from './models/paths';
import { checkProviders } from './stt/factory';
import { preloadLocalEngine, shutdownLocalEngine } from './stt/local';
import { listSpekoModels } from './stt/speko';
import { SettingsStore } from './store';
import { startStaticServer, type StaticServer } from './server';
import { createMainWindow, createOverlayWindow } from './window';
import { AgentRunner } from './agent/runner';
import { ChromeTools } from './agent/chrome';

const log = createLogger('main');

const isDev = !app.isPackaged;
const DEV_ORIGIN = process.env.VIBETYPE_DEV_ORIGIN ?? 'http://localhost:3000';

// One dictation app per machine: a second instance would fight over the
// clipboard and register a duplicate keyboard hook.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: StaticServer | null = null;

let store: SettingsStore;
let session: DictationSession;
let hotkeys: HotkeyManager;
let downloader: ModelDownloader;
let agent: AgentRunner;
let chromeTools: ChromeTools;

/** Latest status pushed to the UI, so a late-opening window can be caught up. */
let lastStatus: RuntimeStatus | null = null;

/** Renderer path has to exist before any window is created. */
function rendererRoot(): string {
  // Packaged: `out/` is copied into the app's resources. Dev build: repo root.
  const candidates = [
    path.join(app.getAppPath(), 'out'),
    path.join(process.resourcesPath ?? '', 'app', 'out'),
    path.join(__dirname, '..', 'out'),
    path.join(process.cwd(), 'out'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(c, 'index.html')).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return candidates[0];
}

/**
 * Window icon, or null when it is not on disk.
 *
 * Null is a supported outcome: the app is still usable without an icon, and
 * failing to start because artwork is missing would be the wrong trade. The
 * caller logs, and the window falls back to the default.
 */
function windowIconPath(): string | null {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(app.getAppPath(), 'dist-electron', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  log.warn('icon.png not found; the window will use the default icon');
  return null;
}

function preloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return candidates[0];
}

// --------------------------------------------------------------- status push

/**
 * Push an event to every open window.
 *
 * A window can survive its render frame — during teardown, a reload, or a
 * crashed renderer — and `webContents.send` throws in that state. Since these
 * events fire on every audio frame and every model progress tick, an unguarded
 * throw would spray errors and can wedge the sender, so each window is checked
 * and isolated.
 */
function emitToRenderers(channel: string, payload: unknown): void {
  for (const win of [mainWindow, overlayWindow]) {
    if (!win || win.isDestroyed()) continue;
    try {
      const contents = win.webContents;
      if (contents.isDestroyed() || contents.isCrashed()) continue;
      contents.send(channel, payload);
    } catch {
      // The frame was disposed between the check and the send; dropping the
      // event is correct — there is nothing left to render it.
    }
  }
}

async function buildStatus(): Promise<RuntimeStatus> {
  const settings = store.get();
  const hk = hotkeys.getState();
  const info = session.getStatus();

  const status: RuntimeStatus = {
    state: info.state,
    activeEngine: info.engine,
    engineReason: info.reason,
    models: allStatuses(),
    hotkeyRegistered: hk.registered,
    hotkeyMode: settings.hotkey.mode,
    hotkeyWarning: hk.warning,
    lastError: undefined,
  };
  lastStatus = status;
  return status;
}

async function pushStatus(): Promise<void> {
  emitToRenderers('runtime:status', await buildStatus());
}

/**
 * Persist a settings patch and run the same side effects the IPC handler does.
 *
 * The tray menu changes settings directly in the main process rather than going
 * through the renderer, and the store's own `onChange` subscription cannot do
 * these steps for it: it would re-enter `hotkeys.register` in the middle of a
 * menu callback. Routing both paths through one function keeps them honest.
 */
async function applySettings(patch: unknown): Promise<void> {
  const next = store.set(patch);
  store.flush();
  await hotkeys.register(configuredHotkeys(next));
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(next.ui.overlayOpacity);
  }
  applyLaunchAtLogin(next);
  emitToRenderers('settings:changed', next);
  await pushStatus();
}

/** Show or hide the overlay window, creating it on demand. */
async function setOverlayVisible(visible: boolean): Promise<void> {
  if (!visible) {
    overlayWindow?.hide();
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow(
      {
        origin: server?.origin ?? DEV_ORIGIN,
        isDev,
        preloadPath: preloadPath(),
        rendererRoot: rendererRoot(),
        iconPath: windowIconPath(),
      },
      store.get().ui.overlayOpacity,
    );
  } else {
    overlayWindow.showInactive();
  }
}

// ------------------------------------------------------------------ lifecycle

async function bootstrap(): Promise<void> {
  migrateLegacyUserData();
  store = new SettingsStore();
  const settings = store.get();

  session = new DictationSession(settings);
  session.on('state', async () => pushStatus());
  session.on('segment', (segment) => emitToRenderers('dictation:segment', segment));
  session.on('output', (output) => emitToRenderers('dictation:output', output));
  session.on('level', (level) => emitToRenderers('dictation:level', level));
  session.on('error', (err: { message: string }) => {
    emitToRenderers('app:error', err);
    void pushStatus();
  });

  downloader = new ModelDownloader({
    onProgress: (status) => emitToRenderers('models:progress', status),
  });

  hotkeys = new HotkeyManager({
    onDown: (id) => void onHotkeyDown(id),
    onSwitch: (id) => onHotkeySwitch(id),
    onUp: () => void onHotkeyUp(),
    onDegraded: (reason) => {
      log.warn(`hotkey degraded: ${reason}`);
      void pushStatus();
    },
  });

  store.onChange(async (next) => {
    session.updateSettings(next);
    emitToRenderers('settings:changed', next);
    // Re-register only when the chord actually changed; `register` no-ops
    // otherwise, so this is cheap on unrelated settings edits.
    await hotkeys.register(configuredHotkeys(next));
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setOpacity(next.ui.overlayOpacity);
    }
    applyLaunchAtLogin(next);
    void pushStatus();
  });

  // Move any models downloaded by an older build out of C:\...\AppData before
  // anything checks whether they are installed, so an upgrade does not silently
  // cost the user a re-download.
  migrateLegacyModels();
  logModelLayout();
  log.info(`models directory: ${modelsRoot()}`);

  // Static server only matters for the packaged build; in dev the renderer is
  // served by `next dev`.
  let origin = DEV_ORIGIN;
  if (!isDev) {
    server = await startStaticServer(rendererRoot());
    origin = server.origin;
  }

  const deps = {
    origin,
    isDev,
    preloadPath: preloadPath(),
    rendererRoot: rendererRoot(),
    iconPath: windowIconPath(),
  };

  mainWindow = createMainWindow(deps, settings.ui.startHidden);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // Closing the window hides to tray instead of quitting — a dictation tool is
  // expected to keep running in the background.
  mainWindow.on('close', (event) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (settings.ui.showOverlay) {
    overlayWindow = createOverlayWindow(deps, settings.ui.overlayOpacity);
  }

  // Electron denies media permission by default, so without this the mic never
  // opens. Only our own loopback origin is granted, and only for audio.
  grantMicrophonePermission(origin);

  registerSelfWindows(
    [mainWindow, overlayWindow]
      .filter((w): w is BrowserWindow => !!w)
      .map((w) => w.getNativeWindowHandle()),
    process.pid,
  );

  await hotkeys.register(configuredHotkeys(settings));
  buildTray();
  applyLaunchAtLogin(settings);
  applyBackgroundBehaviour();

  // Load the recognizer now rather than on the first press. Constructing it reads
  // a 937 MB ONNX graph (~3.3 s measured), which is exactly the lag the user
  // feels between pressing the hotkey and the recording indicator appearing.
  // Deliberately not awaited: startup should not block on it, and the engine
  // loads it on demand if the user presses the hotkey before this finishes.
  void preloadLocalEngine(settings).then((ok) => {
    if (ok) log.info('first dictation will start with no model-load delay');
    void pushStatus();
  });

  if (!isWin32Available()) {
    log.error(`Windows input layer unavailable: ${win32InitError()}`);
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Limited functionality',
      message: 'Text insertion is unavailable',
      detail:
        `Saykin could not load the Windows input APIs, so it cannot type into other apps.\n\n` +
        `Reason: ${win32InitError() ?? 'unknown'}\n\n` +
        `Transcription still works and text stays copyable.`,
    });
  }

  void pushStatus();
  log.info('Saykin ready');

  handleStartupArgs();
}

/** Carry existing settings and downloaded models across the product-name change. */
function migrateLegacyUserData(): void {
  const previous = path.join(app.getPath('appData'), 'vibeType');
  const current = app.getPath('userData');
  if (path.resolve(previous).toLowerCase() === path.resolve(current).toLowerCase()) return;
  if (!fs.existsSync(previous)) return;

  try {
    fs.mkdirSync(current, { recursive: true });
    for (const name of ['settings.json', 'agent-tasks.json']) {
      const source = path.join(previous, name);
      const destination = path.join(current, name);
      if (fs.existsSync(source) && !fs.existsSync(destination)) {
        fs.copyFileSync(source, destination);
      }
    }
    const oldModels = path.join(previous, 'models');
    const newModels = path.join(current, 'models');
    if (fs.existsSync(oldModels) && !fs.existsSync(newModels)) {
      fs.renameSync(oldModels, newModels);
    }
  } catch (err) {
    log.warn('could not migrate settings from the previous app name:', err);
  }
}

/**
 * Allow microphone capture, and nothing else.
 *
 * Electron's default permission handler refuses `media` requests outright, so
 * the renderer's `getUserMedia` would reject with NotAllowedError and dictation
 * could never start. The grant is scoped to our own renderer origin so a
 * navigation elsewhere cannot inherit it, and all other permissions stay denied.
 */
function grantMicrophonePermission(origin: string): void {
  const allowed = new Set([origin, `${origin}/`]);

  electronSession.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) => {
      const url = contents.getURL();
      if (permission === 'media' && [...allowed].some((a) => url.startsWith(a))) {
        callback(true);
        return;
      }
      log.warn(`denied ${permission} permission for ${url}`);
      callback(false);
    },
  );

  // `getUserMedia` also consults the synchronous check on some paths.
  electronSession.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      permission === 'media' && [...allowed].some((a) => requestingOrigin.startsWith(a)),
  );
}

/**
 * Keep the app fully alive in the background.
 *
 * A dictation tool is only useful if the hotkey works whenever the user wants
 * it, so several Chromium defaults that throttle or kill background work are
 * explicitly disabled here — otherwise the hotkey goes dead or the audio pipeline
 * stalls once the window is closed or the machine has been idle.
 */
function applyBackgroundBehaviour(): void {
  const commandLine = app.commandLine;

  // Chromium throttles timers and rendering in hidden and occluded windows. That
  // throttling delays IPC from the renderer that holds the microphone, which is
  // exactly what makes a backgrounded dictation tool feel unresponsive.
  //
  // Only these three are set. Deliberately not touching `disable-features` or
  // the audio service: `appendSwitch('disable-features', …)` replaces the whole
  // list rather than appending, so it can silently disable unrelated behaviour —
  // and forcing the audio service in-process is a good way to break capture
  // outright. Background liveness is worth a lot, but not at the cost of the
  // microphone.
  commandLine.appendSwitch('disable-renderer-backgrounding');
  commandLine.appendSwitch('disable-background-timer-throttling');
  commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

function applyLaunchAtLogin(settings: Settings): void {
  // Only meaningful for a packaged app; a dev electron.exe path would be wrong.
  if (isDev) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.ui.launchAtLogin,
      args: ['--hidden'],
    });
  } catch (err) {
    log.warn('could not set login item:', err);
  }
}

function handleStartupArgs(): void {
  if (process.argv.includes('--hidden')) return;
  if (!store.get().ui.startHidden) mainWindow?.show();
}

// -------------------------------------------------------------------- hotkey

function configuredHotkeys(settings: Settings): Record<string, string> {
  return { current: settings.hotkey.accelerator, ...settings.hotkey.modeShortcuts };
}

let latchedHotkeyId = 'current';
let hotkeyReleasePending = false;
let hotkeySuspended = false;
const hotkeySuspendedBy = new Set<number>();
const observedHotkeySenders = new Set<number>();

function setHotkeySuspension(senderId: number, suspended: boolean): void {
  if (suspended) hotkeySuspendedBy.add(senderId);
  else hotkeySuspendedBy.delete(senderId);
  const next = hotkeySuspendedBy.size > 0;
  if (next !== hotkeySuspended) log.info(`global hotkey ${next ? 'paused' : 'resumed'}`);
  hotkeySuspended = next;
}

function selectHotkeyMode(id: string): void {
  if (id === 'current' || !OUTPUT_MODES.some((mode) => mode.value === id)) return;
  const mode = id as OutputMode;
  if (store.get().output.mode !== mode) store.set({ output: { mode } });
  session.selectOutputMode(mode);
  latchedHotkeyId = id;
}

function onHotkeySwitch(id: string): void {
  if (hotkeySuspended) return;
  // Releasing Shift may reveal the base chord again; retain the chosen mode
  // until this dictation ends instead of reverting to the previous mode.
  if (id !== 'current') selectHotkeyMode(id);
}

async function onHotkeyDown(id = 'current'): Promise<void> {
  if (hotkeySuspended) return;
  try {
    if (session.currentState === 'listening') {
      if (id !== latchedHotkeyId) {
        selectHotkeyMode(id);
        return;
      }
      // Toggle mode: a second press ends the session.
      if (store.get().hotkey.mode === 'toggle' || hotkeys.getState().mode === 'accelerator') {
        await finishHotkeySession();
        return;
      }
      return;
    }

    latchedHotkeyId = id;
    hotkeyReleasePending = false;
    selectHotkeyMode(id);
    overlayWindow?.showInactive();
    await session.begin();
    emitToRenderers('hotkey:trigger', { edge: 'down' });
    if (hotkeyReleasePending) {
      await finishHotkeySession();
      return;
    }
    void pushStatus();
  } catch {
    overlayWindow?.hide();
    // `session.begin` already surfaced a message to the UI.
  }
}

async function onHotkeyUp(): Promise<void> {
  if (hotkeySuspended && session.currentState !== 'listening') return;
  if (store.get().hotkey.mode === 'toggle' && hotkeys.getState().mode === 'hook') return;
  if (session.currentState !== 'listening') {
    hotkeyReleasePending = true;
    return;
  }
  await finishHotkeySession();
}

async function finishHotkeySession(): Promise<void> {
  if (session.currentState !== 'listening') return;
  emitToRenderers('hotkey:trigger', { edge: 'up' });
  try {
    await session.end();
  } finally {
    latchedHotkeyId = 'current';
    hotkeyReleasePending = false;
    overlayWindow?.hide();
    void pushStatus();
  }
}

// ----------------------------------------------------------------------- tray

function buildTray(): void {
  try {
    tray = new Tray(makeTrayIcon());
  } catch (err) {
    log.warn('could not create tray icon:', err);
    return;
  }

  const refresh = () => {
    if (!tray) return;

    // Read settings fresh on every refresh. Capturing them once left the
    // accelerator label permanently showing whatever was configured at launch.
    const current = store.get();

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Open Saykin',
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
        { type: 'separator' },
        {
          label: `Push to talk: ${describeHotkey(current.hotkey.accelerator)}`,
          enabled: false,
        },
        {
          label: session.currentState === 'listening' ? 'Stop dictation' : 'Start dictation',
          click: () => {
            if (session.currentState === 'listening') void finishHotkeySession();
            else void onHotkeyDown();
          },
        },
        { type: 'separator' },
        // Language is the setting most likely to be changed mid-flow (dictating
        // a Chinese message, then an English one), so it belongs on the tray
        // rather than behind two clicks into the settings window.
        {
          label: 'Language',
          submenu: DICTATION_LANGUAGES.map((lang) => ({
            label: lang.label,
            type: 'radio' as const,
            checked: current.language.primary === lang.value,
            click: () => {
              void applySettings({ language: { primary: lang.value } });
            },
          })),
        },
        {
          label: 'Engine',
          submenu: (
            [
              { value: 'auto', label: 'Auto (on-device when available)' },
              { value: 'local', label: 'On-device only' },
              { value: 'cloud', label: 'Cloud only' },
            ] as const
          ).map((option) => ({
            label: option.label,
            type: 'radio' as const,
            checked: current.strategy === option.value,
            click: () => {
              void applySettings({ strategy: option.value });
            },
          })),
        },
        { type: 'separator' },
        {
          label: 'Show overlay',
          type: 'checkbox',
          checked: !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible(),
          click: (item) => {
            void setOverlayVisible(item.checked);
          },
        },
        {
          label: 'Start hidden',
          type: 'checkbox',
          checked: current.ui.startHidden,
          click: (item) => {
            void applySettings({ ui: { startHidden: item.checked } });
          },
        },
        {
          label: 'Launch at login',
          type: 'checkbox',
          checked: current.ui.launchAtLogin,
          click: (item) => {
            void applySettings({ ui: { launchAtLogin: item.checked } });
          },
        },
        { type: 'separator' },
        { label: 'Settings…', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { label: 'Open logs', click: () => void openLogs() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            (app as unknown as { isQuitting?: boolean }).isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
  };

  refresh();
  tray.setToolTip('Saykin — hold to dictate');
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  // Keep the menu's dynamic labels truthful.
  session.on('state', refresh);
  store.onChange(refresh);
}

/**
 * The tray icon.
 *
 * Read from a generated asset rather than drawn inline. The old version plotted
 * a microphone by hand pixel-by-pixel, which could not be kept in step with the
 * waveform the app actually uses as its mark — and at 32 px a hand-plotted glyph
 * reads as a smudge.
 *
 * The asset is monochrome and un-tiled, because the Windows tray sits on a
 * light or dark taskbar depending on the user's theme; a dark tile would vanish
 * into a dark taskbar.
 */
function makeTrayIcon(): Electron.NativeImage {
  const asset = path.join(__dirname, 'tray.png');
  try {
    const image = nativeImage.createFromPath(asset);
    if (!image.isEmpty()) return image;
    log.warn(`tray icon at ${asset} decoded empty; falling back to a blank icon`);
  } catch (err) {
    log.warn(`could not read tray icon at ${asset}:`, err);
  }
  // A blank slot is worse than a missing icon only in that it is silent, so this
  // is logged above rather than swallowed.
  return nativeImage.createEmpty();
}

async function openLogs(): Promise<void> {
  const p = getLogPath();
  if (p) shell.showItemInFolder(p);
  else await shell.openPath(app.getPath('userData'));
}

// ------------------------------------------------------------------------ IPC

function registerIpc(): void {
  const handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as never[])));
  };

  handle('settings:get', () => store.get());

  handle('settings:set', async (patch: unknown) => {
    const next = store.set(patch);
    store.flush();
    return next;
  });

  handle('settings:reset', () => {
    const next = store.reset();
    store.flush();
    return next;
  });

  handle('runtime:status', () => buildStatus());
  handle('runtime:providers', () => checkProviders(store.get()));
  handle('speko:models', () => listSpekoModels(store.get().cloud.speko.apiKey));

  handle('dictation:start', async () => {
    try {
      overlayWindow?.showInactive();
      await session.begin();
      await pushStatus();
      return { ok: true };
    } catch (err) {
      overlayWindow?.hide();
      await pushStatus();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  handle('dictation:stop', async (opts?: { inject?: boolean; process?: boolean }) => {
    const result = await session.end(opts);
    overlayWindow?.hide();
    await pushStatus();
    return { ok: opts?.inject === false ? !result.error : result.injected, text: result.text, error: result.error };
  });

  handle('dictation:cancel', async () => {
    await session.cancel();
    overlayWindow?.hide();
    await pushStatus();
    return { ok: true };
  });

  handle('dictation:commit', async (text: string, opts?: { inject?: boolean }) => {
    if (opts?.inject === false) {
      return { ok: true, method: 'none' as const, chars: text.length };
    }
    const settings = store.get();
    const { injectText } = await import('./injection/injector');
    return injectText(text, {
      method: settings.injection.method,
      keepInClipboard: settings.injection.keepInClipboard,
      restoreClipboard: settings.injection.restoreClipboard,
      trailingSpace: false,
    });
  });

  handle('text:process', async (text: string) => processText(text, store.get()));
  handle('agent:start', (instruction: string) => agent.start(instruction));
  handle('agent:tasks', () => agent.list());
  handle('agent:cancel', (id: string) => agent.cancel(id));
  handle('agent:approve', (id: string, approved: boolean) => agent.approve(id, approved));
  handle('agent:connectChrome', async () => {
    try { await chromeTools.disconnect(); await chromeTools.connect(); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  handle('agent:openChromeSetup', () => chromeTools.openSetup());

  handle('models:list', () => allStatuses());

  handle('models:download', async (kind: 'vad' | 'asr') => {
    try {
      await downloader.ensure(kind);
      // Re-resolve so `auto` can pick up a freshly installed model.
      await pushStatus();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  handle('audio:devices', async () => {
    // Enumerating *labels* requires mic permission, which only the renderer can
    // request. It reports the list back through this same call after granting.
    return [] as Array<{ deviceId: string; label: string; kind: string }>;
  });

  handle('audio:levels', () => ({ supported: true }));

  handle('window:hide', () => {
    mainWindow?.hide();
  });
  handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  handle('window:show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  handle('window:setOverlay', async (enabled: boolean) => {
    if (enabled) {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow(
          {
            origin: server?.origin ?? DEV_ORIGIN,
            isDev,
            preloadPath: preloadPath(),
            rendererRoot: rendererRoot(),
            iconPath: windowIconPath(),
          },
          store.get().ui.overlayOpacity,
        );
      } else {
        overlayWindow.showInactive();
      }
    } else {
      overlayWindow?.hide();
    }
    await pushStatus();
  });
  ipcMain.handle('hotkey:suspend', (event, suspended: boolean) => {
    const sender = event.sender;
    if (!observedHotkeySenders.has(sender.id)) {
      observedHotkeySenders.add(sender.id);
      sender.on('did-navigate', () => setHotkeySuspension(sender.id, false));
      sender.once('destroyed', () => {
        setHotkeySuspension(sender.id, false);
        observedHotkeySenders.delete(sender.id);
      });
    }
    setHotkeySuspension(sender.id, suspended === true);
  });

  handle('app:openLogs', () => openLogs());
  handle('app:version', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }));

  // High-frequency mic frames bypass invoke/return entirely.
  ipcMain.on('audio:frame', (_event, frame: ArrayBuffer) => {
    // A Float32Array view over the transferred buffer; copied by the engines
    // that need to retain it.
    const samples = new Float32Array(frame);
    void session.pushAudio(samples);
  });
}

// ------------------------------------------------------------------- entrypoint

app.on('second-instance', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

app.on('window-all-closed', () => {
  // Tray app: keep running. Quit is explicit, via the tray menu.
});

app.on('before-quit', async () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  store?.flush();
  await hotkeys?.dispose();
  await session?.cancel();
  await chromeTools?.disconnect();
  await server?.close();
});

app.whenReady().then(async () => {
  chromeTools = new ChromeTools();
  agent = new AgentRunner(() => store.get(), (task) => emitToRenderers('agent:updated', task), chromeTools);
  registerIpc();
  try {
    await bootstrap();
  } catch (err) {
    log.error('bootstrap failed:', err);
    dialog.showErrorBox(
      'Saykin failed to start',
      `${err instanceof Error ? err.message : String(err)}\n\nLogs: ${getLogPath()}`,
    );
  }
});

process.on('uncaughtException', (err) => {
  log.error('uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection:', reason);
});

export { DEFAULT_SETTINGS };
