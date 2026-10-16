import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { normaliseSettings } from '@shared/merge';
import { createLogger } from './logger';

const log = createLogger('store');

/**
 * Settings live in a single JSON file under `userData`. Writes are debounced
 * because the renderer patches settings on every slider drag, and a synchronous
 * fsync per pixel would stutter the UI.
 */
export class SettingsStore {
  private file: string;
  private value: Settings;
  private flushTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.value = this.read();
  }

  private read(): Settings {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return normaliseSettings(JSON.parse(raw));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.warn('settings unreadable, falling back to defaults:', err);
      }
      return normaliseSettings(DEFAULT_SETTINGS);
    }
  }

  get(): Settings {
    return this.value;
  }

  /** Deep-merge a patch, normalise, persist (debounced), and notify listeners. */
  set(patch: unknown): Settings {
    this.value = normaliseSettings(mergeForPatch(this.value, patch));
    this.scheduleFlush();
    for (const fn of this.listeners) fn(this.value);
    return this.value;
  }

  reset(): Settings {
    this.value = normaliseSettings(DEFAULT_SETTINGS);
    this.scheduleFlush();
    for (const fn of this.listeners) fn(this.value);
    return this.value;
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // Write to a sibling then rename, so a crash mid-write cannot leave a
      // truncated settings file that fails to parse on next launch.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error('failed to persist settings:', err);
    }
  }

  get path(): string {
    return this.file;
  }
}

/**
 * The patch arrives as JSON from the renderer, so `undefined` must be ignored
 * (that would wipe stored values) while explicit `null` is a real choice.
 */
function mergeForPatch(current: unknown, patch: unknown): Settings {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return current as Settings;
  }
  const base = { ...(current as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const prev = base[k];
    base[k] =
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev !== null &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
        ? mergeForPatch(prev, v)
        : v;
  }
  return base as unknown as Settings;
}
