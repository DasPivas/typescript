/**
 * Все спрайты игры. Рисуются попиксельно (см. paint.ts): у каждой фигуры есть
 * нормаль, поэтому свет, тени и блики считаются честно, а материалы задаются
 * шумовыми текстурами — дерево, солома, камень, вода, шкура.
 */
import type { Renderer, Texture } from 'pixi.js';
import { ALL_DEFS } from '../core/catalog';
import {
  ball,
  capsule,
  cone,
  contour,
  fbm,
  field,
  mix,
  noise,
  occlude,
  Painter,
  poly,
  shadow,
  smoothstep,
  type RGB,
  type ShapeOpts,
} from './paint';

/** Размер клетки в пикселях мира. */
export const TILE = 32;
/** Насколько постройка «торчит» вверх над своей клеткой (псевдо-объём). */
export const LIFT = 0.7;

export interface Art {
  terrain: Texture[];
  water: Texture;
  rock: Texture;
  roadDirt: Texture;
  roadStone: Texture;
  /** Кадры анимации; у статичных построек в массиве один элемент. */
  buildings: Record<string, Texture[]>;
  /** [оттенок][кадр]; кадр 3 — сидящая поза. */
  visitor: Texture[][];
  staff: Record<string, Texture>;
  wish: Record<string, Texture>;
  entrance: Texture;
}

/** Эти крутятся всегда, а не только когда внутри есть гости. */
export const ALWAYS_ANIMATED = new Set(['dinomotor', 'istochnik']);

// ───────────────────────── палитра ─────────────────────────

const WOOD: RGB = [126, 86, 48];
const WOOD_D: RGB = [86, 57, 30];
const WOOD_L: RGB = [170, 128, 78];
const BARK: RGB = [96, 70, 44];
const THATCH: RGB = [188, 150, 78];
const LEAF: RGB = [62, 116, 44];
const LEAF_D: RGB = [38, 76, 32];
const LEAF_L: RGB = [124, 176, 66];
const LEAF_HL: RGB = [154, 200, 84];
const DIRT: RGB = [158, 118, 72];
const SAND: RGB = [198, 162, 102];
const STONE: RGB = [142, 136, 124];
const STONE_D: RGB = [96, 92, 84];
const WATER: RGB = [38, 102, 154];
const WATER_L: RGB = [110, 182, 222];
const SKIN: RGB = [216, 158, 108];
const FUR: RGB = [206, 172, 96];
const FUR_SPOT: RGB = [118, 80, 36];
const HAIR: RGB = [56, 38, 24];
const BONE: RGB = [232, 222, 196];
const CLOTH: RGB = [186, 68, 52];
const YELLOW: RGB = [228, 188, 72];
const IRON: RGB = [118, 118, 126];

export const VISITOR_TINTS: RGB[] = [
  [206, 172, 96],
  [186, 132, 70],
  [214, 202, 168],
  [176, 96, 78],
  [150, 172, 92],
  [198, 152, 176],
];

export const STAFF_COLORS: Record<string, RGB> = {
  seller: [62, 138, 180],
  cook: [222, 214, 188],
  repairman: [214, 132, 52],
  guard: [178, 62, 52],
  shaman: [136, 84, 178],
};

// ───────────────────────── материалы ─────────────────────────

/** Древесная текстура: продольные волокна и редкие сучки. */
function woodGrain(base: RGB, scale = 8, along: 'x' | 'y' = 'y'): (u: number, v: number) => RGB {
  return (u, v) => {
    const a = along === 'y' ? u * scale : v * scale;
    const b = along === 'y' ? v * 2.2 : u * 2.2;
    const n = fbm(a * 3.1, b, 64, 3, 7);
    const streak = Math.sin(a * 6.0 + n * 5) * 0.5 + 0.5;
    const k = 0.82 + streak * 0.22 + (n - 0.5) * 0.18;
    return [base[0] * k, base[1] * k, base[2] * k];
  };
}

/** Соломенная крыша: пучки, свисающие вниз. */
function thatchAlbedo(base: RGB): (u: number, v: number) => RGB {
  return (u, v) => {
    const n = fbm(u * 22, v * 7, 128, 3, 3);
    const strand = Math.sin(u * 90 + n * 6) * 0.5 + 0.5;
    const k = 0.72 + strand * 0.3 + v * 0.12;
    return [base[0] * k, base[1] * k * 0.98, base[2] * k * 0.9];
  };
}

function stoneAlbedo(base: RGB, seed = 1): (u: number, v: number) => RGB {
  return (u, v) => {
    const n = fbm(u * 9, v * 9, 128, 4, seed);
    const k = 0.78 + n * 0.42;
    return [base[0] * k, base[1] * k, base[2] * k * 0.97];
  };
}

function leafAlbedo(seed = 5): (u: number, v: number) => RGB {
  return (u, v) => {
    const n = fbm(u * 7, v * 7, 128, 4, seed);
    const c = mix(LEAF_D, LEAF_L, n);
    // Снизу кроны темнее — свет не доходит.
    const k = 0.92 + (1 - v) * 0.3;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
}

// ───────────────────────── вспомогательные фигуры ─────────────────────────

/** Ломаная из капсул — рельсы, лианы, верёвки, жёлоба. */
function polyline(
  p: Painter,
  pts: number[][],
  r: number,
  color: RGB,
  o: ShapeOpts = {},
): void {
  for (let i = 1; i < pts.length; i++) {
    capsule(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, color, o);
  }
}

function bezier(
  p0: number[],
  p1: number[],
  p2: number[],
  p3: number[],
  n = 16,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k = 1 - t;
    out.push([
      k * k * k * p0[0] + 3 * k * k * t * p1[0] + 3 * k * t * t * p2[0] + t * t * t * p3[0],
      k * k * k * p0[1] + 3 * k * k * t * p1[1] + 3 * k * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function bezierAt(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
  const k = 1 - t;
  return [
    k * k * k * p0[0] + 3 * k * k * t * p1[0] + 3 * k * t * t * p2[0] + t * t * t * p3[0],
    k * k * k * p0[1] + 3 * k * k * t * p1[1] + 3 * k * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** Утоптанная площадка под постройкой. */
function ground(p: Painter, cx: number, cy: number, rx: number, ry: number): void {
  field(p, cx - rx, cy - ry, rx * 2, ry * 2, {
    height: (u, v) => {
      const d = Math.hypot(u * 2 - 1, v * 2 - 1);
      if (d > 1) return null;
      return (1 - d * d) * 0.4 + fbm(u * 6, v * 6, 64, 3, 11) * 0.5;
    },
    albedo: (u, v) => {
      const d = Math.hypot(u * 2 - 1, v * 2 - 1);
      const n = fbm(u * 8, v * 8, 64, 3, 12);
      return mix(SAND, DIRT, n * 0.7 + d * 0.2);
    },
    relief: 0.5,
    ambient: 0.55,
    alpha: 1,
  });
}

/** Хижина: тело с брёвнами и соломенная крыша. */
function hut(p: Painter, x: number, y: number, w: number, h: number, roof: RGB): void {
  shadow(p, x + w / 2, y + h * 0.97, w * 0.52, h * 0.1);
  // Тело — сруб из брёвен.
  const logs = Math.max(3, Math.round(h * 0.05));
  const bodyTop = y + h * 0.46;
  const bodyH = h * 0.52;
  for (let i = 0; i < logs; i++) {
    const cy = bodyTop + (bodyH / logs) * (i + 0.5);
    capsule(p, x + w * 0.14, cy, x + w * 0.86, cy, bodyH / logs / 1.7, WOOD, {
      albedo: woodGrain(WOOD, 10, 'x'),
      ambient: 0.4,
      rim: 0.08,
    });
  }
  // Крыша: солома, подкрашенная в цвет постройки.
  const straw = mix(THATCH, roof, 0.55) as RGB;
  cone(p, x + w / 2, y + h * 0.04, bodyTop + h * 0.02, w * 0.52, straw, {
    albedo: thatchAlbedo(straw),
    ambient: 0.38,
    rim: 0.1,
  });
  // Проём.
  poly(
    p,
    [
      x + w * 0.4,
      y + h * 0.99,
      x + w * 0.4,
      y + h * 0.68,
      x + w * 0.6,
      y + h * 0.68,
      x + w * 0.6,
      y + h * 0.99,
    ],
    [26, 18, 12],
    0,
    0,
    1,
    { ambient: 1 },
  );
}

// ───────────────────────── ландшафт ─────────────────────────

function grassTile(variant: number): (p: Painter) => void {
  // Варианты отличаются лишь смещением шума — иначе на карте видна «шахматка».
  const seed = 20 + variant * 3;
  return (p) => {
    field(p, 0, 0, p.w, p.h, {
      height: (u, v) => fbm(u * 3 + variant, v * 3, 3, 3, seed) * 1.1,
      albedo: (u, v) => {
        const n = fbm(u * 4 + variant, v * 4, 4, 3, seed);
        const patch = fbm(u * 1.5, v * 1.5, 1.5, 2, seed + 3);
        const c = mix([88, 128, 54], [108, 148, 62], n);
        return mix(c, [122, 142, 66], Math.max(0, patch - 0.6) * 0.8);
      },
      relief: 0.3,
      ambient: 0.68,
    });
    // Несколько травинок для мелкой детали — внутри тайла, чтобы не было швов.
    for (let i = 0; i < 7; i++) {
      const bx = 4 + noise(i * 3.1, variant, 64, seed) * (p.w - 8);
      const by = 4 + noise(i * 5.7, variant + 2, 64, seed + 1) * (p.h - 8);
      const len = 1.6 + noise(i, variant, 64, seed + 5) * 1.6;
      const lean = (noise(i * 1.7, variant, 64, seed + 9) - 0.5) * 1.4;
      capsule(p, bx, by, bx + lean, by - len, 0.32, LEAF, {
        albedo: () => mix([84, 126, 52], LEAF_L, noise(i * 2.3, variant, 64, seed + 11) * 0.7),
        ambient: 0.62,
        alpha: 0.5,
      });
    }
  };
}

function waterTile(p: Painter): void {
  field(p, 0, 0, p.w, p.h, {
    height: (u, v) => {
      const n = fbm(u * 2, v * 2, 2, 3, 31);
      return Math.sin(u * 6.283 + n * 3) * 0.35 + Math.sin(v * 6.283 * 2 + n * 4) * 0.22;
    },
    albedo: (u, v) => {
      const n = fbm(u * 3, v * 3, 3, 3, 33);
      return mix([44, 106, 156], [62, 132, 184], n * 0.7);
    },
    relief: 0.1,
    ambient: 0.62,
    spec: 0.45,
    shine: 26,
  });
}

function rockTile(p: Painter): void {
  grassTile(1)(p);
  // Крупный валун и пара обломков — камни должны читаться как преграда.
  const spots: number[][] = [
    [0.46, 0.5, 0.46],
    [0.78, 0.7, 0.24],
    [0.2, 0.74, 0.2],
  ];
  for (const [ux, uy, r] of spots) {
    const cx = ux * p.w;
    const cy = uy * p.h;
    const rr = r * p.w;
    shadow(p, cx + rr * 0.15, cy + rr * 0.6, rr * 1.1, rr * 0.42, 0.34);
    field(p, cx - rr, cy - rr * 0.95, rr * 2, rr * 1.9, {
      height: (u, v) => {
        const dx = u * 2 - 1;
        const dy = v * 2 - 1;
        const d = Math.hypot(dx, dy);
        if (d > 1) return null;
        const facets = Math.abs(fbm(u * 3.5, v * 3.5, 64, 3, ux * 40) - 0.5) * 2;
        return (1 - d * d) * 2.4 + facets * 1.1;
      },
      albedo: (u, v) => {
        const n = fbm(u * 5, v * 5, 64, 4, ux * 40 + 1);
        return mix(STONE_D, [172, 166, 152], n);
      },
      relief: 0.7,
      ambient: 0.34,
      rim: 0.1,
    });
  }
}

function dirtRoadTile(p: Painter): void {
  field(p, 0, 0, p.w, p.h, {
    height: (u, v) => fbm(u * 5, v * 5, 5, 3, 41) * 1.1,
    albedo: (u, v) => {
      const n = fbm(u * 5, v * 5, 5, 3, 42);
      return mix([164, 128, 82], [190, 156, 104], n);
    },
    relief: 0.28,
    ambient: 0.7,
  });
  for (let i = 0; i < 5; i++) {
    const bx = 4 + noise(i * 2.7, 0, 64, 43) * (p.w - 8);
    const by = 4 + noise(i * 4.3, 1, 64, 44) * (p.h - 8);
    const r = 0.5 + noise(i, 2, 64, 45) * 0.7;
    ball(p, bx, by, r, r * 0.8, STONE, {
      albedo: stoneAlbedo([166, 152, 132], i),
      ambient: 0.62,
      alpha: 0.55,
    });
  }
}

function stoneRoadTile(p: Painter): void {
  // Плитка: сетка 3×3 с дрожанием, каждая плита — пологий купол.
  const cells = 3;
  field(p, 0, 0, p.w, p.h, {
    height: (u, v) => {
      const gx = u * cells;
      const gy = v * cells;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix - 0.5;
      const fy = gy - iy - 0.5;
      const jitter = noise(ix, iy, cells, 51) * 0.16;
      const d = Math.max(Math.abs(fx), Math.abs(fy)) + jitter * 0.3;
      const seam = smoothstep(0.38, 0.5, d);
      return (1 - seam) * (0.9 - (fx * fx + fy * fy) * 0.6) - seam * 0.6;
    },
    albedo: (u, v) => {
      const gx = u * cells;
      const gy = v * cells;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const tone = noise(ix, iy, cells, 52);
      const n = fbm(u * 10, v * 10, 10, 3, 53);
      const base = mix([118, 114, 106], [168, 164, 152], tone * 0.8 + n * 0.3);
      const fx = gx - ix - 0.5;
      const fy = gy - iy - 0.5;
      const d = Math.max(Math.abs(fx), Math.abs(fy));
      return mix(base, [78, 72, 64], smoothstep(0.4, 0.5, d));
    },
    relief: 0.55,
    ambient: 0.5,
  });
}

// ───────────────────────── постройки ─────────────────────────

interface SpriteDef {
  frames?: number;
  base(p: Painter, w: number, h: number): void;
  /** Подвижная часть, дорисовывается поверх статичной для каждого кадра. */
  anim?(p: Painter, w: number, h: number, t: number): void;
}

const TAU = Math.PI * 2;

// ───────────────────────── детали растительности ─────────────────────────

/**
 * Крона из отдельных листьев: сначала тёмный объём, поверх — россыпь листьев,
 * повёрнутых наружу. Ближе к свету листья светлее, по силуэту торчат — крона
 * получается рыхлой, а не бильярдным шаром.
 */
function leafCluster(
  p: Painter,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  density = 1,
): void {
  ball(p, cx, cy, rx * 0.94, ry * 0.94, LEAF_D, {
    albedo: leafAlbedo(seed),
    ambient: 0.4,
    flat: 0.9,
  });
  const n = Math.max(9, Math.round(rx * ry * 0.62 * density));
  for (let i = 0; i < n; i++) {
    const a = noise(i * 1.7 + 0.3, seed, 128, 1) * TAU;
    // Корень из равномерной величины — листья ложатся по площади, а не в центр.
    const rr = 0.35 + Math.sqrt(noise(i * 2.3, seed, 128, 2)) * 0.7;
    const lx = cx + Math.cos(a) * rx * rr;
    const ly = cy + Math.sin(a) * ry * rr;
    // Насколько лист повёрнут к солнцу.
    const toLight = -(Math.cos(a) * 0.42 + Math.sin(a) * 0.66);
    const tone = 0.48 + toLight * 0.34 + noise(i * 3.7, seed, 128, 3) * 0.3;
    const len = rx * (0.24 + noise(i * 4.1, seed, 128, 4) * 0.16);
    const tilt = a + (noise(i * 5.3, seed, 128, 5) - 0.5) * 1.2;
    capsule(
      p,
      lx - Math.cos(tilt) * len * 0.4,
      ly - Math.sin(tilt) * len * 0.4,
      lx + Math.cos(tilt) * len * 0.6,
      ly + Math.sin(tilt) * len * 0.6,
      rx * 0.13,
      LEAF,
      {
        albedo: () => {
          const k = Math.max(0, Math.min(1, tone));
          // Самые освещённые листья уходят в светлый оттенок, а не упираются в потолок.
          return k > 0.72 ? mix(LEAF_L, LEAF_HL, (k - 0.72) / 0.28) : mix(LEAF_D, LEAF_L, k / 0.72);
        },
        ambient: 0.48,
        rim: 0.18,
        spec: 0.07,
        shine: 9,
      },
    );
  }
}

/** Ствол с утолщением книзу: несколько капсул по кривой. */
function trunk(
  p: Painter,
  pts: number[][],
  r0: number,
  r1: number,
  color: RGB = BARK,
): void {
  for (let i = 1; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    capsule(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r0 + (r1 - r0) * t, color, {
      albedo: woodGrain(color, 5),
      ambient: 0.33,
      rim: 0.1,
    });
  }
}

/** Пальмовый лист: черешок с листочками по обе стороны. */
function palmFrond(
  p: Painter,
  from: number[],
  ctrl: number[],
  to: number[],
  size: number,
  seed: number,
): void {
  const pts = bezier(from, ctrl, [ (ctrl[0] + to[0]) / 2, (ctrl[1] + to[1]) / 2 ], to, 9);
  polyline(p, pts, size * 0.035, LEAF_D, { ambient: 0.34 });
  for (let i = 1; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const [px, py] = pts[i];
    const [qx, qy] = pts[i - 1];
    const ang = Math.atan2(py - qy, px - qx);
    // Листочки длиннее в середине черешка и короче к кончику.
    const len = size * 0.3 * Math.sin(Math.min(1, t * 1.15) * Math.PI) + size * 0.05;
    for (const side of [-1, 1]) {
      const a = ang + side * (0.95 + t * 0.4);
      capsule(p, px, py, px + Math.cos(a) * len, py + Math.sin(a) * len, size * 0.045, LEAF, {
        albedo: () => mix(LEAF_D, LEAF_L, 0.35 + t * 0.35 + noise(i, seed + side, 64, 6) * 0.25),
        ambient: 0.36,
        rim: 0.14,
      });
    }
  }
}

/** Цветок: лепестки-капсулы вокруг серединки, плюс тычинки. */
function flower(p: Painter, cx: number, cy: number, r: number, col: RGB, seed: number): void {
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU + seed;
    capsule(
      p,
      cx + Math.cos(a) * r * 0.3,
      cy + Math.sin(a) * r * 0.24,
      cx + Math.cos(a) * r,
      cy + Math.sin(a) * r * 0.82,
      r * 0.36,
      col,
      { ambient: 0.5, rim: 0.16, spec: 0.06, shine: 10 },
    );
  }
  ball(p, cx, cy, r * 0.4, r * 0.34, [244, 216, 118], { ambient: 0.6, spec: 0.25, shine: 16 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + seed * 2;
    ball(p, cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.14, r * 0.07, r * 0.06, [150, 104, 40], {
      ambient: 0.7,
    });
  }
}

/** Пучок травы — им «приземляем» деревья и кусты. */
function tuft(p: Painter, cx: number, cy: number, size: number, seed: number): void {
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (noise(i, seed, 64, 7) - 0.5) * 1.9;
    capsule(p, cx, cy, cx + Math.cos(a) * size, cy + Math.sin(a) * size, size * 0.12, LEAF, {
      albedo: () => mix([76, 118, 48], LEAF_L, noise(i * 2, seed, 64, 8)),
      ambient: 0.46,
    });
  }
}


const SPRITES: Record<string, SpriteDef> = {
  // ── растительность ──
  derevo: {
    base: (p, w, h) => {
      shadow(p, w * 0.52, h * 0.94, w * 0.36, h * 0.07);
      // Корни у основания.
      for (const [dx, dy] of [
        [-0.14, 0.02],
        [0.13, 0.03],
        [-0.05, 0.05],
      ]) {
        capsule(p, w * 0.5, h * 0.9, w * (0.5 + dx), h * (0.95 + dy), w * 0.035, BARK, {
          albedo: woodGrain(BARK, 4),
          ambient: 0.32,
        });
      }
      trunk(
        p,
        bezier([w * 0.5, h * 0.95], [w * 0.53, h * 0.8], [w * 0.45, h * 0.66], [w * 0.48, h * 0.5], 6),
        w * 0.085,
        w * 0.05,
      );
      // Две ветки в крону.
      trunk(p, [[w * 0.48, h * 0.6], [w * 0.36, h * 0.5], [w * 0.32, h * 0.44]], w * 0.035, w * 0.018);
      trunk(p, [[w * 0.48, h * 0.56], [w * 0.62, h * 0.47], [w * 0.66, h * 0.42]], w * 0.035, w * 0.018);
      // Крона: тёмные нижние гроздья, светлые верхние.
      leafCluster(p, w * 0.32, h * 0.44, w * 0.21, h * 0.16, 11);
      leafCluster(p, w * 0.68, h * 0.42, w * 0.22, h * 0.17, 23);
      leafCluster(p, w * 0.5, h * 0.46, w * 0.26, h * 0.19, 5);
      leafCluster(p, w * 0.42, h * 0.28, w * 0.22, h * 0.17, 37);
      leafCluster(p, w * 0.62, h * 0.3, w * 0.2, h * 0.15, 43);
      leafCluster(p, w * 0.5, h * 0.22, w * 0.19, h * 0.14, 53);
      tuft(p, w * 0.36, h * 0.95, w * 0.09, 3);
      tuft(p, w * 0.64, h * 0.94, w * 0.08, 9);
      occlude(p, 0.26);
      contour(p, 0.3);
    },
  },
  palma: {
    base: (p, w, h) => {
      shadow(p, w * 0.54, h * 0.95, w * 0.3, h * 0.055);
      const spine = bezier([w * 0.5, h * 0.97], [w * 0.4, h * 0.72], [w * 0.62, h * 0.5], [w * 0.5, h * 0.32], 9);
      trunk(p, spine, w * 0.085, w * 0.045);
      // Кольца-рубцы на стволе.
      for (let i = 1; i < spine.length - 1; i++) {
        const [x, y] = spine[i];
        const [qx, qy] = spine[i - 1];
        const a = Math.atan2(y - qy, x - qx) + Math.PI / 2;
        const r = w * (0.08 - (i / spine.length) * 0.035);
        capsule(
          p,
          x - Math.cos(a) * r,
          y - Math.sin(a) * r,
          x + Math.cos(a) * r,
          y + Math.sin(a) * r,
          w * 0.012,
          [78, 56, 34],
          { ambient: 0.4, alpha: 0.7 },
        );
      }
      const top = spine[spine.length - 1];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + 0.15 + (i / 6) * (Math.PI - 0.3);
        palmFrond(
          p,
          top,
          [top[0] + Math.cos(a) * w * 0.26, top[1] + Math.sin(a) * h * 0.14 - h * 0.03],
          [top[0] + Math.cos(a) * w * 0.5, top[1] + Math.sin(a) * h * 0.16 + h * 0.14],
          w,
          i * 7,
        );
      }
      // Кокосы.
      for (const [dx, dy] of [
        [-0.05, 0.03],
        [0.05, 0.045],
        [0, 0.07],
      ]) {
        ball(p, top[0] + w * dx, top[1] + h * dy, w * 0.045, h * 0.032, [128, 86, 44], {
          ambient: 0.42,
          rim: 0.14,
          spec: 0.1,
          shine: 12,
        });
      }
      tuft(p, w * 0.4, h * 0.96, w * 0.08, 17);
      occlude(p, 0.2);
      contour(p, 0.3);
    },
  },
  kust: {
    base: (p, w, h) => {
      shadow(p, w * 0.5, h * 0.9, w * 0.36, h * 0.08);
      // Веточки внутри куста.
      for (const [dx, dy] of [
        [-0.12, -0.16],
        [0.1, -0.2],
        [0, -0.24],
      ]) {
        capsule(p, w * 0.5, h * 0.9, w * (0.5 + dx), h * (0.9 + dy), w * 0.025, BARK, { ambient: 0.32 });
      }
      leafCluster(p, w * 0.34, h * 0.66, w * 0.2, h * 0.16, 61, 1.1);
      leafCluster(p, w * 0.66, h * 0.62, w * 0.21, h * 0.17, 71, 1.1);
      leafCluster(p, w * 0.5, h * 0.74, w * 0.24, h * 0.17, 83, 1.1);
      leafCluster(p, w * 0.5, h * 0.52, w * 0.2, h * 0.15, 97, 1.1);
      // Ягоды.
      for (let i = 0; i < 6; i++) {
        const bx = w * (0.28 + noise(i * 2.1, 5, 64, 12) * 0.44);
        const by = h * (0.5 + noise(i * 3.3, 6, 64, 13) * 0.28);
        ball(p, bx, by, w * 0.035, h * 0.028, [178, 54, 58], { ambient: 0.5, rim: 0.2, spec: 0.3, shine: 20 });
      }
      tuft(p, w * 0.3, h * 0.92, w * 0.07, 21);
      occlude(p, 0.22);
      contour(p, 0.3);
    },
  },
  cvety: {
    base: (p, w, h) => {
      shadow(p, w * 0.5, h * 0.92, w * 0.32, h * 0.06, 0.28);
      const spots: [number, number, number, RGB][] = [
        [0.28, 0.52, 0.13, [208, 68, 62]],
        [0.6, 0.4, 0.12, [234, 198, 74]],
        [0.46, 0.68, 0.14, [212, 106, 178]],
        [0.76, 0.6, 0.11, [238, 238, 228]],
      ];
      for (const [ux, uy, r, col] of spots) {
        const stem = bezier(
          [w * ux, h * 0.93],
          [w * (ux + 0.03), h * 0.78],
          [w * (ux - 0.02), h * (uy + 0.15)],
          [w * ux, h * uy],
          5,
        );
        polyline(p, stem, w * 0.022, [86, 126, 52], { ambient: 0.42 });
        // Листья на стебле.
        for (const side of [-1, 1]) {
          const sy = h * (uy + 0.2);
          capsule(p, w * ux, sy, w * (ux + side * 0.11), sy + h * 0.03, w * 0.035, LEAF, {
            albedo: leafAlbedo(ux * 40 + side),
            ambient: 0.42,
            rim: 0.12,
          });
        }
        flower(p, w * ux, h * uy, w * r, col, ux * 7);
      }
      tuft(p, w * 0.5, h * 0.93, w * 0.08, 31);
      contour(p, 0.26);
    },
  },
  skameyka: {
    base: (p, w, h) => {
      shadow(p, w * 0.5, h * 0.84, w * 0.46, h * 0.09);
      // Каменные опоры.
      for (const ux of [0.2, 0.8]) {
        ball(p, w * ux, h * 0.76, w * 0.11, h * 0.1, STONE, {
          albedo: stoneAlbedo(STONE, ux * 9),
          ambient: 0.38,
          rim: 0.12,
        });
      }
      // Бревно: снизу кора, сверху — гладкий срез.
      capsule(p, w * 0.1, h * 0.63, w * 0.9, h * 0.63, h * 0.115, BARK, {
        albedo: woodGrain(BARK, 16, 'x'),
        ambient: 0.34,
        rim: 0.1,
      });
      poly(
        p,
        [w * 0.1, h * 0.545, w * 0.9, h * 0.545, w * 0.9, h * 0.645, w * 0.1, h * 0.645],
        WOOD_L,
        0,
        -0.75,
        0.66,
        { albedo: woodGrain(WOOD_L, 26, 'x'), ambient: 0.5, rim: 0.12, spec: 0.08, shine: 12 },
      );
      // Торцы с годовыми кольцами.
      for (const ux of [0.1, 0.9]) {
        ball(p, w * ux, h * 0.6, w * 0.035, h * 0.09, [186, 148, 96], {
          albedo: (u, v) => {
            const d = Math.hypot(u * 2 - 1, v * 2 - 1);
            const ring = Math.sin(d * 12) * 0.5 + 0.5;
            return mix([158, 118, 68], [206, 172, 118], ring);
          },
          ambient: 0.5,
          flat: 0.4,
        });
      }
      occlude(p, 0.18);
      contour(p, 0.32);
    },
  },
  ukazatel: {
    base: (p, w, h) => {
      shadow(p, w * 0.5, h * 0.93, w * 0.24, h * 0.05);
      capsule(p, w * 0.5, h * 0.95, w * 0.5, h * 0.24, w * 0.055, BARK, {
        albedo: woodGrain(BARK, 5),
        ambient: 0.36,
        rim: 0.1,
      });
      const plank = (y0: number, y1: number, x0: number, x1: number, dir: number) => {
        const tipX = dir > 0 ? x1 + w * 0.13 : x1 - w * 0.13;
        poly(
          p,
          [x0, y0, x1, y0, tipX, (y0 + y1) / 2, x1, y1, x0, y1],
          [200, 176, 130],
          -0.12,
          -0.3,
          1,
          { albedo: woodGrain([200, 176, 130], 10, 'x'), ambient: 0.5, rim: 0.12, spec: 0.05, shine: 10 },
        );
        // Вырезанная стрелка.
        const my = (y0 + y1) / 2;
        const ax = dir > 0 ? x1 - w * 0.06 : x1 + w * 0.06;
        capsule(p, (x0 + x1) / 2 - dir * w * 0.1, my, ax, my, h * 0.018, [104, 78, 44], { ambient: 0.55 });
        capsule(p, ax - dir * w * 0.07, my - h * 0.05, ax, my, h * 0.016, [104, 78, 44], { ambient: 0.55 });
        capsule(p, ax - dir * w * 0.07, my + h * 0.05, ax, my, h * 0.016, [104, 78, 44], { ambient: 0.55 });
      };
      plank(h * 0.28, h * 0.42, w * 0.16, w * 0.62, 1);
      plank(h * 0.5, h * 0.64, w * 0.38, w * 0.84, -1);
      // Обвязка лианой.
      for (const y of [h * 0.35, h * 0.57]) {
        capsule(p, w * 0.42, y - h * 0.01, w * 0.58, y + h * 0.01, w * 0.022, [122, 96, 52], {
          ambient: 0.45,
        });
      }
      tuft(p, w * 0.62, h * 0.94, w * 0.07, 41);
      occlude(p, 0.18);
      contour(p, 0.3);
    },
  },

  // ── сервисы ──
  istochnik: {
    frames: 4,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.62, w * 0.46, h * 0.36);
      // Кольцо камней.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        const r = w * 0.3;
        ball(p, w * 0.5 + Math.cos(a) * r, h * 0.6 + Math.sin(a) * h * 0.22, w * 0.11, h * 0.09, STONE, {
          albedo: stoneAlbedo(STONE, i),
          ambient: 0.4,
          rim: 0.12,
        });
      }
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      field(p, w * 0.24, h * 0.44, w * 0.52, h * 0.34, {
        height: (u, v) => {
          const dx = u * 2 - 1;
          const dy = v * 2 - 1;
          const d = Math.hypot(dx, dy);
          if (d > 1) return null;
          return Math.sin(d * 14 - t * TAU) * 0.5 * (1 - d);
        },
        albedo: (u, v) => {
          const d = Math.hypot(u * 2 - 1, v * 2 - 1);
          return mix(WATER_L, WATER, d * 0.9);
        },
        relief: 0.5,
        ambient: 0.55,
        spec: 1,
        shine: 30,
      });
    },
  },
  tualet: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.5, h * 0.14);
      hut(p, w * 0.08, h * 0.06, w * 0.84, h * 0.9, [126, 148, 82]);
      // Табличка-череп.
      ball(p, w * 0.5, h * 0.56, w * 0.09, h * 0.075, BONE, { ambient: 0.5, rim: 0.15 });
      ball(p, w * 0.47, h * 0.55, w * 0.022, h * 0.02, [40, 30, 24], { ambient: 0.8 });
      ball(p, w * 0.53, h * 0.55, w * 0.022, h * 0.02, [40, 30, 24], { ambient: 0.8 });
      occlude(p, 0.22);
      contour(p, 0.34);
    },
  },
  zakusochnaya: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.52, h * 0.14);
      hut(p, w * 0.06, h * 0.04, w * 0.88, h * 0.92, [176, 96, 62]);
      // Костёр с вертелом у входа.
      capsule(p, w * 0.3, h * 0.9, w * 0.34, h * 0.74, w * 0.022, WOOD_D, { ambient: 0.4 });
      capsule(p, w * 0.7, h * 0.9, w * 0.66, h * 0.74, w * 0.022, WOOD_D, { ambient: 0.4 });
      capsule(p, w * 0.32, h * 0.75, w * 0.68, h * 0.75, w * 0.016, WOOD_D, { ambient: 0.45 });
      ball(p, w * 0.5, h * 0.79, w * 0.1, h * 0.055, [156, 96, 52], { ambient: 0.45, spec: 0.2, shine: 12 });
      for (let i = 0; i < 4; i++) {
        const a = 0.3 + i * 0.5;
        ball(p, w * (0.42 + i * 0.05), h * (0.9 - Math.sin(a) * 0.03), w * 0.03, h * 0.03, [236, 158, 60], {
          ambient: 0.9,
          alpha: 0.85,
        });
      }
      occlude(p, 0.22);
      contour(p, 0.34);
    },
  },
  morozh: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.92, w * 0.5, h * 0.12);
      shadow(p, w * 0.5, h * 0.9, w * 0.44, h * 0.08);
      // Прилавок.
      poly(p, [w * 0.1, h * 0.66, w * 0.9, h * 0.66, w * 0.9, h * 0.94, w * 0.1, h * 0.94], WOOD, 0, -0.2, 1, {
        albedo: woodGrain(WOOD, 14, 'x'),
        ambient: 0.42,
      });
      poly(p, [w * 0.06, h * 0.6, w * 0.94, h * 0.6, w * 0.9, h * 0.68, w * 0.1, h * 0.68], WOOD_L, 0, -0.8, 0.6, {
        ambient: 0.55,
      });
      // Навес.
      for (let i = 0; i < 6; i++) {
        const x0 = w * (0.06 + i * 0.147);
        poly(
          p,
          [x0, h * 0.36, x0 + w * 0.147, h * 0.36, x0 + w * 0.147, h * 0.5, x0, h * 0.5],
          i % 2 ? [222, 214, 196] : CLOTH,
          0,
          -0.5,
          0.9,
          { ambient: 0.5, rim: 0.1 },
        );
      }
      // Рожок.
      cone(p, w * 0.5, h * 0.5, h * 0.66, w * 0.09, [198, 148, 78], { ambient: 0.45 });
      ball(p, w * 0.5, h * 0.5, w * 0.1, h * 0.075, [242, 236, 216], { ambient: 0.5, rim: 0.16, spec: 0.1, shine: 12 });
      ball(p, w * 0.46, h * 0.47, w * 0.05, h * 0.04, [236, 168, 190], { ambient: 0.55 });
      occlude(p, 0.2);
      contour(p, 0.32);
    },
  },
  medpunkt: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.5, h * 0.14);
      hut(p, w * 0.08, h * 0.06, w * 0.84, h * 0.9, [124, 84, 156]);
      // Маска шамана над входом.
      ball(p, w * 0.5, h * 0.54, w * 0.13, h * 0.11, [196, 168, 120], { ambient: 0.45, rim: 0.14 });
      ball(p, w * 0.45, h * 0.52, w * 0.03, h * 0.026, [40, 28, 22], { ambient: 0.8 });
      ball(p, w * 0.55, h * 0.52, w * 0.03, h * 0.026, [40, 28, 22], { ambient: 0.8 });
      capsule(p, w * 0.44, h * 0.6, w * 0.56, h * 0.6, w * 0.018, [160, 60, 52], { ambient: 0.6 });
      capsule(p, w * 0.5, h * 0.44, w * 0.5, h * 0.34, w * 0.02, BONE, { ambient: 0.5 });
      occlude(p, 0.22);
      contour(p, 0.34);
    },
  },
  dinomotor: {
    frames: 8,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.88, w * 0.5, h * 0.16);
      // Каменное основание и опоры.
      ball(p, w * 0.5, h * 0.84, w * 0.4, h * 0.14, STONE, { albedo: stoneAlbedo(STONE, 4), ambient: 0.42 });
      capsule(p, w * 0.2, h * 0.84, w * 0.2, h * 0.5, w * 0.05, WOOD, { albedo: woodGrain(WOOD, 5), ambient: 0.38 });
      capsule(p, w * 0.8, h * 0.84, w * 0.8, h * 0.5, w * 0.05, WOOD, { albedo: woodGrain(WOOD, 5), ambient: 0.38 });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const cx = w * 0.5;
      const cy = h * 0.52;
      const R = Math.min(w, h) * 0.3;
      const spin = t * TAU;
      // Зубья.
      for (let i = 0; i < 10; i++) {
        const a = spin + (i / 10) * TAU;
        capsule(
          p,
          cx + Math.cos(a) * R * 0.82,
          cy + Math.sin(a) * R * 0.7,
          cx + Math.cos(a) * R * 1.15,
          cy + Math.sin(a) * R * 0.98,
          R * 0.17,
          WOOD_D,
          { ambient: 0.4, rim: 0.1 },
        );
      }
      ball(p, cx, cy, R, R * 0.85, WOOD, {
        albedo: (u, v) => {
          const a = Math.atan2(v - 0.5, u - 0.5) + spin;
          const rings = Math.sin(a * 5) * 0.5 + 0.5;
          const n = fbm(u * 6, v * 6, 64, 3, 9);
          return mix(WOOD_D, WOOD_L, rings * 0.35 + n * 0.4);
        },
        ambient: 0.4,
        rim: 0.14,
        spec: 0.08,
        shine: 10,
      });
      ball(p, cx, cy, R * 0.26, R * 0.22, IRON, { ambient: 0.45, spec: 0.4, shine: 26 });
    },
  },

  // ── аттракционы ──
  vesy: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.44, h * 0.14);
      capsule(p, w * 0.5, h * 0.92, w * 0.5, h * 0.4, w * 0.055, WOOD, {
        albedo: woodGrain(WOOD, 6),
        ambient: 0.38,
      });
      capsule(p, w * 0.16, h * 0.44, w * 0.84, h * 0.38, w * 0.04, WOOD_D, { ambient: 0.42, rim: 0.1 });
      ball(p, w * 0.18, h * 0.54, w * 0.12, h * 0.09, STONE, { albedo: stoneAlbedo(STONE, 2), ambient: 0.42 });
      ball(p, w * 0.82, h * 0.46, w * 0.1, h * 0.075, BONE, { ambient: 0.5, rim: 0.14 });
      contour(p, 0.32);
    },
  },
  batut: {
    frames: 4,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.88, w * 0.5, h * 0.16);
      for (const ux of [0.16, 0.84, 0.32, 0.68]) {
        capsule(p, w * ux, h * 0.92, w * (0.5 + (ux - 0.5) * 0.8), h * 0.62, w * 0.035, WOOD_D, {
          ambient: 0.38,
        });
      }
      // Обод.
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        ball(
          p,
          w * 0.5 + Math.cos(a) * w * 0.4,
          h * 0.6 + Math.sin(a) * h * 0.24,
          w * 0.05,
          h * 0.04,
          WOOD,
          { albedo: woodGrain(WOOD, 3), ambient: 0.4 },
        );
      }
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const dip = Math.sin(t * TAU) * 0.06;
      // Полотно: натянутая шкура, к раме идёт шнуровка.
      field(p, w * 0.13, h * 0.41, w * 0.74, h * 0.4, {
        height: (u, v) => {
          const dx = u * 2 - 1;
          const dy = v * 2 - 1;
          const d = Math.hypot(dx, dy);
          if (d > 1) return null;
          // Вогнутое полотно: по краям натянуто, в центре провисает.
          return -(1 - d * d) * (1.6 + dip * 10) + 1.6;
        },
        albedo: (u, v) => {
          const n = fbm(u * 4, v * 4, 64, 3, 61);
          const spot = smoothstep(0.58, 0.7, n);
          return mix([176, 142, 96], [126, 92, 56], spot);
        },
        relief: 0.7,
        ambient: 0.46,
        rim: 0.1,
      });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        capsule(
          p,
          w * 0.5 + Math.cos(a) * w * 0.37,
          h * 0.61 + Math.sin(a) * h * 0.2,
          w * 0.5 + Math.cos(a) * w * 0.42,
          h * 0.61 + Math.sin(a) * h * 0.235,
          w * 0.012,
          [196, 176, 130],
          { ambient: 0.6 },
        );
      }
      const jump = Math.max(0, Math.sin(t * TAU)) * h * 0.24;
      drawTinyPerson(p, w * 0.5, h * 0.56 - jump, Math.min(w, h) * 0.3, FUR);
    },
  },
  kacheli: {
    frames: 6,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.5, h * 0.14);
      for (const [x0, x1] of [
        [0.18, 0.4],
        [0.5, 0.4],
        [0.5, 0.6],
        [0.82, 0.6],
      ]) {
        capsule(p, w * x0, h * 0.94, w * x1, h * 0.22, w * 0.045, WOOD, {
          albedo: woodGrain(WOOD, 5),
          ambient: 0.38,
        });
      }
      capsule(p, w * 0.36, h * 0.2, w * 0.64, h * 0.2, w * 0.05, WOOD_D, {
        albedo: woodGrain(WOOD_D, 8, 'x'),
        ambient: 0.4,
        rim: 0.12,
      });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const sw = Math.sin(t * TAU) * w * 0.13;
      const drop = h * 0.4 - Math.abs(sw) * 0.4;
      capsule(p, w * 0.44, h * 0.22, w * 0.44 + sw, h * 0.22 + drop, w * 0.014, [176, 148, 96], {
        ambient: 0.5,
      });
      capsule(p, w * 0.58, h * 0.22, w * 0.58 + sw, h * 0.22 + drop, w * 0.014, [176, 148, 96], {
        ambient: 0.5,
      });
      capsule(
        p,
        w * 0.4 + sw,
        h * 0.24 + drop,
        w * 0.62 + sw,
        h * 0.24 + drop,
        w * 0.045,
        WOOD,
        { albedo: woodGrain(WOOD, 6, 'x'), ambient: 0.42, rim: 0.12 },
      );
      drawTinyPerson(p, w * 0.51 + sw, h * 0.19 + drop, Math.min(w, h) * 0.26, [196, 132, 96]);
    },
  },
  tir: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.52, h * 0.14);
      poly(p, [w * 0.08, h * 0.62, w * 0.92, h * 0.62, w * 0.92, h * 0.92, w * 0.08, h * 0.92], WOOD, 0, -0.2, 1, {
        albedo: woodGrain(WOOD, 14, 'x'),
        ambient: 0.42,
      });
      poly(p, [w * 0.04, h * 0.56, w * 0.96, h * 0.56, w * 0.92, h * 0.64, w * 0.08, h * 0.64], WOOD_L, 0, -0.8, 0.6, {
        ambient: 0.55,
      });
      const target = (cx: number, cy: number, r: number) => {
        capsule(p, cx, cy + r, cx, cy + r * 2.6, r * 0.22, WOOD_D, { ambient: 0.4 });
        ball(p, cx, cy, r, r * 0.92, BONE, { ambient: 0.48, rim: 0.14 });
        ball(p, cx, cy, r * 0.62, r * 0.58, [206, 84, 62], { ambient: 0.5 });
        ball(p, cx, cy, r * 0.24, r * 0.22, BONE, { ambient: 0.55 });
      };
      target(w * 0.3, h * 0.3, w * 0.14);
      target(w * 0.68, h * 0.26, w * 0.11);
      occlude(p, 0.2);
      contour(p, 0.32);
    },
  },
  vyshka: {
    frames: 6,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.92, w * 0.46, h * 0.12);
      capsule(p, w * 0.28, h * 0.94, w * 0.4, h * 0.2, w * 0.05, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      capsule(p, w * 0.72, h * 0.94, w * 0.6, h * 0.2, w * 0.05, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      for (let i = 0; i < 4; i++) {
        const y = h * (0.36 + i * 0.15);
        const k = (y / h - 0.2) / 0.74;
        capsule(p, w * (0.4 - k * 0.12), y, w * (0.6 + k * 0.12), y, w * 0.025, WOOD_D, { ambient: 0.42 });
      }
      poly(p, [w * 0.32, h * 0.16, w * 0.68, h * 0.16, w * 0.68, h * 0.22, w * 0.32, h * 0.22], WOOD_L, 0, -0.6, 0.8, {
        albedo: woodGrain(WOOD_L, 10, 'x'),
        ambient: 0.5,
        rim: 0.12,
      });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      if (t < 0.72) {
        const k = t / 0.72;
        drawTinyPerson(p, w * 0.5, h * (0.14 + k * 0.72), Math.min(w, h) * 0.26, [206, 150, 104], k * 3);
      } else {
        const s = (t - 0.72) / 0.28;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI + Math.PI;
          const r = s * w * 0.3;
          ball(
            p,
            w * 0.5 + Math.cos(a) * r,
            h * 0.93 + Math.sin(a) * r * 0.5,
            w * 0.03 * (1 - s),
            h * 0.025 * (1 - s),
            WATER_L,
            { ambient: 0.7, alpha: 1 - s },
          );
        }
      }
    },
  },
  karusel: {
    frames: 8,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.82, w * 0.5, h * 0.2);
      // Помост.
      ball(p, w * 0.5, h * 0.76, w * 0.44, h * 0.14, WOOD, {
        albedo: (u, v) => {
          const a = Math.atan2(v - 0.5, u - 0.5);
          const planks = Math.sin(a * 12) * 0.5 + 0.5;
          return mix(WOOD_D, WOOD_L, planks * 0.5 + 0.2);
        },
        ambient: 0.44,
        flat: 0.35,
        rim: 0.1,
      });
    },
    anim: (p, w, h, t) => {
      const spin = t * TAU;
      const cx = w * 0.5;
      const cy = h * 0.66;
      // Фигурки на помосте — ближние рисуем последними.
      const seats = [0, 1, 2, 3, 4, 5]
        .map((i) => {
          const a = spin + (i / 6) * TAU;
          return { a, x: cx + Math.cos(a) * w * 0.32, y: cy + Math.sin(a) * h * 0.11 };
        })
        .sort((s1, s2) => s1.y - s2.y);
      capsule(p, cx, h * 0.74, cx, h * 0.2, w * 0.045, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.4,
      });
      for (const s of seats) {
        capsule(p, s.x, s.y - h * 0.02, s.x, h * 0.26, w * 0.012, [176, 148, 96], { ambient: 0.5 });
        drawAnimalSeat(p, s.x, s.y, Math.min(w, h) * 0.16, s.a);
      }
      // Купол.
      cone(p, cx, h * 0.12, h * 0.34, w * 0.48, CLOTH, {
        albedo: (u) => {
          const stripe = Math.floor(u * 14 + spin) % 2 === 0;
          return stripe ? CLOTH : [232, 224, 202];
        },
        ambient: 0.42,
        rim: 0.14,
        spec: 0.08,
        shine: 10,
      });
      ball(p, cx, h * 0.1, w * 0.05, h * 0.04, YELLOW, { ambient: 0.5, spec: 0.4, shine: 30 });
    },
  },
  tarzanka: {
    frames: 6,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.93, w * 0.44, h * 0.1);
      capsule(p, w * 0.34, h * 0.95, w * 0.46, h * 0.1, w * 0.06, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      capsule(p, w * 0.66, h * 0.95, w * 0.54, h * 0.1, w * 0.06, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      for (let i = 0; i < 3; i++) {
        const y = h * (0.36 + i * 0.2);
        capsule(p, w * 0.4, y, w * 0.6, y, w * 0.02, WOOD_D, { ambient: 0.42 });
      }
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const sw = Math.sin(t * TAU);
      const ex = w * (0.5 + sw * 0.34);
      const ey = h * (0.66 - Math.abs(sw) * 0.16);
      const rope = bezier([w * 0.5, h * 0.12], [w * 0.62, h * 0.3], [ex, ey - h * 0.2], [ex, ey], 8);
      polyline(p, rope, w * 0.014, [92, 122, 62], { ambient: 0.45 });
      drawTinyPerson(p, ex, ey + h * 0.03, Math.min(w, h) * 0.22, [204, 148, 102], sw * 2);
    },
  },
  katapulta: {
    frames: 6,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.5, h * 0.14);
      capsule(p, w * 0.14, h * 0.86, w * 0.86, h * 0.86, w * 0.055, WOOD, {
        albedo: woodGrain(WOOD, 12, 'x'),
        ambient: 0.4,
      });
      capsule(p, w * 0.24, h * 0.88, w * 0.32, h * 0.62, w * 0.04, WOOD_D, { ambient: 0.38 });
      capsule(p, w * 0.42, h * 0.88, w * 0.32, h * 0.62, w * 0.04, WOOD_D, { ambient: 0.38 });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const a = -1.15 + Math.sin(t * TAU) * 0.85;
      const px = w * 0.32 + Math.cos(a) * w * 0.55;
      const py = h * 0.62 + Math.sin(a) * h * 0.5;
      capsule(p, w * 0.32, h * 0.62, px, py, w * 0.035, WOOD_L, {
        albedo: woodGrain(WOOD_L, 6),
        ambient: 0.42,
        rim: 0.12,
      });
      ball(p, px, py, w * 0.1, h * 0.08, FUR, {
        albedo: (u, v) => mix(FUR, FUR_SPOT, smoothstep(0.6, 0.72, fbm(u * 5, v * 5, 64, 3, 71))),
        ambient: 0.45,
        rim: 0.14,
      });
    },
  },
  strah: {
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.52, h * 0.16);
      // Скальный холм с дырой-входом.
      field(p, w * 0.04, h * 0.16, w * 0.92, h * 0.78, {
        height: (u, v) => {
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.55) * 2.1;
          const d = Math.hypot(dx, dy * 0.9);
          if (d > 1) return null;
          return (1 - d * d) * 3 + fbm(u * 7, v * 7, 64, 4, 81) * 1.6;
        },
        albedo: (u, v) => {
          const n = fbm(u * 8, v * 8, 64, 4, 82);
          return mix(STONE_D, [126, 118, 108], n);
        },
        relief: 0.5,
        ambient: 0.34,
        rim: 0.1,
      });
      ball(p, w * 0.5, h * 0.84, w * 0.19, h * 0.16, [16, 12, 10], { ambient: 1 });
      // Череп над входом.
      ball(p, w * 0.5, h * 0.52, w * 0.14, h * 0.12, BONE, { ambient: 0.46, rim: 0.16 });
      ball(p, w * 0.45, h * 0.51, w * 0.035, h * 0.032, [24, 18, 16], { ambient: 0.9 });
      ball(p, w * 0.55, h * 0.51, w * 0.035, h * 0.032, [24, 18, 16], { ambient: 0.9 });
      poly(p, [w * 0.45, h * 0.6, w * 0.55, h * 0.6, w * 0.54, h * 0.64, w * 0.46, h * 0.64], [24, 18, 16], 0, 0, 1, {
        ambient: 0.9,
      });
      occlude(p, 0.25);
      contour(p, 0.34);
    },
  },
  koleso: {
    frames: 8,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.44, h * 0.12);
      capsule(p, w * 0.24, h * 0.94, w * 0.5, h * 0.5, w * 0.05, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      capsule(p, w * 0.76, h * 0.94, w * 0.5, h * 0.5, w * 0.05, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const cx = w * 0.5;
      const cy = h * 0.44;
      const R = Math.min(w, h) * 0.38;
      const spin = t * TAU;
      // Обод.
      field(p, cx - R * 1.12, cy - R * 1.12, R * 2.24, R * 2.24, {
        height: (u, v) => {
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const d = Math.hypot(dx, dy);
          if (d > 1 || d < 0.84) return null;
          const k = (d - 0.92) / 0.08;
          return 1 - k * k;
        },
        albedo: () => WOOD_L,
        relief: 1.4,
        ambient: 0.4,
        rim: 0.12,
      });
      for (let i = 0; i < 8; i++) {
        const a = spin + (i / 8) * TAU;
        capsule(p, cx, cy, cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94, R * 0.035, WOOD, {
          ambient: 0.42,
        });
      }
      const cabins = [0, 1, 2, 3, 4, 5, 6, 7]
        .map((i) => {
          const a = spin + (i / 8) * TAU;
          return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, i };
        })
        .sort((a, b) => a.y - b.y);
      for (const c of cabins) {
        capsule(p, c.x, c.y - R * 0.1, c.x, c.y, R * 0.02, IRON, { ambient: 0.5 });
        ball(p, c.x, c.y + R * 0.06, R * 0.15, R * 0.13, c.i % 2 ? CLOTH : YELLOW, {
          ambient: 0.44,
          rim: 0.16,
          spec: 0.1,
          shine: 12,
        });
      }
      ball(p, cx, cy, R * 0.14, R * 0.13, IRON, { ambient: 0.45, spec: 0.5, shine: 30 });
    },
  },
  gorki: { frames: 8, base: coasterBase(5, CLOTH), anim: coasterAnim(CLOTH) },
  supergorki: { frames: 8, base: coasterBase(6, [70, 108, 178]), anim: coasterAnim([70, 108, 178]) },
  megagorki: { frames: 8, base: coasterBase(7, [128, 74, 168]), anim: coasterAnim([128, 74, 168]) },
  vodnaya_gorka: {
    frames: 6,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.86, w * 0.52, h * 0.2);
      // Бассейн.
      field(p, w * 0.1, h * 0.72, w * 0.8, h * 0.24, {
        height: (u, v) => {
          const d = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
          if (d > 1) return null;
          return Math.sin(u * 22) * 0.3 + Math.sin(v * 26) * 0.2;
        },
        albedo: (u, v) => mix(WATER_L, WATER, Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) * 0.8),
        relief: 0.4,
        ambient: 0.5,
        spec: 0.9,
        shine: 36,
      });
      capsule(p, w * 0.22, h * 0.8, w * 0.28, h * 0.16, w * 0.05, WOOD, {
        albedo: woodGrain(WOOD, 5),
        ambient: 0.36,
      });
      const flume = bezier([w * 0.28, h * 0.16], [w * 0.66, h * 0.2], [w * 0.5, h * 0.6], [w * 0.68, h * 0.76], 14);
      polyline(p, flume, w * 0.075, WOOD_D, { albedo: woodGrain(WOOD_D, 3), ambient: 0.36 });
      polyline(p, flume, w * 0.05, WATER_L, { ambient: 0.55, spec: 0.7, shine: 30, alpha: 0.95 });
      contour(p, 0.3);
    },
    anim: (p, w, h, t) => {
      const pos = bezierAt([w * 0.28, h * 0.16], [w * 0.66, h * 0.2], [w * 0.5, h * 0.6], [w * 0.68, h * 0.76], t);
      drawTinyPerson(p, pos[0], pos[1] + h * 0.02, Math.min(w, h) * 0.16, [212, 156, 108]);
      ball(p, pos[0], pos[1] + h * 0.03, w * 0.05, h * 0.02, WATER_L, { ambient: 0.8, alpha: 0.6 });
    },
  },
  vodnaya_dorozhka: {
    frames: 8,
    base: (p, w, h) => {
      ground(p, w * 0.5, h * 0.9, w * 0.54, h * 0.16);
      // Борта жёлоба.
      capsule(p, w * 0.06, h * 0.44, w * 0.94, h * 0.44, w * 0.03, WOOD, {
        albedo: woodGrain(WOOD, 20, 'x'),
        ambient: 0.4,
      });
      capsule(p, w * 0.06, h * 0.9, w * 0.94, h * 0.9, w * 0.035, WOOD, {
        albedo: woodGrain(WOOD, 20, 'x'),
        ambient: 0.38,
      });
      field(p, w * 0.06, h * 0.46, w * 0.88, h * 0.44, {
        height: (u, v) => Math.sin(u * 30) * 0.35 + Math.sin(v * 12 + u * 4) * 0.25,
        albedo: (u, v) => mix(WATER, WATER_L, 0.25 + Math.sin(u * 18 + v * 3) * 0.2),
        relief: 0.35,
        ambient: 0.5,
        spec: 1,
        shine: 34,
      });
      contour(p, 0.28);
    },
    anim: (p, w, h, t) => {
      const bx = w * (0.08 + t * 0.8);
      const by = h * 0.66;
      capsule(p, bx, by, bx + w * 0.11, by, h * 0.075, WOOD_D, {
        albedo: woodGrain(WOOD_D, 4, 'x'),
        ambient: 0.42,
        rim: 0.12,
      });
      drawTinyPerson(p, bx + w * 0.055, by - h * 0.02, Math.min(w, h) * 0.2, [206, 150, 104]);
      for (let i = 0; i < 4; i++) {
        ball(p, bx - w * 0.02 * i, by + h * 0.06, w * 0.02, h * 0.012, WATER_L, {
          ambient: 0.85,
          alpha: 0.5 - i * 0.1,
        });
      }
    },
  },
};

/** Каркас горок: опоры и рельсы. Общий для трёх аттракционов. */
function coasterBase(posts: number, cart: RGB): (p: Painter, w: number, h: number) => void {
  void cart;
  return (p, w, h) => {
    ground(p, w * 0.5, h * 0.92, w * 0.54, h * 0.14);
    const track = trackPoints(w, h);
    const line = bezier(track[0], track[1], track[2], track[3], 26);
    // Опоры под полотном — тонкие, с раскосами.
    for (let i = 0; i < posts; i++) {
      const t = (i + 0.5) / posts;
      const pt = bezierAt(track[0], track[1], track[2], track[3], t);
      if (pt[1] > h * 0.9) continue;
      capsule(p, pt[0], h * 0.94, pt[0], pt[1] + h * 0.02, w * 0.014, WOOD, {
        albedo: woodGrain(WOOD, 4),
        ambient: 0.34,
      });
      const bx = pt[0] + w * 0.05;
      capsule(p, pt[0], h * 0.94, bx, (pt[1] + h * 0.94) / 2, w * 0.008, WOOD_D, { ambient: 0.34 });
    }
    // Шпалы.
    for (let i = 1; i < line.length; i += 2) {
      const [x, y] = line[i];
      const [px, py] = line[i - 1];
      const ang = Math.atan2(y - py, x - px) + Math.PI / 2;
      capsule(
        p,
        x - Math.cos(ang) * h * 0.03,
        y - Math.sin(ang) * h * 0.03,
        x + Math.cos(ang) * h * 0.03,
        y + Math.sin(ang) * h * 0.03,
        h * 0.012,
        WOOD_D,
        { ambient: 0.36 },
      );
    }
    // Два рельса.
    polyline(p, line.map(([x, y]) => [x, y - h * 0.022]), h * 0.011, WOOD_L, {
      ambient: 0.52,
      rim: 0.14,
      spec: 0.12,
      shine: 16,
    });
    polyline(p, line.map(([x, y]) => [x, y + h * 0.022]), h * 0.011, WOOD_L, {
      ambient: 0.46,
      rim: 0.1,
    });
    contour(p, 0.3);
  };
}

function coasterAnim(cart: RGB): (p: Painter, w: number, h: number, t: number) => void {
  return (p, w, h, t) => {
    const track = trackPoints(w, h);
    const pt = bezierAt(track[0], track[1], track[2], track[3], t);
    const nx = bezierAt(track[0], track[1], track[2], track[3], Math.min(1, t + 0.02));
    const ang = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]);
    const dx = Math.cos(ang) * w * 0.045;
    const dy = Math.sin(ang) * w * 0.045;
    capsule(p, pt[0] - dx, pt[1] - dy - h * 0.04, pt[0] + dx, pt[1] + dy - h * 0.04, h * 0.04, cart, {
      ambient: 0.44,
      rim: 0.16,
      spec: 0.12,
      shine: 14,
    });
    drawTinyPerson(p, pt[0], pt[1] - h * 0.09, Math.min(w, h) * 0.15, [214, 158, 108]);
  };
}

function trackPoints(w: number, h: number): number[][] {
  return [
    [w * 0.04, h * 0.72],
    [w * 0.26, h * -0.12],
    [w * 0.66, h * 0.98],
    [w * 0.96, h * 0.2],
  ];
}

/** Крошечная фигурка — катающиеся, прыгуны, седоки. */
function drawTinyPerson(p: Painter, cx: number, cy: number, s: number, fur: RGB, lean = 0): void {
  const l = lean * 0.12;
  capsule(p, cx - s * 0.16, cy + s * 0.5, cx - s * 0.22 + l, cy + s * 0.9, s * 0.09, SKIN, { ambient: 0.42 });
  capsule(p, cx + s * 0.16, cy + s * 0.5, cx + s * 0.22 + l, cy + s * 0.9, s * 0.09, SKIN, { ambient: 0.42 });
  ball(p, cx, cy + s * 0.4, s * 0.34, s * 0.36, fur, {
    albedo: (u, v) => mix(fur, FUR_SPOT, smoothstep(0.62, 0.74, fbm(u * 5, v * 5, 64, 3, 91))),
    ambient: 0.42,
    rim: 0.14,
  });
  capsule(p, cx - s * 0.28, cy + s * 0.3, cx - s * 0.5 + l, cy + s * 0.05, s * 0.085, SKIN, { ambient: 0.44 });
  capsule(p, cx + s * 0.28, cy + s * 0.3, cx + s * 0.5 + l, cy + s * 0.05, s * 0.085, SKIN, { ambient: 0.44 });
  ball(p, cx, cy, s * 0.3, s * 0.3, SKIN, { ambient: 0.46, rim: 0.16 });
  ball(p, cx, cy - s * 0.12, s * 0.3, s * 0.2, HAIR, { ambient: 0.36 });
}

/** Зверь-качалка на карусели. */
function drawAnimalSeat(p: Painter, cx: number, cy: number, s: number, a: number): void {
  const dir = Math.cos(a) >= 0 ? 1 : -1;
  ball(p, cx, cy, s * 0.62, s * 0.42, [176, 132, 72], { ambient: 0.44, rim: 0.14 });
  capsule(p, cx + dir * s * 0.4, cy - s * 0.1, cx + dir * s * 0.72, cy - s * 0.5, s * 0.16, [176, 132, 72], {
    ambient: 0.44,
  });
  ball(p, cx + dir * s * 0.78, cy - s * 0.56, s * 0.26, s * 0.2, [186, 142, 80], { ambient: 0.46, rim: 0.14 });
  ball(p, cx + dir * s * 0.86, cy - s * 0.6, s * 0.05, s * 0.05, [40, 28, 20], { ambient: 0.8 });
  capsule(p, cx - dir * s * 0.5, cy - s * 0.05, cx - dir * s * 0.85, cy - s * 0.3, s * 0.07, [186, 142, 80], {
    ambient: 0.42,
  });
  for (const ox of [-0.34, 0.24]) {
    capsule(p, cx + ox * s, cy + s * 0.25, cx + ox * s, cy + s * 0.62, s * 0.09, [166, 124, 66], { ambient: 0.4 });
  }
}

// ───────────────────────── ворота парка ─────────────────────────

function entranceSprite(p: Painter, w: number, h: number): void {
  ground(p, w * 0.5, h * 0.9, w * 0.5, h * 0.16);
  capsule(p, w * 0.12, h * 0.96, w * 0.13, h * 0.28, w * 0.05, WOOD, {
    albedo: woodGrain(WOOD, 5),
    ambient: 0.38,
  });
  capsule(p, w * 0.88, h * 0.96, w * 0.87, h * 0.28, w * 0.05, WOOD, {
    albedo: woodGrain(WOOD, 5),
    ambient: 0.38,
  });
  // Перекладина с натянутой шкурой.
  capsule(p, w * 0.08, h * 0.26, w * 0.92, h * 0.26, w * 0.035, WOOD_D, {
    albedo: woodGrain(WOOD_D, 16, 'x'),
    ambient: 0.4,
  });
  field(p, w * 0.12, h * 0.28, w * 0.76, h * 0.24, {
    height: (u, v) => Math.sin(u * 9) * 0.4 + (1 - v) * 0.5,
    albedo: (u, v) => mix(FUR, FUR_SPOT, smoothstep(0.6, 0.74, fbm(u * 6, v * 6, 64, 3, 101))),
    relief: 0.5,
    ambient: 0.46,
    rim: 0.12,
  });
  ball(p, w * 0.5, h * 0.4, w * 0.075, h * 0.09, BONE, { ambient: 0.5, rim: 0.16 });
  ball(p, w * 0.475, h * 0.39, w * 0.02, h * 0.022, [40, 28, 22], { ambient: 0.85 });
  ball(p, w * 0.525, h * 0.39, w * 0.02, h * 0.022, [40, 28, 22], { ambient: 0.85 });
  occlude(p, 0.2);
  contour(p, 0.32);
}

// ───────────────────────── люди ─────────────────────────

function visitorSprite(fur: RGB, frame: number): (p: Painter, w: number, h: number) => void {
  return (p, w, h) => {
    const swing = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    const sit = frame === 3;
    shadow(p, w * 0.5, h * 0.97, w * 0.32, h * 0.05, 0.35);
    const skin = SKIN;
    if (sit) {
      capsule(p, w * 0.44, h * 0.78, w * 0.76, h * 0.84, w * 0.1, skin, { ambient: 0.42 });
      capsule(p, w * 0.56, h * 0.78, w * 0.84, h * 0.9, w * 0.1, skin, { ambient: 0.42 });
      ball(p, w * 0.48, h * 0.62, w * 0.26, h * 0.19, fur, {
        albedo: (u, v) => mix(fur, FUR_SPOT, smoothstep(0.6, 0.72, fbm(u * 5, v * 5, 64, 3, 111))),
        ambient: 0.42,
        rim: 0.14,
      });
      ball(p, w * 0.5, h * 0.36, w * 0.24, h * 0.19, skin, { ambient: 0.46, rim: 0.16 });
      ball(p, w * 0.5, h * 0.28, w * 0.25, h * 0.13, HAIR, { ambient: 0.34 });
      ball(p, w * 0.44, h * 0.38, w * 0.032, h * 0.026, [40, 28, 22], { ambient: 0.8 });
      ball(p, w * 0.57, h * 0.38, w * 0.032, h * 0.026, [40, 28, 22], { ambient: 0.8 });
      contour(p, 0.34);
      return;
    }
    // Ноги.
    capsule(p, w * 0.42, h * 0.7, w * 0.36 + swing * w * 0.09, h * 0.95, w * 0.085, skin, { ambient: 0.4 });
    capsule(p, w * 0.58, h * 0.7, w * 0.64 - swing * w * 0.09, h * 0.95, w * 0.085, skin, { ambient: 0.4 });
    // Туловище в шкуре.
    ball(p, w * 0.5, h * 0.58, w * 0.26, h * 0.19, fur, {
      albedo: (u, v) => mix(fur, FUR_SPOT, smoothstep(0.6, 0.72, fbm(u * 5, v * 5, 64, 3, 112))),
      ambient: 0.42,
      rim: 0.14,
    });
    // Руки.
    capsule(p, w * 0.3, h * 0.5, w * 0.16, h * (0.68 + swing * 0.07), w * 0.075, skin, { ambient: 0.42 });
    capsule(p, w * 0.7, h * 0.5, w * 0.84, h * (0.68 - swing * 0.07), w * 0.075, skin, { ambient: 0.42 });
    // Голова.
    ball(p, w * 0.5, h * 0.28, w * 0.25, h * 0.2, skin, { ambient: 0.46, rim: 0.16, spec: 0.05, shine: 10 });
    ball(p, w * 0.5, h * 0.2, w * 0.26, h * 0.14, HAIR, { ambient: 0.34 });
    ball(p, w * 0.44, h * 0.3, w * 0.033, h * 0.027, [40, 28, 22], { ambient: 0.8 });
    ball(p, w * 0.57, h * 0.3, w * 0.033, h * 0.027, [40, 28, 22], { ambient: 0.8 });
    contour(p, 0.34);
  };
}

function staffSprite(color: RGB): (p: Painter, w: number, h: number) => void {
  return (p, w, h) => {
    shadow(p, w * 0.5, h * 0.97, w * 0.32, h * 0.05, 0.35);
    capsule(p, w * 0.42, h * 0.7, w * 0.38, h * 0.95, w * 0.085, SKIN, { ambient: 0.4 });
    capsule(p, w * 0.58, h * 0.7, w * 0.62, h * 0.95, w * 0.085, SKIN, { ambient: 0.4 });
    ball(p, w * 0.5, h * 0.57, w * 0.27, h * 0.2, color, { ambient: 0.44, rim: 0.14 });
    capsule(p, w * 0.28, h * 0.5, w * 0.14, h * 0.66, w * 0.075, SKIN, { ambient: 0.42 });
    capsule(p, w * 0.72, h * 0.5, w * 0.86, h * 0.66, w * 0.075, SKIN, { ambient: 0.42 });
    ball(p, w * 0.5, h * 0.28, w * 0.25, h * 0.2, SKIN, { ambient: 0.46, rim: 0.16 });
    // Головной убор — по нему видно должность.
    ball(p, w * 0.5, h * 0.18, w * 0.3, h * 0.1, color, { ambient: 0.45, rim: 0.12 });
    ball(p, w * 0.44, h * 0.3, w * 0.033, h * 0.027, [40, 28, 22], { ambient: 0.8 });
    ball(p, w * 0.57, h * 0.3, w * 0.033, h * 0.027, [40, 28, 22], { ambient: 0.8 });
    contour(p, 0.34);
  };
}

// ───────────────────────── иконки желаний ─────────────────────────

function wishSprite(draw: (p: Painter, w: number, h: number) => void): (p: Painter, w: number, h: number) => void {
  return (p, w, h) => {
    const bh = h * 0.82;
    ball(p, w * 0.5, bh * 0.5, w * 0.5, bh * 0.5, [246, 240, 224], {
      ambient: 0.62,
      rim: 0.2,
      flat: 0.5,
    });
    poly(p, [w * 0.36, bh * 0.92, w * 0.5, h, w * 0.62, bh * 0.92], [242, 234, 216], 0, -0.3, 1, {
      ambient: 0.62,
    });
    draw(p, w, bh);
    contour(p, 0.3);
  };
}

const WISHES: Record<string, (p: Painter, w: number, h: number) => void> = {
  happy: (p, w, h) => {
    ball(p, w * 0.5, h * 0.46, w * 0.3, h * 0.3, [238, 196, 68], { ambient: 0.5, rim: 0.15 });
    ball(p, w * 0.42, h * 0.4, w * 0.05, h * 0.05, [50, 34, 22], { ambient: 0.8 });
    ball(p, w * 0.58, h * 0.4, w * 0.05, h * 0.05, [50, 34, 22], { ambient: 0.8 });
    ball(p, w * 0.5, h * 0.58, w * 0.16, h * 0.07, [50, 34, 22], { ambient: 0.8 });
  },
  sad: (p, w, h) => {
    ball(p, w * 0.5, h * 0.46, w * 0.3, h * 0.3, [150, 170, 186], { ambient: 0.5, rim: 0.15 });
    ball(p, w * 0.42, h * 0.4, w * 0.05, h * 0.05, [50, 34, 22], { ambient: 0.8 });
    ball(p, w * 0.58, h * 0.4, w * 0.05, h * 0.05, [50, 34, 22], { ambient: 0.8 });
    ball(p, w * 0.5, h * 0.66, w * 0.16, h * 0.06, [50, 34, 22], { ambient: 0.8 });
  },
  hunger: (p, w, h) => {
    capsule(p, w * 0.5, h * 0.72, w * 0.5, h * 0.5, w * 0.06, WOOD_D, { ambient: 0.45 });
    ball(p, w * 0.5, h * 0.4, w * 0.26, h * 0.22, [172, 104, 56], { ambient: 0.46, rim: 0.16, spec: 0.2, shine: 12 });
  },
  thirst: (p, w, h) => {
    poly(p, [w * 0.5, h * 0.16, w * 0.74, h * 0.5, w * 0.5, h * 0.76, w * 0.26, h * 0.5], WATER, -0.2, -0.3, 1, {
      ambient: 0.5,
      spec: 0.6,
      shine: 20,
    });
    ball(p, w * 0.42, h * 0.42, w * 0.06, h * 0.06, [220, 244, 255], { ambient: 0.9 });
  },
  bladder: (p, w, h) => {
    cone(p, w * 0.5, h * 0.16, h * 0.7, w * 0.26, [126, 148, 82], { ambient: 0.45 });
    ball(p, w * 0.5, h * 0.5, w * 0.1, h * 0.09, BONE, { ambient: 0.6 });
  },
  energy: (p, w, h) => {
    capsule(p, w * 0.22, h * 0.5, w * 0.78, h * 0.5, w * 0.09, WOOD, {
      albedo: woodGrain(WOOD, 8, 'x'),
      ambient: 0.45,
    });
    ball(p, w * 0.5, h * 0.28, w * 0.14, h * 0.12, SKIN, { ambient: 0.5 });
  },
  health: (p, w, h) => {
    poly(p, [w * 0.42, h * 0.16, w * 0.58, h * 0.16, w * 0.58, h * 0.72, w * 0.42, h * 0.72], [196, 62, 52], 0, -0.2, 1, {
      ambient: 0.5,
    });
    poly(p, [w * 0.22, h * 0.36, w * 0.78, h * 0.36, w * 0.78, h * 0.52, w * 0.22, h * 0.52], [196, 62, 52], 0, -0.2, 1, {
      ambient: 0.5,
    });
  },
  fun: (p, w, h) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU;
      ball(p, w * 0.5 + Math.cos(a) * w * 0.24, h * 0.46 + Math.sin(a) * h * 0.22, w * 0.09, h * 0.08, YELLOW, {
        ambient: 0.55,
        rim: 0.14,
      });
    }
  },
  leave: (p, w, h) => {
    capsule(p, w * 0.26, h * 0.46, w * 0.7, h * 0.46, w * 0.07, [70, 52, 36], { ambient: 0.5 });
    poly(p, [w * 0.56, h * 0.24, w * 0.82, h * 0.46, w * 0.56, h * 0.68], [70, 52, 36], 0, -0.2, 1, { ambient: 0.5 });
  },
};

// ───────────────────────── сборка ─────────────────────────

/** Отступ вокруг постройки — совпадает с тем, что ожидает сцена. */
const PAD = 2;

export function buildArt(_renderer: Renderer): Art {
  const make = (w: number, h: number, draw: (p: Painter, w: number, h: number) => void): Texture => {
    const p = new Painter(w, h);
    draw(p, w, h);
    return p.toTexture();
  };

  const buildings: Record<string, Texture[]> = {};
  for (const def of ALL_DEFS) {
    if (def.cat === 'road') continue;
    const sprite = SPRITES[def.key];
    if (!sprite) continue;
    const w = def.w * TILE + PAD * 2;
    const h = Math.round((def.h + LIFT) * TILE) + PAD * 2;
    const base = new Painter(w, h);
    sprite.base(base, w, h);
    const frames = sprite.anim ? (sprite.frames ?? 6) : 1;
    const list: Texture[] = [];
    for (let i = 0; i < frames; i++) {
      if (!sprite.anim) {
        list.push(base.toTexture());
        break;
      }
      const f = base.clone();
      sprite.anim(f, w, h, i / frames);
      contour(f, 0.22);
      list.push(f.toTexture());
    }
    buildings[def.key] = list;
  }

  const visitor = VISITOR_TINTS.map((tint) =>
    [0, 1, 2, 3].map((f) => make(15, 21, visitorSprite(tint, f))),
  );
  const staff: Record<string, Texture> = {};
  for (const [k, c] of Object.entries(STAFF_COLORS)) staff[k] = make(16, 22, staffSprite(c));

  const wish: Record<string, Texture> = {};
  for (const [k, d] of Object.entries(WISHES)) wish[k] = make(18, 20, wishSprite(d));

  return {
    terrain: [0, 1, 2].map((i) => make(TILE, TILE, grassTile(i))),
    water: make(TILE, TILE, waterTile),
    rock: make(TILE, TILE, rockTile),
    roadDirt: make(TILE, TILE, dirtRoadTile),
    roadStone: make(TILE, TILE, stoneRoadTile),
    buildings,
    visitor,
    staff,
    wish,
    entrance: make(TILE * 3, TILE * 2, entranceSprite),
  };
}
