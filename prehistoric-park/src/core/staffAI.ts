import { DEFS } from './catalog';
import type { Game } from './game';
import { doorRoad, MAP_W } from './grid';
import { tracePath, walkField } from './path';
import { roadCellNear } from './visitors';
import { clamp } from './buildings';
import type { Staff } from './types';

export function updateStaff(g: Game, dt: number): void {
  for (const s of g.staff) {
    if (s.busy > 0) {
      s.busy -= dt;
      if (s.busy <= 0) finishTask(g, s);
      continue;
    }
    if (s.buildingId !== null) continue; // сервисный работник стоит на месте
    step(g, s, dt);
    if (s.path.length === 0) {
      s.think -= dt;
      if (s.think <= 0) think(g, s);
    }
  }
}

function finishTask(g: Game, s: Staff): void {
  if (s.kind === 'repairman' && s.taskId !== null) {
    const b = g.building(s.taskId);
    if (b) {
      b.broken = false;
      b.condition = 100;
    }
  }
  if (s.kind === 'guard' && s.taskId !== null) {
    const v = g.visitor(s.taskId);
    if (v && v.state === 'fighting') {
      v.state = 'walking';
      v.busyLeft = 0;
      v.mood = clamp(v.mood + 20);
    }
  }
  s.taskId = null;
}

function think(g: Game, s: Staff): void {
  s.think = 1.5;
  const from = roadCellNear(g, s.x, s.y);
  if (!from) return;
  const field = walkField(g.map, from.x, from.y);

  if (s.kind === 'repairman') {
    const broken = g.buildings.filter((b) => b.broken);
    let best: { cell: { x: number; y: number }; id: number; d: number } | null = null;
    for (const b of broken) {
      const road = doorRoad(g.map, DEFS[b.key], b.x, b.y, b.rot);
      if (!road) continue;
      const d = field.dist[g.map.idx(road.x, road.y)];
      if (d < 0) continue;
      if (!best || d < best.d) best = { cell: road, id: b.id, d };
    }
    if (best) {
      s.taskId = best.id;
      s.path = tracePath(field, best.cell.x, best.cell.y);
      if (s.path.length === 0) s.busy = 6;
      return;
    }
    // Профилактика: подходим к самому изношенному.
    const worn = g.buildings
      .filter((b) => DEFS[b.key].cat === 'ride' && b.condition < 70)
      .sort((a, b) => a.condition - b.condition)[0];
    if (worn) {
      const road = doorRoad(g.map, DEFS[worn.key], worn.x, worn.y, worn.rot);
      if (road) {
        s.taskId = worn.id;
        s.path = tracePath(field, road.x, road.y);
        if (s.path.length === 0) s.busy = 4;
        return;
      }
    }
  }

  if (s.kind === 'guard') {
    const fight = g.visitors.find((v) => v.state === 'fighting');
    if (fight) {
      const cell = roadCellNear(g, fight.x, fight.y);
      if (cell) {
        s.taskId = fight.id;
        s.path = tracePath(field, cell.x, cell.y);
        if (s.path.length === 0) s.busy = 2;
        return;
      }
    }
  }

  const spot = randomRoad(g, field);
  if (spot) s.path = tracePath(field, spot.x, spot.y);
}

function randomRoad(g: Game, field: { dist: Int32Array }): { x: number; y: number } | null {
  const cands: number[] = [];
  for (let i = 0; i < field.dist.length; i++) {
    if (field.dist[i] > 2 && field.dist[i] < 30) cands.push(i);
  }
  if (!cands.length) return null;
  const i = cands[Math.floor(g.rnd() * cands.length)];
  return { x: i % MAP_W, y: (i / MAP_W) | 0 };
}

function step(_g: Game, s: Staff, dt: number): void {
  if (s.path.length === 0) {
    if (s.taskId !== null && s.busy <= 0) s.busy = s.kind === 'repairman' ? 6 : 2;
    return;
  }
  const next = s.path[0];
  const tx = next.x + 0.5;
  const ty = next.y + 0.5;
  const dx = tx - s.x;
  const dy = ty - s.y;
  const d = Math.hypot(dx, dy);
  const stepLen = 2.6 * dt;
  if (d <= stepLen) {
    s.x = tx;
    s.y = ty;
    s.path.shift();
  } else {
    s.x += (dx / d) * stepLen;
    s.y += (dy / d) * stepLen;
  }
}
