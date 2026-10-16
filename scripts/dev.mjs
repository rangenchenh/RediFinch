import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Dev runner: `next dev` for the renderer plus esbuild watch + Electron for the
 * main process. Electron is pointed at the Next dev server via
 * `VIBETYPE_DEV_ORIGIN`, so there is no rebuild-to-refresh loop for UI changes.
 */

const children = [];
let shuttingDown = false;

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const DEV_PORT = Number(process.env.PORT ?? 3000);
const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

async function main() {
  console.log('› building main process…');
  await new Promise((resolve, reject) => {
    const child = run('node', [path.join(root, 'scripts/build-electron.mjs')]);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
  });

  console.log(`› starting next dev on ${DEV_ORIGIN}…`);
  const nextDev = run(npm, ['run', 'dev:next', '--', '--port', String(DEV_PORT)], {
    env: { ...process.env, PORT: String(DEV_PORT) },
  });

  const ready = await waitForServer(DEV_ORIGIN);
  if (!ready) {
    console.error('✗ next dev did not come up in time');
    shutdown(1);
    return;
  }
  console.log('› renderer ready, launching electron…');

  // Watch mode rebuilds main.js on change; Electron needs a manual restart,
  // which is called out in the prompt rather than silently ignored.
  run('node', [path.join(root, 'scripts/build-electron.mjs'), '--watch']);

  const electron = run('npx', ['electron', '.'], {
    env: { ...process.env, VIBETYPE_DEV_ORIGIN: DEV_ORIGIN, NODE_ENV: 'development' },
  });

  electron.on('exit', (code) => {
    console.log(`› electron exited (${code})`);
    void nextDev;
    shutdown(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
