// Generates build/icon.ico — original Orbit mark (PNG-in-ICO, 256x256).
// No external assets: rasterized rounded square + orbit ring + planet dot.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const S = 256;
const buf = Buffer.alloc(S * S * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function mix(x, y, c, t) {
  // blend color c=[r,g,b,a] over existing pixel with coverage t (0..1)
  const i = (y * S + x) * 4;
  const sa = (c[3] / 255) * t;
  const da = buf[i + 3] / 255;
  const out = sa + da * (1 - sa);
  if (out <= 0) return;
  buf[i] = Math.round((c[0] * sa + buf[i] * da * (1 - sa)) / out);
  buf[i + 1] = Math.round((c[1] * sa + buf[i + 1] * da * (1 - sa)) / out);
  buf[i + 2] = Math.round((c[2] * sa + buf[i + 2] * da * (1 - sa)) / out);
  buf[i + 3] = Math.round(out * 255);
}
function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

// Background: dark charcoal rounded square with subtle vertical gradient.
const R = 56;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = Math.min(x, S - 1 - x);
    const dy = Math.min(y, S - 1 - y);
    let inside;
    if (dx >= R || dy >= R) inside = 1;
    else {
      const cx = R - dx, cy = R - dy;
      inside = smooth((R - Math.hypot(cx, cy)) / 2 + 0.5);
    }
    const t = y / (S - 1);
    setPx(x, y, lerp(26, 14, t), lerp(29, 18, t), lerp(37, 26, t), Math.round(255 * inside));
  }
}

// Orbit ring (accent indigo), tilted ellipse.
const ACC = [108, 140, 255, 255];
const cx = S / 2, cy = S / 2 - 6, rx = 88, ry = 34, tilt = -0.42, TH = 11;
const cos = Math.cos(tilt), sin = Math.sin(tilt);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const px0 = x - cx, py0 = y - cy;
    const ex = (px0 * cos + py0 * sin) / rx;
    const ey = (-px0 * sin + py0 * cos) / ry;
    const d = Math.abs(Math.hypot(ex, ey) - 1) * Math.min(rx, ry);
    if (d < TH) mix(x, y, ACC, smooth(1 - d / TH));
  }
}

// Planet dot (warm sand) sitting on the ring, lower right.
const PD = [240, 163, 94, 255];
const pdx = cx + 62, pdy = cy + 40, pr = 20;
for (let y = Math.floor(pdy - pr - 2); y <= Math.ceil(pdy + pr + 2); y++) {
  for (let x = Math.floor(pdx - pr - 2); x <= Math.ceil(pdx + pr + 2); x++) {
    if (x < 0 || y < 0 || x >= S || y >= S) continue;
    const d = Math.hypot(x - pdx, y - pdy);
    if (d < pr) mix(x, y, PD, smooth(1 - (d - (pr - 3)) / 3));
  }
}

// A few tiny stars.
for (const [sx, sy, sr] of [[52, 60, 3], [200, 52, 2.4], [36, 180, 2.6], [216, 196, 3.2], [120, 40, 2]]) {
  for (let y = Math.floor(sy - sr - 1); y <= Math.ceil(sy + sr + 1); y++) {
    for (let x = Math.floor(sx - sr - 1); x <= Math.ceil(sx + sr + 1); x++) {
      const d = Math.hypot(x - sx, y - sy);
      if (d < sr) mix(x, y, [232, 234, 240, 255], smooth(1 - d / sr) * 0.9);
    }
  }
}

// Encode PNG (RGBA8, filter 0).
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, color type RGBA
const raw = Buffer.alloc(S * (1 + S * 4));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0;
  buf.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// Wrap PNG in ICO container.
const head = Buffer.alloc(6 + 16);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; // 256x256
head[8] = 0; head[9] = 0;
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(6 + 16, 18);
const ico = Buffer.concat([head, png]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log(`icon.ico written (${ico.length} bytes)`);

// Installer sidebar art (164x314, 24-bit BMP): indigo -> charcoal gradient
// with a soft orbit ring, matching the app icon.
const BW = 164, BH = 314;
const rowSize = BW * 3; // 492, already a multiple of 4
const pixels = Buffer.alloc(rowSize * BH);
for (let y = 0; y < BH; y++) {
  for (let x = 0; x < BW; x++) {
    const t = y / (BH - 1);
    let r = lerp(64, 16, t), g = lerp(84, 19, t), b = lerp(168, 28, t);
    // soft ring arcs
    const dx = x - BW / 2, dy = (y - BH * 0.32) * 1.9;
    const d = Math.abs(Math.hypot(dx, dy) - 62);
    if (d < 7) {
      const k = smooth(1 - d / 7) * 0.8;
      r = lerp(r, 150, k); g = lerp(g, 175, k); b = lerp(b, 255, k);
    }
    // planet dot
    if (Math.hypot(x - 118, y - 118) < 13) { r = 240; g = 163; b = 94; }
    const off = (BH - 1 - y) * rowSize + x * 3; // BMP rows are bottom-up
    pixels[off] = b; pixels[off + 1] = g; pixels[off + 2] = r;
  }
}
const fileSize = 14 + 40 + pixels.length;
const bmp = Buffer.alloc(fileSize);
bmp.write('BM', 0); bmp.writeUInt32LE(fileSize, 2); bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(BW, 18); bmp.writeInt32LE(BH, 22);
bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(pixels.length, 34);
pixels.copy(bmp, 54);
fs.writeFileSync(path.join(outDir, 'installerSidebar.bmp'), bmp);
console.log(`installerSidebar.bmp written (${bmp.length} bytes)`);
