/**
 * Pre-fetch the on-device models into the Electron userData directory, so a
 * fresh install can dictate offline immediately.
 *
 * Run with `npm run models:download`. The app also downloads these on demand
 * from Settings; this script exists for CI and for setting up a machine ahead
 * of time.
 *
 * It deliberately re-implements the tiny bit of `electron.app.getPath` logic it
 * needs, because it runs under plain Node (`-I`-safe: no local imports).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';

// Expected sizes are pinned so a half-extracted model is treated as damaged
// rather than "already present". Existence alone is not a safe check: a
// truncated ONNX graph makes onnxruntime abort the whole process instead of
// throwing, which shows up as the app vanishing on the first hotkey press.
const TARGETS = [
  {
    name: 'silero-vad',
    kind: 'file',
    urls: [
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
      'https://hf-mirror.com/csukuangfj/sherpa-onnx-vad-models/resolve/main/silero_vad.onnx',
    ],
    file: 'silero_vad.onnx',
    files: { 'silero_vad.onnx': 643854 },
  },
  {
    name: SENSE_VOICE_DIR,
    kind: 'tar',
    urls: [
      `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${SENSE_VOICE_DIR}.tar.bz2`,
    ],
    required: ['model.onnx', 'tokens.txt'],
    files: { 'model.onnx': 937617178, 'tokens.txt': 315894 },
  },
];

/**
 * Resolve the models directory the same way the app does, so this script and the
 * app never disagree about where the models are.
 *
 * Priority: an explicit override, then `<project>/models`. The app itself falls
 * back to `userData` when the project directory is not writable; that case is
 * not reproduced here because a manual download implies a working checkout.
 */
function resolveModelsRoot() {
  const override = process.env.VIBETYPE_MODELS_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(repoRoot, 'models');
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsRoot = resolveModelsRoot();

function fetchTo(url, dest, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'user-agent': 'ReadyFinch-model-fetch', accept: '*/*' } },
      (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`too many redirects at ${url}`));
          return fetchTo(new URL(headers.location, url).toString(), dest, redirectsLeft - 1)
            .then(resolve, reject);
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} from ${url}`));
        }

        const total = Number(headers['content-length'] ?? 0);
        let received = 0;
        let lastPct = -1;
        const out = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (!total) return;
          const pct = Math.floor((received / total) * 20) * 5;
          if (pct !== lastPct) {
            lastPct = pct;
            process.stdout.write(`\r    ${String(pct).padStart(3)}%`);
          }
        });

        res.pipe(out);
        out.on('finish', () => out.close(() => {
          process.stdout.write('\r    100%\n');
          if (total && received !== total) {
            return reject(new Error(`truncated: ${received}/${total}`));
          }
          resolve();
        }));
        out.on('error', reject);
        res.on('error', reject);
      },
    );
    req.setTimeout(120_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * Extract into `destDir`, dropping the archive's single top-level folder so the
 * files land directly beside each other — which is where the app's
 * `isInstalled()` check looks for them.
 */
function untar(archive, destDir) {
  return new Promise((resolve, reject) => {
    const args = ['-xjf', archive, '-C', destDir, '--strip-components=1'];
    const child = spawn('tar', args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err.trim()}`)),
    );
  });
}

async function main() {
  console.log(`models root: ${modelsRoot}`);
  await fsp.mkdir(modelsRoot, { recursive: true });

  /** Report which expected files are missing or the wrong size. */
  function problemsWith(target) {
    const dir = path.join(modelsRoot, target.name);
    const problems = [];
    for (const [file, expected] of Object.entries(target.files)) {
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) {
        problems.push(`${file}: missing`);
        continue;
      }
      const size = fs.statSync(p).size;
      if (size !== expected) problems.push(`${file}: ${size} bytes, expected ${expected}`);
    }
    return problems;
  }

  for (const target of TARGETS) {
    const dir = path.join(modelsRoot, target.name);

    const problems = problemsWith(target);
    if (problems.length === 0) {
      console.log(`✓ ${target.name} already present and complete`);
      continue;
    }

    // A damaged install would otherwise be skipped, so clear it and start over.
    // Everything is rebuilt from the archive, so there is nothing to preserve.
    if (problems.some((p) => !p.endsWith(': missing'))) {
      console.log(`! ${target.name} is incomplete (${problems.join('; ')}) — reinstalling`);
      await fsp.rm(dir, { recursive: true, force: true });
    }

    console.log(`› fetching ${target.name}`);
    await fsp.mkdir(dir, { recursive: true });

    let lastError = null;
    for (const url of target.urls) {
      try {
        if (target.kind === 'file') {
          await fetchTo(url, path.join(dir, target.file));
        } else {
          const archive = path.join(modelsRoot, `${target.name}.tar.bz2`);
          await fetchTo(url, archive);
          await untar(archive, dir);
          await fsp.rm(archive, { force: true });
        }

        const remaining = problemsWith(target);
        if (remaining.length) throw new Error(`extracted files look wrong: ${remaining.join('; ')}`);

        console.log(`✓ ${target.name}`);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.log(`  ✗ ${url}\n    ${err.message}`);
      }
    }

    if (lastError) throw lastError;
  }

  console.log('\nAll models ready. Launch Ready Finch and dictate offline.');
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
