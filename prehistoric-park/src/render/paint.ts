/**
 * Маленький софтверный «художник»: спрайты считаются попиксельно с нормалями,
 * освещением и шумовыми текстурами, а потом отдаются в Pixi как текстуры.
 * Так картинка получается объёмной, а в репозитории по-прежнему нет ни одного
 * файла-ассета.
 */
import { CanvasSource, Texture } from 'pixi.js';

/** Во сколько раз спрайты считаются подробнее мировых пикселей. */
export const SS = 2;

export type RGB = [number, number, number];

/** Свет сверху-слева и немного «на зрителя». */
const LX = -0.42;
const LY = -0.66;
const LZ = 0.62;
const LLEN = Math.hypot(LX, LY, LZ);
export const LIGHT: RGB = [LX / LLEN, LY / LLEN, LZ / LLEN];

export interface Material {
  /** Доля рассеянного света (0 — угольная тень, 1 — плоская заливка). */
  ambient?: number;
  /** Сила и резкость блика. */
  spec?: number;
  shine?: number;
  /** Подсветка по контуру — отделяет объект от фона. */
  rim?: number;
  /** Прозрачность мазка. */
  alpha?: number;
}

const DEF_AMBIENT = 0.42;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(color: RGB, nx: number, ny: number, nz: number, m: Material = {}): RGB {
  const amb = m.ambient ?? DEF_AMBIENT;
  const len = Math.hypot(nx, ny, nz) || 1;
  const x = nx / len;
  const y = ny / len;
  const z = nz / len;
  const diff = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
  let k = amb + (1 - amb) * diff;
  // Небо сверху добавляет холодного света, земля снизу — тёплого отражённого.
  const sky = clamp01(0.5 - y * 0.5);
  const out: RGB = [
    color[0] * k + sky * 10,
    color[1] * k + sky * 12,
    color[2] * k + sky * 18,
  ];
  if (m.spec) {
    // Отражение света относительно нормали, вид строго сверху (0,0,1).
    const d = 2 * diff;
    const rz = d * z - LIGHT[2];
    const s = Math.pow(Math.max(0, rz), m.shine ?? 24) * m.spec * 255;
    out[0] += s;
    out[1] += s;
    out[2] += s;
  }
  if (m.rim) {
    const r = Math.pow(1 - clamp01(z), 3) * m.rim * 255;
    out[0] += r * 0.7;
    out[1] += r * 0.8;
    out[2] += r;
  }
  return out;
}

/** Плавная ступенька — используется для сглаживания краёв. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

// ───────────────────────── шум ─────────────────────────

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Значный шум с периодом — соседние тайлы стыкуются без шва. */
export function noise(x: number, y: number, period: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (a: number) => a * a * (3 - 2 * a);
  const u = w(xf);
  const v = w(yf);
  const wrap = (a: number) => ((a % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, period: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, y * f, period * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ───────────────────────── холст ─────────────────────────

export class Painter {
  /** Размер в мировых пикселях. */
  readonly w: number;
  readonly h: number;
  /** Размер буфера. */
  readonly bw: number;
  readonly bh: number;
  readonly data: Float32Array;

  constructor(w: number, h: number, data?: Float32Array) {
    this.w = w;
    this.h = h;
    this.bw = Math.round(w * SS);
    this.bh = Math.round(h * SS);
    this.data = data ?? new Float32Array(this.bw * this.bh * 4);
  }

  clone(): Painter {
    return new Painter(this.w, this.h, this.data.slice());
  }

  /** Смешать цвет в пиксель буфера (координаты — в буферных пикселях). */
  blend(bx: number, by: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0 || bx < 0 || by < 0 || bx >= this.bw || by >= this.bh) return;
    const i = (by * this.bw + bx) * 4;
    const d = this.data;
    const inv = 1 - a;
    d[i] = d[i] * inv + r * a;
    d[i + 1] = d[i + 1] * inv + g * a;
    d[i + 2] = d[i + 2] * inv + b * a;
    d[i + 3] = d[i + 3] * inv + a;
  }

  /** Затемнить/осветлить готовый пиксель (для теней и контактов). */
  multiply(bx: number, by: number, k: number, a: number): void {
    if (bx < 0 || by < 0 || bx >= this.bw || by >= this.bh) return;
    const i = (by * this.bw + bx) * 4;
    const d = this.data;
    if (d[i + 3] <= 0) return;
    const m = 1 - (1 - k) * a;
    d[i] *= m;
    d[i + 1] *= m;
    d[i + 2] *= m;
  }

  alphaAt(bx: number, by: number): number {
    if (bx < 0 || by < 0 || bx >= this.bw || by >= this.bh) return 0;
    return this.data[(by * this.bw + bx) * 4 + 3];
  }

  toTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = this.bw;
    canvas.height = this.bh;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.bw, this.bh);
    const src = this.data;
    const dst = img.data;
    for (let i = 0; i < src.length; i += 4) {
      const a = clamp01(src[i + 3]);
      dst[i] = Math.max(0, Math.min(255, src[i]));
      dst[i + 1] = Math.max(0, Math.min(255, src[i + 1]));
      dst[i + 2] = Math.max(0, Math.min(255, src[i + 2]));
      dst[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
    return new Texture({
      source: new CanvasSource({ resource: canvas, resolution: SS, antialias: true }),
    });
  }
}

// ───────────────────────── примитивы ─────────────────────────

export interface ShapeOpts extends Material {
  /** Функция цвета: получает координаты внутри фигуры (0..1) и нормаль. */
  albedo?: (u: number, v: number) => RGB;
  /** Сплюснуть нормаль по Z — фигура кажется более плоской. */
  flat?: number;
}

/** Шар/эллипсоид: основа для голов, крон, камней, шатров. */
export function ball(
  p: Painter,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGB,
  o: ShapeOpts = {},
): void {
  const s = SS;
  const x0 = Math.max(0, Math.floor((cx - rx) * s) - 1);
  const x1 = Math.min(p.bw - 1, Math.ceil((cx + rx) * s) + 1);
  const y0 = Math.max(0, Math.floor((cy - ry) * s) - 1);
  const y1 = Math.min(p.bh - 1, Math.ceil((cy + ry) * s) + 1);
  const aa = 1 / (Math.min(rx, ry) * s);
  const flat = o.flat ?? 1;
  const alpha = o.alpha ?? 1;
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      const wx = (bx + 0.5) / s;
      const wy = (by + 0.5) / s;
      const nx = (wx - cx) / rx;
      const ny = (wy - cy) / ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1 + aa * 3) continue;
      const cov = 1 - smoothstep(1 - aa * 1.5, 1 + aa * 1.5, Math.sqrt(d2));
      if (cov <= 0.002) continue;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d2))) * flat;
      const col = o.albedo ? o.albedo((nx + 1) / 2, (ny + 1) / 2) : color;
      const c = shade(col, nx, ny, z, o);
      p.blend(bx, by, c[0], c[1], c[2], cov * alpha);
    }
  }
}

/** Капсула — брёвна, столбы, ветки, руки-ноги. */
export function capsule(
  p: Painter,
  ax: number,
  ay: number,
  bx2: number,
  by2: number,
  r: number,
  color: RGB,
  o: ShapeOpts = {},
): void {
  const s = SS;
  const minX = Math.max(0, Math.floor((Math.min(ax, bx2) - r) * s) - 1);
  const maxX = Math.min(p.bw - 1, Math.ceil((Math.max(ax, bx2) + r) * s) + 1);
  const minY = Math.max(0, Math.floor((Math.min(ay, by2) - r) * s) - 1);
  const maxY = Math.min(p.bh - 1, Math.ceil((Math.max(ay, by2) + r) * s) + 1);
  const ex = bx2 - ax;
  const ey = by2 - ay;
  const el2 = ex * ex + ey * ey || 1e-6;
  const aa = 1 / (r * s);
  const alpha = o.alpha ?? 1;
  const flat = o.flat ?? 1;
  for (let by = minY; by <= maxY; by++) {
    for (let bx = minX; bx <= maxX; bx++) {
      const wx = (bx + 0.5) / s;
      const wy = (by + 0.5) / s;
      let t = ((wx - ax) * ex + (wy - ay) * ey) / el2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t;
      const qy = ay + ey * t;
      const vx = (wx - qx) / r;
      const vy = (wy - qy) / r;
      const d = Math.hypot(vx, vy);
      if (d > 1 + aa * 3) continue;
      const cov = 1 - smoothstep(1 - aa * 1.5, 1 + aa * 1.5, d);
      if (cov <= 0.002) continue;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d * d))) * flat;
      const col = o.albedo ? o.albedo(t, (d + 1) / 2) : color;
      const c = shade(col, vx, vy, z, o);
      p.blend(bx, by, c[0], c[1], c[2], cov * alpha);
    }
  }
}

export interface FieldOpts extends Material {
  /** Высота поверхности: null — пикселя нет. */
  height: (u: number, v: number) => number | null;
  albedo: (u: number, v: number, h: number) => RGB;
  /** Насколько сильно рельеф влияет на нормаль. */
  relief?: number;
  /** Шаг для численной производной, в единицах u/v. */
  step?: number;
}

/**
 * Рельефная поверхность: считаем высоту, из неё — нормаль.
 * Это основа для земли, воды, камней, крыш и всего «мятого».
 */
export function field(
  p: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  o: FieldOpts,
): void {
  const s = SS;
  const x0 = Math.max(0, Math.floor(x * s));
  const x1 = Math.min(p.bw - 1, Math.ceil((x + w) * s) - 1);
  const y0 = Math.max(0, Math.floor(y * s));
  const y1 = Math.min(p.bh - 1, Math.ceil((y + h) * s) - 1);
  const relief = o.relief ?? 1;
  const eps = o.step ?? 1 / (Math.max(w, h) * s);
  const alpha = o.alpha ?? 1;
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      const u = ((bx + 0.5) / s - x) / w;
      const v = ((by + 0.5) / s - y) / h;
      const hh = o.height(u, v);
      if (hh === null) continue;
      const hx = o.height(u + eps, v);
      const hy = o.height(u, v + eps);
      const dx = hx === null ? 0 : (hx - hh) / eps;
      const dy = hy === null ? 0 : (hy - hh) / eps;
      const c = shade(o.albedo(u, v, hh), -dx * relief, -dy * relief, 1, o);
      p.blend(bx, by, c[0], c[1], c[2], alpha);
    }
  }
}

/** Мягкая тень под объектом. */
export function shadow(
  p: Painter,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  strength = 0.42,
): void {
  const s = SS;
  const x0 = Math.max(0, Math.floor((cx - rx) * s));
  const x1 = Math.min(p.bw - 1, Math.ceil((cx + rx) * s));
  const y0 = Math.max(0, Math.floor((cy - ry) * s));
  const y1 = Math.min(p.bh - 1, Math.ceil((cy + ry) * s));
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      const nx = ((bx + 0.5) / s - cx) / rx;
      const ny = ((by + 0.5) / s - cy) / ry;
      const d = Math.hypot(nx, ny);
      if (d > 1) continue;
      const a = (1 - d * d) * strength;
      p.blend(bx, by, 18, 14, 8, a);
    }
  }
}

/**
 * Грубое затенение складок: чем больше непрозрачных пикселей нависает сверху,
 * тем темнее пиксель. Даёт объём в местах стыка деталей.
 */
export function occlude(p: Painter, strength = 0.28, depth = 4): void {
  const d = p.data;
  const alpha = new Float32Array(p.bw * p.bh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  for (let by = 0; by < p.bh; by++) {
    for (let bx = 0; bx < p.bw; bx++) {
      const i = by * p.bw + bx;
      if (alpha[i] < 0.05) continue;
      let above = 0;
      for (let k = 1; k <= depth; k++) {
        const y = by - k;
        if (y < 0) break;
        if (alpha[y * p.bw + bx] > 0.4) above++;
      }
      if (above === 0) continue;
      const f = (above / depth) * strength;
      const j = i * 4;
      d[j] *= 1 - f;
      d[j + 1] *= 1 - f;
      d[j + 2] *= 1 - f;
    }
  }
}

/** Тонкая тёмная кромка: помогает читать спрайт на пёстром фоне. */
export function contour(p: Painter, strength = 0.5): void {
  const src = p.data.slice();
  const at = (bx: number, by: number) =>
    bx < 0 || by < 0 || bx >= p.bw || by >= p.bh ? 0 : src[(by * p.bw + bx) * 4 + 3];
  for (let by = 0; by < p.bh; by++) {
    for (let bx = 0; bx < p.bw; bx++) {
      const a = at(bx, by);
      if (a < 0.05) continue;
      const n = Math.min(at(bx - 1, by), at(bx + 1, by), at(bx, by - 1), at(bx, by + 1));
      if (n > 0.75) continue;
      const f = (1 - n) * strength * a;
      const i = (by * p.bw + bx) * 4;
      p.data[i] *= 1 - f;
      p.data[i + 1] *= 1 - f;
      p.data[i + 2] *= 1 - f;
    }
  }
}

/** Плоский многоугольник с постоянной нормалью — грани построек, доски, вода. */
export function poly(
  p: Painter,
  pts: number[],
  color: RGB,
  nx: number,
  ny: number,
  nz: number,
  o: ShapeOpts = {},
): void {
  const s = SS;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const x0 = Math.max(0, Math.floor(minX * s) - 1);
  const x1 = Math.min(p.bw - 1, Math.ceil(maxX * s) + 1);
  const y0 = Math.max(0, Math.floor(minY * s) - 1);
  const y1 = Math.min(p.bh - 1, Math.ceil(maxY * s) + 1);
  const n = pts.length / 2;
  const alpha = o.alpha ?? 1;
  const sub = 2; // подпиксельная выборка по краям
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      let hits = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const wx = (bx + (sx + 0.5) / sub) / s;
          const wy = (by + (sy + 0.5) / sub) / s;
          let inside = false;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = pts[i * 2];
            const yi = pts[i * 2 + 1];
            const xj = pts[j * 2];
            const yj = pts[j * 2 + 1];
            if (yi > wy !== yj > wy && wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi) {
              inside = !inside;
            }
          }
          if (inside) hits++;
        }
      }
      if (!hits) continue;
      const cov = hits / (sub * sub);
      const wx = (bx + 0.5) / s;
      const wy = (by + 0.5) / s;
      const col = o.albedo
        ? o.albedo((wx - minX) / (maxX - minX || 1), (wy - minY) / (maxY - minY || 1))
        : color;
      const c = shade(col, nx, ny, nz, o);
      p.blend(bx, by, c[0], c[1], c[2], cov * alpha);
    }
  }
}

/** Конус/шатёр: крыши хижин, ели, шляпы. */
export function cone(
  p: Painter,
  cx: number,
  apexY: number,
  baseY: number,
  rx: number,
  color: RGB,
  o: ShapeOpts = {},
): void {
  const s = SS;
  const ry = (baseY - apexY) * 0.16;
  const x0 = Math.max(0, Math.floor((cx - rx) * s) - 1);
  const x1 = Math.min(p.bw - 1, Math.ceil((cx + rx) * s) + 1);
  const y0 = Math.max(0, Math.floor(apexY * s) - 1);
  const y1 = Math.min(p.bh - 1, Math.ceil((baseY + ry) * s) + 1);
  const height = baseY - apexY;
  const slope = rx / Math.max(0.001, height);
  const alpha = o.alpha ?? 1;
  for (let by = y0; by <= y1; by++) {
    for (let bx = x0; bx <= x1; bx++) {
      const wx = (bx + 0.5) / s;
      const wy = (by + 0.5) / s;
      const t = (wy - apexY) / height; // 0 у вершины, 1 у основания
      if (t < 0) continue;
      const half = rx * Math.min(1, t);
      let u = (wx - cx) / Math.max(0.001, half);
      let cov: number;
      if (t <= 1) {
        cov = 1 - smoothstep(1 - 1 / (half * s + 1), 1 + 1 / (half * s + 1), Math.abs(u));
      } else {
        // Скруглённое основание конуса.
        const dy = (wy - baseY) / ry;
        const d = Math.hypot((wx - cx) / rx, dy);
        cov = 1 - smoothstep(0.98, 1.02, d);
        u = (wx - cx) / rx;
      }
      if (cov <= 0.002) continue;
      u = Math.max(-1, Math.min(1, u));
      const nz = Math.sqrt(Math.max(0, 1 - u * u));
      const col = o.albedo ? o.albedo((u + 1) / 2, Math.min(1, t)) : color;
      const c = shade(col, u, -slope * 0.55, nz, o);
      p.blend(bx, by, c[0], c[1], c[2], cov * alpha);
    }
  }
}
