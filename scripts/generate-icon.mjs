#!/usr/bin/env node
/**
 * Generates the Vokluna app icon from code.
 *
 * The mark is the same waveform the recording overlay draws — a centred group of
 * rounded bars — so the icon and the live indicator are visibly the same thing
 * rather than two unrelated designs that drift apart over time.
 *
 * Generated rather than committed as a binary so the geometry is reviewable and
 * the whole set (ICO sizes, tray PNG) can be regenerated if the palette changes.
 *
 *   node scripts/generate-icon.mjs            # write build/icon.ico + build/icon.png
 *   node scripts/generate-icon.mjs --preview  # also print an ASCII proof
 *
 * The PNG encoder and ICO writer are inline because the alternative is a
 * build-time dependency on a native image library, for two files.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');

/** Supersampling factor. Each output pixel is the mean of SS² sub-samples. */
const SS = 4;

// ------------------------------------------------------------------ palette

/**
 * Tile gradient, top to bottom. A pale neutral tile keeps the dark waveform
 * legible in the taskbar, Explorer, shortcuts, and the window chrome.
 */
const TILE_TOP = [250, 250, 249];
const TILE_BOTTOM = [231, 231, 229];
/** Dark waveform bars read crisply at small sizes and match the requested mark. */
const BAR_COLOR = [18, 18, 20];
/** Corner radius of the tile, as a fraction of the icon size. */
const TILE_RADIUS = 0.22;

// ------------------------------------------------------------------ geometry

/**
 * Bar layout for a given icon size.
 *
 * Fewer, thicker bars at tiny sizes: a 16 px icon has room for roughly 16 usable
 * pixels across, so five bars would leave each one thinner than a pixel and the
 * mark would smear into a grey block. Three bars still read as a waveform.
 *
 * Small sizes are snapped to whole pixels. Without that, a 1.68 px bar straddles
 * the boundary between two columns, so supersampling resolves it to ~50% alpha
 * in each and the rendered bar looks washed out and soft — the middle bar in
 * particular stops reading as a bar at all. Integer edges give full-coverage
 * interiors and clean sides. Heights are forced to the same parity as the icon
 * size so that `centreY - h/2` is also an integer.
 */
function markGeometry(size) {
  const snap = size <= 24;

  const weights = snap ? [0.42, 0.66, 0.42] : [0.30, 0.52, 0.74, 0.52, 0.30];
  const count = weights.length;

  let barW = (snap ? 0.125 : 0.075) * size;
  let gap = (snap ? 0.125 : 0.042) * size;

  if (snap) {
    barW = Math.max(1, Math.round(barW));
    gap = Math.max(1, Math.round(gap));
  }

  // `size - groupW` must be even for the group to sit on a half-pixel-free
  // centre. With odd barW the group is odd-centred, so nudge the gap instead of
  // the bar: changing bar width would visibly thicken or thin the mark.
  if (snap) {
    let groupW = count * barW + (count - 1) * gap;
    if ((size - groupW) % 2 !== 0) {
      gap += 1;
      groupW = count * barW + (count - 1) * gap;
    }
  }

  const groupW = count * barW + (count - 1) * gap;
  const startX = snap ? Math.round((size - groupW) / 2) : (size - groupW) / 2;
  const centreY = size / 2;
  const radius = barW / 2;

  return weights.map((w, i) => {
    let h = w * size;
    if (snap) {
      h = Math.max(1, Math.round(h));
      // Same parity as `size` keeps both the top and bottom edge integral.
      if ((size - h) % 2 !== 0) h = Math.max(1, h - 1);
    }
    return {
      x: startX + i * (barW + gap),
      y: centreY - h / 2,
      w: barW,
      h,
      r: radius,
    };
  });
}

/** Point-in-rounded-rectangle test, used as the coverage predicate. */
function inRoundedRect(px, py, { x, y, w, h, r }) {
  const rad = Math.min(r, w / 2, h / 2);
  // Closest point on the rect's inner core; distance to it is the test.
  const cx = Math.min(Math.max(px, x + rad), x + w - rad);
  const cy = Math.min(Math.max(py, y + rad), y + h - rad);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rad * rad;
}

// ------------------------------------------------------------------ raster

/**
 * Render one icon at `size` px, supersampled, as straight (non-premultiplied)
 * RGBA — which is what both PNG and the ICO's PNG entries want.
 */
function render(size) {
  const bars = markGeometry(size);
  const out = Buffer.alloc(size * size * 4);
  const step = 1 / SS;
  const inv = 1 / (SS * SS);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tileHits = 0;
      let barHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;

          if (inRoundedRect(px, py, { x: 0, y: 0, w: size, h: size, r: TILE_RADIUS * size })) {
            tileHits++;
          }
          for (const bar of bars) {
            if (inRoundedRect(px, py, bar)) {
              barHits++;
              break;
            }
          }
        }
      }

      const tileA = tileHits * inv;
      const barA = barHits * inv;
      const i = (y * size + x) * 4;

      // Gradient is sampled per pixel, not per sub-sample — at these sizes the
      // difference is invisible and this halves the work.
      const t = size > 1 ? y / (size - 1) : 0;
      let R = TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t;
      let G = TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t;
      let B = TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t;

      // Composite dark bars over the light tile.
      R = R * (1 - barA) + BAR_COLOR[0] * barA;
      G = G * (1 - barA) + BAR_COLOR[1] * barA;
      B = B * (1 - barA) + BAR_COLOR[2] * barA;

      out[i] = Math.round(R);
      out[i + 1] = Math.round(G);
      out[i + 2] = Math.round(B);
      // Fully opaque wherever the tile covers, transparent outside its corners.
      out[i + 3] = Math.round(tileA * 255);
    }
  }

  return out;
}

/** Monochrome variant for the tray: dark bars, no tile. */
function renderTray(size) {
  const bars = markGeometry(size);
  const out = Buffer.alloc(size * size * 4);
  const step = 1 / SS;
  const inv = 1 / (SS * SS);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          for (const bar of bars) {
            if (inRoundedRect(px, py, bar)) {
              hits++;
              break;
            }
          }
        }
      }
      const a = hits * inv;
      const i = (y * size + x) * 4;
      out[i] = BAR_COLOR[0];
      out[i + 1] = BAR_COLOR[1];
      out[i + 2] = BAR_COLOR[2];
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------------ png

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode straight RGBA as a PNG. */
function encodePng(size, rgba) {
  const stride = size * 4;
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ ico

/**
 * Multi-resolution ICO with PNG-compressed entries.
 *
 * PNG payloads are used rather than BMP because Windows Vista and later read
 * them natively and they preserve the alpha channel without the legacy AND-mask
 * dance — which is exactly where hand-rolled icon tooling usually produces
 * black fringes around the transparent corners.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;

  entries.forEach((entry, i) => {
    const b = i * 16;
    // A dimension byte of 0 means 256; ICO cannot express anything larger.
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, b);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, b + 1);
    dir.writeUInt8(0, b + 2); // palette size
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // colour planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ------------------------------------------------------------------ preview

/**
 * Terminal proof that the mark actually rasterises as intended.
 *
 * There is no way to look at the generated image in this environment, so the
 * shape is downsampled to characters: '#' for a bar, ':' for bare tile, ' ' for
 * transparent. Reading the waveform in that output is the check.
 */
function preview(size) {
  const rgba = render(size);
  const lines = [];
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      if (a < 128) line += ' ';
      else if (r > 200 && g > 200 && b > 200) line += '#';
      else line += ':';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ main

function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // Sizes Windows actually asks for: 16/24/32 in the taskbar and tray flyout,
  // 48/64 in Explorer, 128/256 in the large-icon views and the installer.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const entries = sizes.map((size) => ({ size, png: encodePng(size, render(size)) }));

  const icoPath = path.join(BUILD_DIR, 'icon.ico');
  fs.writeFileSync(icoPath, encodeIco(entries));

  // electron-builder also wants a plain PNG for non-Windows targets and for the
  // installer header, at 512 px.
  const pngPath = path.join(BUILD_DIR, 'icon.png');
  fs.writeFileSync(pngPath, encodePng(512, render(512)));

  // Tray asset, in case the drawn-at-runtime path is ever replaced by a file.
  const trayPath = path.join(BUILD_DIR, 'tray.png');
  fs.writeFileSync(trayPath, encodePng(32, renderTray(32)));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
  console.log(`  build/icon.ico   ${entries.length} sizes (${sizes.join(', ')})  ${kb(icoPath)}`);
  console.log(`  build/icon.png   512x512   ${kb(pngPath)}`);
  console.log(`  build/tray.png   32x32     ${kb(trayPath)}`);

  if (process.argv.includes('--preview')) {
    console.log('\n--- 32x32 ---\n' + preview(32));
    console.log('\n--- 16x16 ---\n' + preview(16));
  }
}

main();
