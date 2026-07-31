// Генератор иконок PWA: рисуем пиксели вручную и пакуем в PNG через zlib.
// Запуск: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // фильтр «none»
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Иконка: небо, холм, солнце и полосатая крыша карусели с шестом. */
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };
  const S = size;
  const round = S * 0.18;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // скруглённый угол
      const dx = Math.max(round - x, x - (S - 1 - round), 0);
      const dy = Math.max(round - y, y - (S - 1 - round), 0);
      if (Math.hypot(dx, dy) > round) continue;

      if (y > S * 0.68) put(x, y, 0x5a, 0xa3, 0x2e);
      else put(x, y, 0x7e, 0xc8, 0xf0);
    }
  }
  // солнце
  const sx = S * 0.76;
  const sy = S * 0.24;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (Math.hypot(x - sx, y - sy) < S * 0.11) put(x, y, 0xf5, 0xcf, 0x3d);

  // шест и настил карусели
  const cx = S * 0.44;
  for (let y = Math.floor(S * 0.36); y < S * 0.78; y++)
    for (let x = Math.floor(cx - S * 0.025); x < cx + S * 0.025; x++)
      put(x, y, 0x8b, 0x5a, 0x2b);
  for (let y = Math.floor(S * 0.72); y < S * 0.8; y++)
    for (let x = Math.floor(cx - S * 0.3); x < cx + S * 0.3; x++)
      if (Math.abs(x - cx) / (S * 0.3) < Math.sqrt(1 - Math.pow((y - S * 0.76) / (S * 0.04), 2)))
        put(x, y, 0xc7, 0x9a, 0x52);

  // полосатая крыша
  for (let y = Math.floor(S * 0.26); y < S * 0.42; y++) {
    const half = ((y - S * 0.26) / (S * 0.16)) * S * 0.32;
    for (let x = Math.floor(cx - half); x < cx + half; x++) {
      const stripe = Math.floor(((x - cx) / (S * 0.07)) % 2 + 2) % 2;
      if (stripe === 0) put(x, y, 0xd9, 0x41, 0x41);
      else put(x, y, 0xf0, 0xe6, 0xcf);
    }
  }
  // обводка крыши
  for (let y = Math.floor(S * 0.26); y < S * 0.42; y++) {
    const half = ((y - S * 0.26) / (S * 0.16)) * S * 0.32;
    for (let d = 0; d < Math.max(2, S * 0.012); d++) {
      put(Math.floor(cx - half + d), y, 0x2a, 0x1c, 0x10);
      put(Math.floor(cx + half - d), y, 0x2a, 0x1c, 0x10);
    }
  }
  return buf;
}

mkdirSync(OUT, { recursive: true });
for (const size of [32, 180, 192, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : size === 32 ? 'favicon.png' : `icon-${size}.png`;
  writeFileSync(resolve(OUT, name), png(size, size, draw(size)));
  console.log('written', name);
}
