// Generates design/app-icon.png (1024x1024): deep-blue rounded square with a
// white paper-plane glyph. Pure Node, no image dependencies. Run:
//   node scripts/make-icon.mjs && npx tauri icon design/app-icon.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const SS = 3; // supersampling factor for edge antialiasing

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedSquare(px, py) {
  const half = SIZE * 0.47;
  const radius = SIZE * 0.215;
  const dx = Math.abs(px - SIZE / 2) - (half - radius);
  const dy = Math.abs(py - SIZE / 2) - (half - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - radius <= 0;
}

// Material "send" outline, mapped from its 24-unit space into the icon.
const PLANE = [
  [2, 21],
  [23, 12],
  [2, 3],
  [2, 10],
  [17, 12],
  [2, 14],
].map(([x, y]) => [236 + ((x - 2) / 21) * 560, 232 + ((y - 3) / 18) * 560]);

function insidePlane(px, py) {
  let inside = false;
  for (let i = 0, j = PLANE.length - 1; i < PLANE.length; j = i++) {
    const [xi, yi] = PLANE[i];
    const [xj, yj] = PLANE[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const BG_TOP = [36, 70, 107];
const BG_BOTTOM = [20, 38, 61];
const PLANE_COLOR = [247, 250, 252];

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let covered = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        if (!insideRoundedSquare(px, py)) continue;
        covered += 1;
        const t = py / SIZE;
        if (insidePlane(px, py)) {
          r += PLANE_COLOR[0];
          g += PLANE_COLOR[1];
          b += PLANE_COLOR[2];
        } else {
          r += BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
          g += BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
          b += BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;
        }
      }
    }
    const samples = SS * SS;
    const offset = (y * SIZE + x) * 4;
    if (covered === 0) {
      rgba[offset + 3] = 0;
    } else {
      rgba[offset] = Math.round(r / samples);
      rgba[offset + 1] = Math.round(g / samples);
      rgba[offset + 2] = Math.round(b / samples);
      rgba[offset + 3] = Math.round((covered / samples) * 255);
    }
  }
}

mkdirSync(resolve(root, "design"), { recursive: true });
const out = resolve(root, "design", "app-icon.png");
writeFileSync(out, encodePng(SIZE, SIZE, rgba));
console.log(`wrote ${out}`);
