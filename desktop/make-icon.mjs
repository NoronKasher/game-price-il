/**
 * Generates the tray icon as a PNG.
 *
 * A tray needs a real image file and Node cannot encode one, so this writes the
 * bytes directly — it is a placeholder mark (the app's amber on its dark panel),
 * not artwork, and is meant to be replaced by a designed icon.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';


const BG = [13, 17, 23, 255]; // the app's panel
const FG = [255, 204, 85, 255]; // the app's amber

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A rounded amber square with a shekel-ish notch cut out of it. */
function pixel(x, y, SIZE) {
  const m = Math.round(SIZE * 0.09);
  const inside = x >= m && x < SIZE - m && y >= m && y < SIZE - m;
  if (!inside) return [0, 0, 0, 0];
  // Round the corners a little.
  const cx = x < SIZE / 2 ? m : SIZE - 1 - m;
  const cy = y < SIZE / 2 ? m : SIZE - 1 - m;
  const near = Math.hypot(x - cx, y - cy);
  const r = Math.round(SIZE * 0.13);
  const corner = (x < m + r + 1 || x > SIZE - m - r - 2) && (y < m + r + 1 || y > SIZE - m - r - 2);
  if (corner && near > r) return [0, 0, 0, 0];
  // Two amber bars on the dark panel — a price board, abstractly.
  const band = SIZE / 32;
  const bar =
    (y >= 10 * band && y <= 13 * band) || (y >= 18 * band && y <= 21 * band);
  return bar && x >= 8 * band && x <= 23 * band ? FG : BG;
}


/** One PNG per size: 32 for the tray, 256 because installers demand it. */
function render(SIZE) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = pixel(x, y, SIZE);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [size, file] of [
  [32, 'icon.png'],
  // electron-builder refuses anything smaller than 256 for a Windows install.
  [256, 'icon-256.png'],
]) {
  const out = path.join(import.meta.dirname, file);
  fs.writeFileSync(out, render(size));
  console.log(`wrote ${file} — ${size}x${size}`);
}
