import { build } from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-electron');

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/**
 * Main-process bundle.
 *
 * `electron` and the native modules are left external: koffi and
 * sherpa-onnx-node resolve their own platform binaries relative to their
 * package directory, which bundling would break. Everything else is inlined so
 * the packaged app does not need node_modules for the main process.
 */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
  external: ['electron', 'koffi', 'sherpa-onnx-node'],
};

async function buildMain() {
  await build({
    ...common,
    entryPoints: [path.join(root, 'src/electron/main.ts')],
    outfile: path.join(outDir, 'main.js'),
  });
}

async function buildPreload() {
  await build({
    ...common,
    // The preload runs in a renderer context: no Node builtins beyond what
    // Electron injects, and it must stay small.
    target: 'chrome120',
    entryPoints: [path.join(root, 'src/electron/preload.ts')],
    outfile: path.join(outDir, 'preload.js'),
  });
}

/**
 * The keyboard-hook helper is deliberately NOT bundled: it is spawned as a
 * plain Node process and must stay a readable .cjs file on disk.
 *
 * `keymatch.cjs` ships alongside it for the same reason — the hook requires it
 * at runtime, so it has to be a real file in the output directory rather than
 * inlined. Bundling those two would defeat the point of keeping the hook
 * process independent.
 */
async function copyHookChild() {
  const pairs = [
    ['src/electron/hotkey/hook-child.cjs', 'hotkey-hook.cjs'],
    ['src/electron/hotkey/keymatch.cjs', 'keymatch.cjs'],
  ];
  for (const [from, to] of pairs) {
    await cp(path.join(root, from), path.join(outDir, to));
  }
}

/**
 * Runtime icons are read from disk, so they have to sit next to main.js in the
 * bundle rather than only in `build/` (which electron-builder consumes at
 * packaging time and does not ship).
 *
 * Regenerated if missing so a fresh clone works without a separate step, but
 * never overwritten when present — otherwise a local tweak to the artwork would
 * be silently discarded on every build.
 */
async function copyRuntimeIcons() {
  const pairs = [
    ['build/tray.png', 'tray.png'],
    ['build/icon.png', 'icon.png'],
  ];
  const missing = [];
  for (const [from] of pairs) {
    try {
      await stat(path.join(root, from));
    } catch {
      missing.push(from);
    }
  }
  if (missing.length > 0) {
    console.log(`  ${missing.join(', ')} missing — generating`);
    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [path.join(root, 'scripts/generate-icon.mjs')], (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }
  for (const [from, to] of pairs) {
    await cp(path.join(root, from), path.join(outDir, to));
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await Promise.all([buildMain(), buildPreload(), copyHookChild(), copyRuntimeIcons()]);

  for (const f of ['main.js', 'preload.js', 'hotkey-hook.cjs', 'keymatch.cjs', 'tray.png', 'icon.png']) {
    const s = await stat(path.join(outDir, f));
    console.log(`  ${f.padEnd(18)} ${(s.size / 1024).toFixed(1)} KB`);
  }

  if (watch) {
    const { context } = await import('esbuild');
    for (const [name, opts] of [
      ['main', { ...common, entryPoints: [path.join(root, 'src/electron/main.ts')], outfile: path.join(outDir, 'main.js') }],
      ['preload', { ...common, target: 'chrome120', entryPoints: [path.join(root, 'src/electron/preload.ts')], outfile: path.join(outDir, 'preload.js') }],
    ]) {
      const ctx = await context(opts);
      await ctx.watch();
      console.log(`watching ${name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
