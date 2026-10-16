/**
 * Isolated checks for the pieces that are hard to eyeball in the running app:
 * the native Windows input layer, the keyboard-hook child process, and the
 * bundled main process.
 *
 * Run with `npm run smoke`. Deliberately does not launch the GUI — it verifies
 * the load-bearing native bits, which are what break silently.
 *
 * Like the model fetcher, this runs under plain Node with no local imports.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ------------------------------------------------------------ main bundle

section('Build artifacts');
for (const [label, rel] of [
  ['main process bundle', 'dist-electron/main.js'],
  ['preload bundle', 'dist-electron/preload.js'],
  ['keyboard hook child', 'dist-electron/hotkey-hook.cjs'],
  ['renderer index', 'out/index.html'],
  ['audio worklet', 'out/worklets/pcm-capture.js'],
]) {
  const p = path.join(root, rel);
  const exists = fs.existsSync(p);
  record(label, exists, exists ? `${(fs.statSync(p).size / 1024).toFixed(1)} KB` : `missing: ${rel}`);
}

// ----------------------------------------------------- syntax of main bundle

section('Bundle parses');
{
  // `--check` parses without executing, catching a broken build without
  // needing Electron's runtime.
  const r = spawnSync(process.execPath, ['--check', path.join(root, 'dist-electron/main.js')], {
    encoding: 'utf8',
  });
  record('main.js parses', r.status === 0, r.stderr.trim().split('\n')[0] ?? '');

  const r2 = spawnSync(process.execPath, ['--check', path.join(root, 'dist-electron/hotkey-hook.cjs')], {
    encoding: 'utf8',
  });
  record('hotkey-hook.cjs parses', r2.status === 0, r2.stderr.trim().split('\n')[0] ?? '');
}

// --------------------------------------------------- keyboard hook handshake

section('Keyboard hook child process');
await new Promise((resolve) => {
  // Exercise the same multi-binding argument path as the app. We never press a
  // key here; installation and the ready handshake are what this probes.
  const bindings = Buffer.from(JSON.stringify([
    { id: 'current', vk: 0, mods: [0x11, 0x5b] },
    { id: 'translate-llm', vk: 0, mods: [0x11, 0x5b, 0x10] },
  ])).toString('base64url');
  const child = spawn(
    process.execPath,
    [path.join(root, 'dist-electron/hotkey-hook.cjs'), '--bindings', bindings],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let out = '';
  let err = '';
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    resolve();
  };

  const timer = setTimeout(() => {
    record('hook reports ready', false, `timed out; stderr=${err.trim().slice(0, 200)}`);
    done();
  }, 8000);

  child.stdout.on('data', (c) => {
    out += c.toString();
    if (out.includes('"ready"')) {
      record('hook reports ready', true, 'SetWindowsHookEx accepted the WH_KEYBOARD_LL hook');
      done();
    } else if (out.includes('"fatal"')) {
      record('hook reports ready', false, out.trim());
      done();
    }
  });
  child.stderr.on('data', (c) => {
    err += c.toString();
  });
  child.on('error', (e) => {
    record('hook reports ready', false, e.message);
    done();
  });
  child.on('exit', (code) => {
    if (!settled) {
      record('hook reports ready', false, `exited ${code} before ready`);
      done();
    }
  });
});

// ------------------------------------------------------------- win32 layer

section('Windows input layer (via Electron)');
{
  // koffi needs Electron's ABI here only in the packaged app; under plain Node
  // the same prebuilt binary is used, so this is representative.
  const probe = `
    const path = require('path');
    const root = ${JSON.stringify(root)};
    const koffi = require(path.join(root, 'node_modules/koffi'));
    const user32 = koffi.load('user32.dll');
    const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
    const kernel32 = koffi.load('kernel32.dll');
    const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint32, uintptr)');
    const hwnd = GetForegroundWindow();
    if (!hwnd) { console.log('NO_FG'); process.exit(1); }
    const p = GlobalAlloc(0x0002, 64);
    if (!p) { console.log('NO_ALLOC'); process.exit(1); }
    console.log('OK');
  `;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  record(
    'user32 + kernel32 reachable',
    r.stdout.includes('OK'),
    (r.stdout || r.stderr).trim().split('\n').slice(0, 2).join(' | '),
  );
}

// -------------------------------------------------- sherpa-onnx native addon

section('sherpa-onnx native addon');
{
  const probe = `
    const path = require('path');
    const root = ${JSON.stringify(root)};
    const sherpa = require(path.join(root, 'node_modules/sherpa-onnx-node'));
    const needed = ['Vad', 'OfflineRecognizer'];
    const missing = needed.filter((n) => typeof sherpa[n] !== 'function');
    if (missing.length) { console.log('MISSING:' + missing.join(',')); process.exit(1); }
    console.log('OK onnxruntime ' + sherpa.onnxruntimeVersion);
  `;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  record(
    'Vad + OfflineRecognizer constructors present',
    r.stdout.includes('OK'),
    (r.stdout || r.stderr).trim().split('\n').slice(0, 2).join(' | '),
  );
}

// -------------------------------------------------------------------- models

section('On-device models');
{
  // Same resolution order as the app, so this checks the copy actually in use.
  const override = process.env.VIBETYPE_MODELS_DIR;
  const models = override && override.trim()
    ? path.resolve(override.trim())
    : path.join(root, 'models');

  console.log(`    (looking in ${models})`);

  // Sizes are checked, not just existence: a half-extracted model is a
  // truncated ONNX graph, and onnxruntime aborts the process on one rather than
  // throwing. An existence-only check reports success right up until the app
  // dies on the first hotkey press.
  const checks = [
    {
      label: 'Silero VAD',
      dir: path.join(models, 'silero-vad'),
      files: { 'silero_vad.onnx': 643854 },
    },
    {
      label: 'SenseVoice ASR',
      dir: path.join(models, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'),
      files: { 'model.onnx': 937617178, 'tokens.txt': 315894 },
    },
  ];

  let anyMissing = false;

  for (const check of checks) {
    const problems = [];
    for (const [file, expected] of Object.entries(check.files)) {
      const p = path.join(check.dir, file);
      if (!fs.existsSync(p)) {
        problems.push(`${file} missing`);
        anyMissing = true;
        continue;
      }
      const size = fs.statSync(p).size;
      if (size !== expected) {
        problems.push(`${file} is ${size} bytes, expected ${expected}`);
      }
    }
    record(check.label, problems.length === 0, problems.join('; ') || check.dir);
  }

  if (anyMissing) {
    console.log(
      '\n  Note: models are optional here. The app runs with a cloud provider,\n' +
        '  or downloads them from Settings on first run.',
    );
  }
}

// ------------------------------------------------------------------- summary

section('Summary');
console.log(`  ${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`    - ${r.name}: ${r.detail}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
