import { Graphics, RenderTexture, type Renderer, type Texture } from 'pixi.js';
import { ALL_DEFS } from '../core/catalog';
import { C, STAFF_COLORS, VISITOR_TINTS } from './palette';

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
  /** [оттенок][кадр] */
  visitor: Texture[][];
  staff: Record<string, Texture>;
  wish: Record<string, Texture>;
  entrance: Texture;
}

/** t — фаза анимации 0..1; статичные постройки её игнорируют. */
type Draw = (g: Graphics, w: number, h: number, t: number) => void;

/** Сколько кадров печь для постройки. 1 — статичная картинка. */
const FRAMES: Record<string, number> = {
  karusel: 8,
  koleso: 8,
  kacheli: 6,
  batut: 4,
  tarzanka: 6,
  gorki: 8,
  dinomotor: 8,
  istochnik: 4,
};

/** Эти крутятся всегда, а не только когда внутри есть гости. */
export const ALWAYS_ANIMATED = new Set(['dinomotor', 'istochnik']);

const line = { width: 2, color: C.outline, alignment: 0.5 } as const;

function bake(renderer: Renderer, w: number, h: number, draw: Draw, pad = 2, t = 0): Texture {
  const g = new Graphics();
  draw(g, w, h, t);
  const rt = RenderTexture.create({
    width: w + pad * 2,
    height: h + pad * 2,
    resolution: 2,
    antialias: true,
  });
  g.position.set(pad, pad);
  renderer.render({ container: g, target: rt, clear: true });
  g.destroy();
  return rt;
}

// ───────────────────────── ландшафт ─────────────────────────

function grass(shade: number): Draw {
  return (g, w, h) => {
    g.rect(0, 0, w, h).fill(shade);
    // редкие травинки
    g.moveTo(w * 0.2, h * 0.7).lineTo(w * 0.24, h * 0.5).lineTo(w * 0.3, h * 0.72);
    g.moveTo(w * 0.62, h * 0.4).lineTo(w * 0.68, h * 0.22).lineTo(w * 0.74, h * 0.42);
    g.stroke({ width: 1.5, color: C.leafDark, alpha: 0.5 });
  };
}

const drawWater: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(C.water);
  g.ellipse(w * 0.35, h * 0.35, w * 0.22, h * 0.1).fill({ color: C.waterLight, alpha: 0.8 });
  g.ellipse(w * 0.7, h * 0.68, w * 0.18, h * 0.08).fill({ color: C.waterLight, alpha: 0.6 });
};

const drawRock: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(C.grass2);
  g.poly([w * 0.1, h * 0.9, w * 0.25, h * 0.25, w * 0.6, h * 0.15, w * 0.92, h * 0.85])
    .fill(C.rock)
    .stroke(line);
  g.poly([w * 0.25, h * 0.25, w * 0.6, h * 0.15, w * 0.5, h * 0.55, w * 0.32, h * 0.6]).fill(
    C.rockDark,
  );
};

const drawRoadDirt: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(C.dirt);
  g.circle(w * 0.3, h * 0.35, 1.6).fill({ color: C.woodDark, alpha: 0.35 });
  g.circle(w * 0.7, h * 0.6, 1.3).fill({ color: C.woodDark, alpha: 0.3 });
  g.circle(w * 0.5, h * 0.85, 1.1).fill({ color: C.woodDark, alpha: 0.25 });
};

const drawRoadStone: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(C.stone);
  g.rect(2, 2, w * 0.42, h * 0.42).fill(0xb0a996);
  g.rect(w * 0.52, 3, w * 0.4, h * 0.36).fill(0xa39c8a);
  g.rect(3, h * 0.54, w * 0.38, h * 0.4).fill(0xa8a18e);
  g.rect(w * 0.48, h * 0.5, w * 0.45, h * 0.44).fill(0xb4ad9a);
};

// ───────────────────────── постройки ─────────────────────────

function base(g: Graphics, w: number, h: number, color: number = C.sand): void {
  g.ellipse(w / 2, h - 4, w * 0.46, h * 0.1).fill({ color: C.shadow, alpha: 0.18 });
  g.roundRect(2, h * 0.62, w - 4, h * 0.34, 5).fill(color).stroke(line);
}

function hut(g: Graphics, w: number, h: number, roof: number): void {
  g.ellipse(w / 2, h - 3, w * 0.44, h * 0.09).fill({ color: C.shadow, alpha: 0.2 });
  g.roundRect(w * 0.12, h * 0.45, w * 0.76, h * 0.5, 4).fill(C.wood).stroke(line);
  g.poly([w * 0.04, h * 0.5, w * 0.5, h * 0.08, w * 0.96, h * 0.5]).fill(roof).stroke(line);
  g.rect(w * 0.4, h * 0.62, w * 0.2, h * 0.33).fill(C.woodDark);
}

const BUILDING_DRAW: Record<string, Draw> = {
  batut: (g, w, h, t) => {
    base(g, w, h, C.woodDark);
    // Полотно прогибается, над ним подпрыгивает фигурка.
    const dip = Math.sin(t * Math.PI * 2) * h * 0.03;
    g.ellipse(w / 2, h * 0.55 + dip, w * 0.4, h * 0.26 - dip).fill(C.cloth).stroke(line);
    g.ellipse(w / 2, h * 0.55 + dip, w * 0.28, h * 0.17).fill(C.cloth2);
    const jump = Math.max(0, Math.sin(t * Math.PI * 2)) * h * 0.22;
    g.circle(w * 0.5, h * 0.42 - jump, w * 0.07).fill(C.skin).stroke({ width: 1.2, color: C.outline });
    g.moveTo(w * 0.16, h * 0.62).lineTo(w * 0.2, h * 0.92);
    g.moveTo(w * 0.84, h * 0.62).lineTo(w * 0.8, h * 0.92);
    g.stroke({ width: 3, color: C.wood });
  },
  kacheli: (g, w, h, t) => {
    base(g, w, h, C.grass2);
    g.moveTo(w * 0.18, h * 0.95).lineTo(w * 0.34, h * 0.2).lineTo(w * 0.5, h * 0.95);
    g.moveTo(w * 0.5, h * 0.95).lineTo(w * 0.66, h * 0.2).lineTo(w * 0.82, h * 0.95);
    g.stroke({ width: 4, color: C.wood });
    g.moveTo(w * 0.34, h * 0.2).lineTo(w * 0.66, h * 0.2).stroke({ width: 4, color: C.woodDark });
    // Сиденье качается влево-вправо.
    const sw = Math.sin(t * Math.PI * 2) * w * 0.12;
    const drop = h * 0.4 - Math.abs(sw) * 0.35;
    g.moveTo(w * 0.44, h * 0.22).lineTo(w * 0.44 + sw, h * 0.22 + drop);
    g.moveTo(w * 0.58, h * 0.22).lineTo(w * 0.58 + sw, h * 0.22 + drop);
    g.stroke({ width: 2, color: C.bone });
    g.roundRect(w * 0.4 + sw, h * 0.2 + drop, w * 0.22, h * 0.07, 2).fill(C.wood).stroke(line);
  },
  tir: (g, w, h) => {
    base(g, w, h, C.wood);
    g.roundRect(w * 0.1, h * 0.5, w * 0.8, h * 0.2, 3).fill(C.woodDark).stroke(line);
    g.circle(w * 0.32, h * 0.32, w * 0.13).fill(C.bone).stroke(line);
    g.circle(w * 0.32, h * 0.32, w * 0.07).fill(C.red);
    g.circle(w * 0.68, h * 0.28, w * 0.1).fill(C.bone).stroke(line);
    g.circle(w * 0.68, h * 0.28, w * 0.05).fill(C.red);
  },
  karusel: (g, w, h, t) => {
    g.ellipse(w / 2, h - 5, w * 0.42, h * 0.1).fill({ color: C.shadow, alpha: 0.2 });
    g.ellipse(w / 2, h * 0.78, w * 0.42, h * 0.14).fill(C.sand).stroke(line);
    g.moveTo(w / 2, h * 0.78).lineTo(w / 2, h * 0.22).stroke({ width: 4, color: C.wood });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * Math.PI * 2;
      const x = w / 2 + Math.cos(a) * w * 0.33;
      const y = h * 0.66 + Math.sin(a) * h * 0.1;
      g.circle(x, y, w * 0.07).fill(i % 2 ? C.yellow : C.red).stroke(line);
    }
    const pts: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(w / 2 + Math.cos(a) * w * 0.46, h * 0.32 + Math.sin(a) * h * 0.12);
    }
    g.poly(pts).fill(C.red).stroke(line);
    g.ellipse(w / 2, h * 0.32, w * 0.24, h * 0.06).fill(C.yellow);
  },
  tarzanka: (g, w, h, t) => {
    base(g, w, h, C.grass2);
    g.poly([w * 0.3, h * 0.95, w * 0.42, h * 0.1, w * 0.58, h * 0.1, w * 0.7, h * 0.95])
      .fill(C.wood)
      .stroke(line);
    const sw = Math.sin(t * Math.PI * 2);
    const ex = w * (0.62 + sw * 0.18);
    const ey = h * (0.75 - Math.abs(sw) * 0.12);
    g.moveTo(w * 0.5, h * 0.12)
      .bezierCurveTo(w * 0.85, h * 0.3, w * 0.8, h * 0.6, ex, ey)
      .stroke({ width: 3, color: C.leafDark });
    g.circle(ex, ey + h * 0.03, w * 0.06).fill(C.fur).stroke(line);
  },
  strah: (g, w, h) => {
    g.ellipse(w / 2, h - 5, w * 0.44, h * 0.1).fill({ color: C.shadow, alpha: 0.2 });
    g.roundRect(w * 0.08, h * 0.3, w * 0.84, h * 0.62, 8).fill(C.rockDark).stroke(line);
    g.ellipse(w * 0.5, h * 0.92, w * 0.22, h * 0.24).fill(0x14100c);
    g.circle(w * 0.5, h * 0.5, w * 0.12).fill(C.bone).stroke(line);
    g.circle(w * 0.46, h * 0.48, w * 0.026).fill(C.outline);
    g.circle(w * 0.55, h * 0.48, w * 0.026).fill(C.outline);
    g.rect(w * 0.44, h * 0.56, w * 0.12, w * 0.03).fill(C.outline);
  },
  koleso: (g, w, h, t) => {
    g.ellipse(w / 2, h - 5, w * 0.36, h * 0.08).fill({ color: C.shadow, alpha: 0.2 });
    g.moveTo(w * 0.28, h * 0.95).lineTo(w * 0.5, h * 0.55).lineTo(w * 0.72, h * 0.95);
    g.stroke({ width: 5, color: C.wood });
    const cx = w / 2;
    const cy = h * 0.45;
    const r = Math.min(w, h) * 0.4;
    g.circle(cx, cy, r).stroke({ width: 4, color: C.woodDark });
    const spin = t * Math.PI * 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + spin;
      g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.stroke({ width: 2, color: C.wood });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + spin;
      g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.13)
        .fill(i % 2 ? C.red : C.yellow)
        .stroke(line);
    }
    g.circle(cx, cy, r * 0.12).fill(C.bone).stroke(line);
  },
  gorki: (g, w, h, t) => {
    base(g, w, h, C.grass2);
    for (let i = 0; i < 5; i++) {
      const x = w * (0.14 + i * 0.18);
      g.moveTo(x, h * 0.95).lineTo(x, h * 0.4).stroke({ width: 3, color: C.wood });
    }
    g.moveTo(w * 0.06, h * 0.55)
      .bezierCurveTo(w * 0.3, h * 0.02, w * 0.55, h * 0.72, w * 0.96, h * 0.28)
      .stroke({ width: 6, color: C.woodDark });
    g.moveTo(w * 0.06, h * 0.62)
      .bezierCurveTo(w * 0.3, h * 0.1, w * 0.55, h * 0.8, w * 0.96, h * 0.36)
      .stroke({ width: 3, color: C.wood });
    // Вагонетка едет по кривой (та же безье, что и рельсы).
    const bez = (p: number, a: number, b1: number, c: number, d: number) => {
      const u = 1 - p;
      return u * u * u * a + 3 * u * u * p * b1 + 3 * u * p * p * c + p * p * p * d;
    };
    const cx = bez(t, w * 0.06, w * 0.3, w * 0.55, w * 0.96);
    const cy = bez(t, h * 0.58, h * 0.06, h * 0.76, h * 0.32);
    g.roundRect(cx - w * 0.06, cy - h * 0.09, w * 0.13, h * 0.09, 3).fill(C.red).stroke(line);
  },
  istochnik: (g, w, h, t) => {
    g.ellipse(w / 2, h * 0.62, w * 0.36, h * 0.28).fill(C.rock).stroke(line);
    g.ellipse(w / 2, h * 0.6, w * 0.24, h * 0.18).fill(C.water);
    // Круги по воде.
    const r = 0.04 + t * 0.14;
    g.ellipse(w / 2, h * 0.6, w * r, h * r * 0.7).stroke({
      width: 1.5,
      color: C.waterLight,
      alpha: 1 - t,
    });
    g.ellipse(w * 0.44, h * 0.55, w * 0.06, h * 0.04).fill(C.waterLight);
  },
  tualet: (g, w, h) => {
    hut(g, w, h, C.leafDark);
    g.circle(w * 0.5, h * 0.32, w * 0.08).fill(C.bone).stroke(line);
  },
  morozh: (g, w, h) => {
    base(g, w, h, C.cloth2);
    g.roundRect(w * 0.1, h * 0.44, w * 0.8, h * 0.24, 3).fill(C.wood).stroke(line);
    g.poly([w * 0.42, h * 0.42, w * 0.58, h * 0.42, w * 0.5, h * 0.72]).fill(C.orange).stroke(line);
    g.circle(w * 0.5, h * 0.36, w * 0.1).fill(C.cloth2).stroke(line);
  },
  zakusochnaya: (g, w, h) => {
    hut(g, w, h, C.cloth);
    g.moveTo(w * 0.3, h * 0.86).lineTo(w * 0.7, h * 0.86).stroke({ width: 3, color: C.woodDark });
    g.poly([w * 0.42, h * 0.86, w * 0.5, h * 0.7, w * 0.58, h * 0.86]).fill(C.orange);
  },
  medpunkt: (g, w, h) => {
    hut(g, w, h, 0x7d4bb0);
    g.circle(w * 0.5, h * 0.3, w * 0.1).fill(C.bone).stroke(line);
    g.rect(w * 0.46, h * 0.22, w * 0.08, h * 0.16).fill(C.red);
    g.rect(w * 0.38, h * 0.27, w * 0.24, h * 0.06).fill(C.red);
  },
  dinomotor: (g, w, h, t) => {
    base(g, w, h, C.woodDark);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.3;
    const pts: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + t * (Math.PI / 6);
      const rr = i % 2 === 0 ? r : r * 0.78;
      pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.poly(pts).fill(C.wood).stroke(line);
    g.circle(cx, cy, r * 0.35).fill(C.leaf).stroke(line);
    g.circle(cx - r * 0.12, cy - r * 0.08, r * 0.07).fill(C.outline);
  },
  skameyka: (g, w, h) => {
    g.ellipse(w / 2, h * 0.78, w * 0.4, h * 0.1).fill({ color: C.shadow, alpha: 0.15 });
    g.roundRect(w * 0.08, h * 0.5, w * 0.84, h * 0.22, 5).fill(C.wood).stroke(line);
    g.ellipse(w * 0.3, h * 0.6, w * 0.05, h * 0.04).fill(C.woodDark);
    g.ellipse(w * 0.68, h * 0.6, w * 0.05, h * 0.04).fill(C.woodDark);
  },
  cvety: (g, w, h) => {
    for (const [x, y, c] of [
      [0.3, 0.55, C.red],
      [0.62, 0.42, C.yellow],
      [0.5, 0.72, 0xe86ab0],
    ] as [number, number, number][]) {
      g.moveTo(w * x, h * 0.85).lineTo(w * x, h * y).stroke({ width: 2, color: C.leafDark });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.circle(w * x + Math.cos(a) * 3.2, h * y + Math.sin(a) * 3.2, 2.6).fill(c);
      }
      g.circle(w * x, h * y, 2).fill(C.bone);
    }
  },
  kust: (g, w, h) => {
    g.ellipse(w / 2, h * 0.85, w * 0.32, h * 0.08).fill({ color: C.shadow, alpha: 0.15 });
    g.circle(w * 0.36, h * 0.6, w * 0.2).fill(C.leaf);
    g.circle(w * 0.62, h * 0.56, w * 0.22).fill(C.leafLight);
    g.circle(w * 0.5, h * 0.72, w * 0.24).fill(C.leafDark);
  },
  derevo: (g, w, h) => {
    g.ellipse(w / 2, h * 0.92, w * 0.26, h * 0.06).fill({ color: C.shadow, alpha: 0.18 });
    g.rect(w * 0.44, h * 0.55, w * 0.12, h * 0.4).fill(C.wood).stroke(line);
    g.circle(w * 0.5, h * 0.42, w * 0.3).fill(C.leaf).stroke(line);
    g.circle(w * 0.38, h * 0.34, w * 0.16).fill(C.leafLight);
    g.circle(w * 0.64, h * 0.5, w * 0.14).fill(C.leafDark);
  },
  palma: (g, w, h) => {
    g.ellipse(w / 2, h * 0.94, w * 0.24, h * 0.05).fill({ color: C.shadow, alpha: 0.18 });
    g.moveTo(w * 0.5, h * 0.95)
      .bezierCurveTo(w * 0.44, h * 0.6, w * 0.56, h * 0.45, w * 0.5, h * 0.3)
      .stroke({ width: 5, color: C.wood });
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      g.moveTo(w * 0.5, h * 0.3).bezierCurveTo(
        w * 0.5 + Math.cos(a) * w * 0.2,
        h * 0.3 + Math.sin(a) * h * 0.16,
        w * 0.5 + Math.cos(a) * w * 0.38,
        h * 0.3 + Math.sin(a) * h * 0.1,
        w * 0.5 + Math.cos(a) * w * 0.44,
        h * 0.3 + Math.sin(a) * h * 0.22,
      );
    }
    g.stroke({ width: 4, color: C.leaf });
    g.circle(w * 0.44, h * 0.34, 2.6).fill(C.orange);
    g.circle(w * 0.56, h * 0.35, 2.6).fill(C.orange);
  },
};

const drawEntrance: Draw = (g, w, h) => {
  g.ellipse(w / 2, h - 4, w * 0.42, h * 0.09).fill({ color: C.shadow, alpha: 0.2 });
  g.rect(w * 0.06, h * 0.3, w * 0.14, h * 0.66).fill(C.wood).stroke(line);
  g.rect(w * 0.8, h * 0.3, w * 0.14, h * 0.66).fill(C.wood).stroke(line);
  g.roundRect(w * 0.02, h * 0.08, w * 0.96, h * 0.26, 6).fill(C.cloth).stroke(line);
  g.circle(w * 0.5, h * 0.21, h * 0.08).fill(C.bone).stroke(line);
};

// ───────────────────────── человечки ─────────────────────────

function drawVisitor(tint: number, frame: number): Draw {
  return (g, w, h) => {
    const swing = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    g.ellipse(w / 2, h - 1.5, w * 0.3, 1.6).fill({ color: C.shadow, alpha: 0.22 });
    // ноги
    g.moveTo(w * 0.42, h * 0.72).lineTo(w * 0.36 + swing * 1.6, h * 0.96);
    g.moveTo(w * 0.58, h * 0.72).lineTo(w * 0.64 - swing * 1.6, h * 0.96);
    g.stroke({ width: 2.4, color: C.skin });
    // тело — шкура
    g.roundRect(w * 0.3, h * 0.42, w * 0.4, h * 0.34, 2).fill(tint).stroke({ width: 1.2, color: C.outline });
    g.circle(w * 0.42, h * 0.55, 1.1).fill(C.furSpot);
    g.circle(w * 0.6, h * 0.64, 1).fill(C.furSpot);
    // руки
    g.moveTo(w * 0.3, h * 0.5).lineTo(w * 0.16, h * 0.68 + swing * 2);
    g.moveTo(w * 0.7, h * 0.5).lineTo(w * 0.84, h * 0.68 - swing * 2);
    g.stroke({ width: 2.2, color: C.skin });
    // голова
    g.circle(w * 0.5, h * 0.27, w * 0.24).fill(C.skin).stroke({ width: 1.2, color: C.outline });
    g.moveTo(w * 0.27, h * 0.22)
      .bezierCurveTo(w * 0.36, h * 0.02, w * 0.66, h * 0.02, w * 0.74, h * 0.22)
      .fill(C.hair);
    g.circle(w * 0.43, h * 0.28, 1).fill(C.outline);
    g.circle(w * 0.58, h * 0.28, 1).fill(C.outline);
  };
}

function drawStaff(color: number): Draw {
  return (g, w, h) => {
    g.ellipse(w / 2, h - 1.5, w * 0.3, 1.6).fill({ color: C.shadow, alpha: 0.22 });
    g.moveTo(w * 0.42, h * 0.72).lineTo(w * 0.38, h * 0.96);
    g.moveTo(w * 0.58, h * 0.72).lineTo(w * 0.62, h * 0.96);
    g.stroke({ width: 2.4, color: C.skin });
    g.roundRect(w * 0.28, h * 0.4, w * 0.44, h * 0.36, 2).fill(color).stroke({ width: 1.2, color: C.outline });
    g.moveTo(w * 0.28, h * 0.48).lineTo(w * 0.14, h * 0.66);
    g.moveTo(w * 0.72, h * 0.48).lineTo(w * 0.86, h * 0.66);
    g.stroke({ width: 2.2, color: C.skin });
    g.circle(w * 0.5, h * 0.26, w * 0.24).fill(C.skin).stroke({ width: 1.2, color: C.outline });
    g.roundRect(w * 0.24, h * 0.12, w * 0.52, h * 0.1, 2).fill(color).stroke({ width: 1, color: C.outline });
    g.circle(w * 0.43, h * 0.28, 1).fill(C.outline);
    g.circle(w * 0.58, h * 0.28, 1).fill(C.outline);
  };
}

// ───────────────────────── иконки желаний ─────────────────────────

function bubble(g: Graphics, w: number, h: number): void {
  g.roundRect(0, 0, w, h * 0.82, 4).fill(C.cloth2).stroke({ width: 1.5, color: C.outline });
  g.poly([w * 0.36, h * 0.8, w * 0.5, h, w * 0.6, h * 0.8]).fill(C.cloth2);
}

const WISH_DRAW: Record<string, Draw> = {
  happy: (g, w, h) => {
    bubble(g, w, h);
    g.circle(w * 0.5, h * 0.4, w * 0.24).fill(C.yellow).stroke({ width: 1.2, color: C.outline });
    g.circle(w * 0.42, h * 0.34, 1).fill(C.outline);
    g.circle(w * 0.58, h * 0.34, 1).fill(C.outline);
    g.arc(w * 0.5, h * 0.4, w * 0.14, 0.2, Math.PI - 0.2).stroke({ width: 1.4, color: C.outline });
  },
  sad: (g, w, h) => {
    bubble(g, w, h);
    g.circle(w * 0.5, h * 0.4, w * 0.24).fill(0x9fb6c4).stroke({ width: 1.2, color: C.outline });
    g.circle(w * 0.42, h * 0.34, 1).fill(C.outline);
    g.circle(w * 0.58, h * 0.34, 1).fill(C.outline);
    g.arc(w * 0.5, h * 0.56, w * 0.14, Math.PI + 0.2, -0.2).stroke({ width: 1.4, color: C.outline });
  },
  hunger: (g, w, h) => {
    bubble(g, w, h);
    g.poly([w * 0.3, h * 0.6, w * 0.5, h * 0.16, w * 0.7, h * 0.6]).fill(C.orange).stroke({ width: 1.2, color: C.outline });
    g.rect(w * 0.44, h * 0.52, w * 0.12, h * 0.2).fill(C.wood);
  },
  thirst: (g, w, h) => {
    bubble(g, w, h);
    g.poly([w * 0.5, h * 0.12, w * 0.72, h * 0.5, w * 0.5, h * 0.72, w * 0.28, h * 0.5])
      .fill(C.water)
      .stroke({ width: 1.2, color: C.outline });
  },
  bladder: (g, w, h) => {
    bubble(g, w, h);
    g.roundRect(w * 0.3, h * 0.16, w * 0.4, h * 0.5, 3).fill(C.leafDark).stroke({ width: 1.2, color: C.outline });
    g.circle(w * 0.5, h * 0.4, w * 0.1).fill(C.bone);
  },
  energy: (g, w, h) => {
    bubble(g, w, h);
    g.roundRect(w * 0.22, h * 0.34, w * 0.56, h * 0.16, 3).fill(C.wood).stroke({ width: 1.2, color: C.outline });
    g.circle(w * 0.5, h * 0.2, w * 0.12).fill(C.skin).stroke({ width: 1, color: C.outline });
  },
  health: (g, w, h) => {
    bubble(g, w, h);
    g.rect(w * 0.42, h * 0.14, w * 0.16, h * 0.5).fill(C.red);
    g.rect(w * 0.24, h * 0.3, w * 0.52, h * 0.16).fill(C.red);
  },
  fun: (g, w, h) => {
    bubble(g, w, h);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      g.circle(w * 0.5 + Math.cos(a) * w * 0.2, h * 0.4 + Math.sin(a) * h * 0.18, 2.4).fill(C.yellow);
    }
  },
  leave: (g, w, h) => {
    bubble(g, w, h);
    g.moveTo(w * 0.28, h * 0.4).lineTo(w * 0.7, h * 0.4);
    g.moveTo(w * 0.54, h * 0.24).lineTo(w * 0.72, h * 0.4).lineTo(w * 0.54, h * 0.56);
    g.stroke({ width: 2, color: C.outline });
  },
};

// ───────────────────────── сборка ─────────────────────────

export function buildArt(renderer: Renderer): Art {
  const buildings: Record<string, Texture[]> = {};
  for (const def of ALL_DEFS) {
    if (def.cat === 'road') continue;
    const draw = BUILDING_DRAW[def.key];
    if (!draw) continue;
    const w = def.w * TILE;
    const h = Math.round((def.h + LIFT) * TILE);
    const n = FRAMES[def.key] ?? 1;
    buildings[def.key] = Array.from({ length: n }, (_, i) => bake(renderer, w, h, draw, 2, i / n));
  }

  const visitor = VISITOR_TINTS.map((t) => [0, 1, 2].map((f) => bake(renderer, 14, 20, drawVisitor(t, f))));
  const staff: Record<string, Texture> = {};
  for (const [k, c] of Object.entries(STAFF_COLORS)) staff[k] = bake(renderer, 15, 21, drawStaff(c));

  const wish: Record<string, Texture> = {};
  for (const [k, d] of Object.entries(WISH_DRAW)) wish[k] = bake(renderer, 18, 20, d);

  return {
    terrain: [
      bake(renderer, TILE, TILE, grass(C.grass1), 0),
      bake(renderer, TILE, TILE, grass(C.grass2), 0),
      bake(renderer, TILE, TILE, grass(C.grass3), 0),
    ],
    water: bake(renderer, TILE, TILE, drawWater, 0),
    rock: bake(renderer, TILE, TILE, drawRock, 0),
    roadDirt: bake(renderer, TILE, TILE, drawRoadDirt, 0),
    roadStone: bake(renderer, TILE, TILE, drawRoadStone, 0),
    buildings,
    visitor,
    staff,
    wish,
    entrance: bake(renderer, TILE * 3, TILE * 2, drawEntrance),
  };
}
