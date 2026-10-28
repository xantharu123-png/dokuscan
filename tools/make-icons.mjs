// Erzeugt die App-Icons (PNG) ohne externe Abhängigkeiten.
// Aufruf im Projektordner:  node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = { 'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180 };
const SUPERSAMPLE = 4;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TOP = hex('#3d8bff'), BOTTOM = hex('#1446b8');
const PAPER = hex('#ffffff'), LINES = hex('#b9c7de'), SCAN = hex('#34d399');

// Abstandsfunktionen (negativ = innen), Koordinaten 0 … 1
function roundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function capsule(x, y, ax, ay, bx, by, r) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - r;
}

function color(x, y) {
  let c = TOP.map((v, i) => v + (BOTTOM[i] - v) * y);

  // Blatt Papier mit Textzeilen
  if (roundRect(x, y, 0.5, 0.52, 0.2, 0.26, 0.03) < 0) {
    c = PAPER;
    const rows = [[0.36, 0.64], [0.36, 0.64], [0.36, 0.64], [0.36, 0.56]];
    rows.forEach(([x0, x1], i) => {
      const ly = 0.38 + i * 0.075;
      if (capsule(x, y, x0, ly, x1, ly, 0.013) < 0) c = LINES;
    });
  }

  // Scan-Rahmen: vier Winkel um das Blatt
  const L = 0.1, W = 0.02;
  const corners = [[0.22, 0.17, 1, 1], [0.78, 0.17, -1, 1], [0.78, 0.87, -1, -1], [0.22, 0.87, 1, -1]];
  for (const [cx, cy, dx, dy] of corners) {
    if (capsule(x, y, cx, cy, cx + dx * L, cy, W) < 0 || capsule(x, y, cx, cy, cx, cy + dy * L, W) < 0) c = SCAN;
  }
  return c;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const c = color((x + (sx + 0.5) / n) / size, (y + (sy + 0.5) / n) / size);
          sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(sum[0] / (n * n));
      px[i + 1] = Math.round(sum[1] / (n * n));
      px[i + 2] = Math.round(sum[2] / (n * n));
      px[i + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const [name, size] of Object.entries(SIZES)) {
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), encodePng(size, render(size)));
  console.log(`icons/${name} (${size}×${size})`);
}
