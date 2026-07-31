import { DEFS, MOTOR_RADIUS } from './catalog';
import type { Building, BuildingDef, RoadKind, Rot, Terrain } from './types';
import { mulberry32 } from './rng';

export const MAP_W = 26;
export const MAP_H = 34;

/** Клетка входа в парк — снизу по центру. Отсюда приходят посетители. */
export const ENTRY = { x: MAP_W >> 1, y: MAP_H - 1 };

export interface Placement {
  ok: boolean;
  reason?: string;
}

export class ParkMap {
  terrain: Uint8Array;
  road: Uint8Array;
  /** id постройки в клетке или -1. */
  occ: Int16Array;
  /** Суммарный бонус декора в клетке (пересчитывается при постройке). */
  scenery: Float32Array;
  /** Покрытие диномоторами. */
  motor: Uint8Array;

  constructor(seed: number, water: number, rocks: number) {
    this.terrain = new Uint8Array(MAP_W * MAP_H);
    this.road = new Uint8Array(MAP_W * MAP_H);
    this.occ = new Int16Array(MAP_W * MAP_H).fill(-1);
    this.scenery = new Float32Array(MAP_W * MAP_H);
    this.motor = new Uint8Array(MAP_W * MAP_H);
    this.generate(seed, water, rocks);
  }

  idx(x: number, y: number): number {
    return y * MAP_W + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }

  private generate(seed: number, water: number, rocks: number): void {
    const rnd = mulberry32(seed);
    // Мягкий шум: несколько «капель», раздутых до пятен.
    const blobs = Math.round(water * 10) + Math.round(rocks * 8);
    for (let b = 0; b < blobs; b++) {
      const isWater = b < Math.round(water * 10);
      const cx = 2 + Math.floor(rnd() * (MAP_W - 4));
      const cy = 2 + Math.floor(rnd() * (MAP_H - 8));
      const r = 1 + rnd() * (isWater ? 2.6 : 1.6);
      for (let y = Math.max(0, cy - 4); y < Math.min(MAP_H, cy + 5); y++) {
        for (let x = Math.max(0, cx - 4); x < Math.min(MAP_W, cx + 5); x++) {
          const d = Math.hypot(x - cx, y - cy) + rnd() * 0.9;
          if (d < r) this.terrain[this.idx(x, y)] = (isWater ? 1 : 2) as Terrain;
        }
      }
    }
    // Площадка у входа всегда чистая.
    for (let y = MAP_H - 7; y < MAP_H; y++) {
      for (let x = ENTRY.x - 4; x <= ENTRY.x + 4; x++) {
        if (this.inside(x, y)) this.terrain[this.idx(x, y)] = 0;
      }
    }
    // Стартовый кусок дороги от входа.
    for (let y = MAP_H - 1; y >= MAP_H - 4; y--) this.road[this.idx(ENTRY.x, y)] = 1;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.idx(x, y)] as Terrain;
  }

  roadAt(x: number, y: number): RoadKind {
    if (!this.inside(x, y)) return 0;
    return this.road[this.idx(x, y)] as RoadKind;
  }

  buildingIdAt(x: number, y: number): number {
    if (!this.inside(x, y)) return -1;
    return this.occ[this.idx(x, y)];
  }
}

/** Габариты постройки с учётом поворота. */
export function dims(def: BuildingDef, rot: Rot): { w: number; h: number } {
  return rot % 2 === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}

function rotateCell(
  def: BuildingDef,
  cell: { x: number; y: number },
  x: number,
  y: number,
  rot: Rot,
): { x: number; y: number } {
  const { x: dx, y: dy } = cell;
  switch (rot) {
    case 0:
      return { x: x + dx, y: y + dy };
    case 1:
      return { x: x + (def.h - 1 - dy), y: y + dx };
    case 2:
      return { x: x + (def.w - 1 - dx), y: y + (def.h - 1 - dy) };
    default:
      return { x: x + dy, y: y + (def.w - 1 - dx) };
  }
}

/** Абсолютная клетка входа с учётом поворота. */
export function doorCell(def: BuildingDef, x: number, y: number, rot: Rot): { x: number; y: number } {
  return rotateCell(def, def.door, x, y, rot);
}

/** Абсолютная клетка выхода (если у постройки он отдельный). */
export function exitCell(
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rot,
): { x: number; y: number } | null {
  if (!def.exit) return null;
  return rotateCell(def, def.exit, x, y, rot);
}

export function cellsOf(def: BuildingDef, x: number, y: number, rot: Rot): { x: number; y: number }[] {
  const { w, h } = dims(def, rot);
  const out: { x: number; y: number }[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push({ x: x + i, y: y + j });
  return out;
}

/** Клетка дороги, примыкающая к указанной клетке (или null). */
export function roadNextTo(
  map: ParkMap,
  cell: { x: number; y: number },
): { x: number; y: number } | null {
  const around = [
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x - 1, y: cell.y },
  ];
  for (const c of around) if (map.roadAt(c.x, c.y) > 0) return c;
  return null;
}

/** Клетка дороги, к которой примыкает вход (или null). */
export function doorRoad(
  map: ParkMap,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rot,
): { x: number; y: number } | null {
  return roadNextTo(map, doorCell(def, x, y, rot));
}

/** Клетка дороги у выхода. Если выхода нет — это тот же вход. */
export function exitRoad(
  map: ParkMap,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rot,
): { x: number; y: number } | null {
  const e = exitCell(def, x, y, rot);
  if (!e) return doorRoad(map, def, x, y, rot);
  return roadNextTo(map, e);
}

export function hasMotor(map: ParkMap, def: BuildingDef, x: number, y: number, rot: Rot): boolean {
  for (const c of cellsOf(def, x, y, rot)) {
    if (map.inside(c.x, c.y) && map.motor[map.idx(c.x, c.y)] > 0) return true;
  }
  return false;
}

export function canPlace(
  map: ParkMap,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rot,
): Placement {
  const cells = cellsOf(def, x, y, rot);
  for (const c of cells) {
    if (!map.inside(c.x, c.y)) return { ok: false, reason: 'за краем карты' };
    const i = map.idx(c.x, c.y);
    if (map.terrain[i] === 1) return { ok: false, reason: 'здесь вода' };
    if (map.terrain[i] === 2) return { ok: false, reason: 'здесь скала' };
    if (map.road[i] > 0) return { ok: false, reason: 'здесь дорога' };
    if (map.occ[i] >= 0) return { ok: false, reason: 'клетка занята' };
  }
  if (def.cat !== 'decor' && !doorRoad(map, def, x, y, rot)) {
    return { ok: false, reason: 'не подведена дорога ко входу' };
  }
  if (def.exit && !exitRoad(map, def, x, y, rot)) {
    return { ok: false, reason: 'не подведена дорога к выходу' };
  }
  if (def.needsMotor && !hasMotor(map, def, x, y, rot)) {
    return { ok: false, reason: 'нужен диномотор' };
  }
  return { ok: true };
}

export function canPlaceRoad(map: ParkMap, x: number, y: number): Placement {
  if (!map.inside(x, y)) return { ok: false, reason: 'за краем карты' };
  const i = map.idx(x, y);
  if (map.terrain[i] === 1) return { ok: false, reason: 'здесь вода' };
  if (map.terrain[i] === 2) return { ok: false, reason: 'здесь скала' };
  if (map.occ[i] >= 0) return { ok: false, reason: 'клетка занята' };
  return { ok: true };
}

export function stamp(map: ParkMap, b: Building): void {
  const def = DEFS[b.key];
  for (const c of cellsOf(def, b.x, b.y, b.rot)) map.occ[map.idx(c.x, c.y)] = b.id;
}

export function unstamp(map: ParkMap, b: Building): void {
  const def = DEFS[b.key];
  for (const c of cellsOf(def, b.x, b.y, b.rot)) map.occ[map.idx(c.x, c.y)] = -1;
}

/** Пересчёт бонусов декора и покрытия диномоторов. */
export function recalcFields(map: ParkMap, buildings: Building[]): void {
  map.scenery.fill(0);
  map.motor.fill(0);
  for (const b of buildings) {
    const def = DEFS[b.key];
    if (def.scenery) {
      const r = def.sceneryRadius ?? 3;
      for (let y = b.y - r; y <= b.y + r; y++) {
        for (let x = b.x - r; x <= b.x + r; x++) {
          if (!map.inside(x, y)) continue;
          const d = Math.hypot(x - b.x, y - b.y);
          if (d > r) continue;
          map.scenery[map.idx(x, y)] += def.scenery * (1 - d / (r + 1));
        }
      }
    }
    if (b.key === 'dinomotor') {
      const r = MOTOR_RADIUS;
      for (let y = b.y - r; y <= b.y + r; y++) {
        for (let x = b.x - r; x <= b.x + r; x++) {
          if (!map.inside(x, y)) continue;
          if (Math.hypot(x - b.x, y - b.y) <= r) map.motor[map.idx(x, y)] = 1;
        }
      }
    }
  }
  // Каменная дорога тоже немного радует глаз.
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (map.road[map.idx(x, y)] === 2) map.scenery[map.idx(x, y)] += 1.5;
    }
  }
}
