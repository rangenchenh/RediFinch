import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal file logger. The app runs mostly in the tray with no console
 * attached, so anything that goes wrong has to land somewhere the user can
 * actually find — `%APPDATA%/RediFinch/logs/redifinch.log`.
 */

const MAX_BYTES = 2 * 1024 * 1024;

let logPath: string | null = null;
let stream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'redifinch.log');

    // Rotate once when the file gets large rather than growing without bound.
    try {
      const st = fs.statSync(logPath);
      if (st.size > MAX_BYTES) {
        fs.renameSync(logPath, path.join(dir, 'redifinch.prev.log'));
      }
    } catch {
      /* first run */
    }

    stream = fs.createWriteStream(logPath, { flags: 'a' });
    return stream;
  } catch {
    return null;
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')}\n`;

  const s = ensureStream();
  if (s) s.write(line);
  if (level === 'error' || level === 'warn') process.stderr.write(line);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}

export function getLogPath(): string {
  ensureStream();
  return logPath ?? '';
}
