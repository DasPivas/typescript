import { DEFS, SEARCH_FAR, SEARCH_NEAR } from './catalog';
import { clamp, enterQueue, isOperating, leaveQueue, serveNeed } from './buildings';
import type { Game } from './game';
import { doorRoad, ENTRY, MAP_H, MAP_W } from './grid';
import { tracePath, walkField } from './path';
import type { NeedKey, Visitor, VisitorKind } from './types';

/** Базовая скорость роста потребностей в секунду. */
const NEED_RATE: Record<NeedKey, number> = {
  hunger: 0.85,
  thirst: 1.05,
  bladder: 0.7,
  energy: -0.55,
  health: 0.05,
  fun: 1.25,
};

interface KindProfile {
  name: string;
  /** Поправки к скоростям потребностей. */
  rate: Partial<Record<NeedKey, number>>;
  /** Множитель скорости ходьбы. */
  speed: number;
  wallet: [number, number];
  /** Терпит очередь столько секунд. */
  patience: number;
  /** Максимальная бодрость аттракциона, на который сядет. */
  maxIntensity: number;
  /** Доля в потоке гостей. */
  share: number;
  scale: number;
}

export const KINDS: Record<VisitorKind, KindProfile> = {
  child: {
    name: 'ребёнок',
    rate: { fun: 1.6, energy: -0.8, hunger: 1.15, bladder: 1.2 },
    speed: 1.05,
    wallet: [40, 120],
    patience: 40,
    maxIntensity: 1.1,
    share: 0.34,
    scale: 0.78,
  },
  adult: {
    name: 'взрослый',
    rate: {},
    speed: 1,
    wallet: [90, 260],
    patience: 62,
    maxIntensity: 3,
    share: 0.51,
    scale: 1,
  },
  elder: {
    name: 'старик',
    rate: { fun: 0.85, energy: -0.9, thirst: 1.15 },
    speed: 0.76,
    wallet: [110, 280],
    patience: 46,
    maxIntensity: 0.95,
    share: 0.15,
    scale: 0.95,
  },
};

function pickKind(rnd: () => number): VisitorKind {
  let r = rnd();
  for (const k of Object.keys(KINDS) as VisitorKind[]) {
    if (r < KINDS[k].share) return k;
    r -= KINDS[k].share;
  }
  return 'adult';
}

export function addVisitor(g: Game): void {
  const kind = pickKind(g.rnd);
  const p = KINDS[kind];
  const v: Visitor = {
    id: g.takeId(),
    kind,
    x: ENTRY.x + 0.5,
    y: MAP_H - 0.5,
    state: 'walking',
    path: [],
    targetId: null,
    seeking: null,
    needs: {
      hunger: g.rnd() * 25,
      thirst: g.rnd() * 30,
      bladder: g.rnd() * 20,
      energy: 70 + g.rnd() * 30,
      health: 0,
      fun: 45 + g.rnd() * 45,
    },
    mood: 62 + g.rnd() * 18,
    wallet: p.wallet[0] + Math.floor(g.rnd() * (p.wallet[1] - p.wallet[0])),
    spent: 0,
    waited: 0,
    busyLeft: 0,
    tint: Math.floor(g.rnd() * 6),
    age: 0,
    think: 0,
    wish: 'happy',
    busyAt: null,
    busySeat: false,
  };
  g.visitors.push(v);
  g.indexVisitor(v);
  g.stats.peakVisitors = Math.max(g.stats.peakVisitors, g.visitors.length);
}

export function spawn(g: Game, dt: number): void {
  const rides = g.buildings.filter(
    (b) => DEFS[b.key].cat === 'ride' && isOperating(g, b),
  ).length;
  if (rides === 0) return;
  const desired = Math.min(
    150,
    (g.rating / 100) * (8 + rides * 6) * g.effect.attendance,
  );
  if (g.visitors.length >= desired) return;
  g.spawnAcc += dt;
  while (g.spawnAcc >= 1.4 && g.visitors.length < desired) {
    g.spawnAcc -= 1.4;
    addVisitor(g);
  }
}

export function updateVisitors(g: Game, dt: number): void {
  const leaving: number[] = [];
  for (const v of g.visitors) {
    const p = KINDS[v.kind];
    v.age += dt;
    for (const k of Object.keys(NEED_RATE) as NeedKey[]) {
      let r = NEED_RATE[k] * (p.rate[k] ?? 1);
      if (k === 'thirst') r *= g.effect.thirst;
      if (k === 'hunger') r *= g.effect.hunger;
      v.needs[k] = clamp(v.needs[k] + r * dt);
    }
    if (g.rnd() < 0.00004) v.needs.health = 100;

    const comfort = comfortOf(g, v);
    v.mood += (comfort - v.mood) * Math.min(1, dt * 0.22);
    v.mood = clamp(v.mood);

    switch (v.state) {
      case 'busy':
        v.busyLeft -= dt;
        break;
      case 'queue':
        v.waited += dt;
        if (v.waited > p.patience) {
          // «Устал стоять в очередях» — уходим искать другое занятие.
          leaveQueue(g, v);
          v.mood -= 12;
          v.wish = 'sad';
        }
        break;
      case 'fighting':
        v.busyLeft -= dt;
        if (v.busyLeft <= 0) {
          v.state = 'walking';
          v.mood = clamp(v.mood + 15);
        }
        break;
      case 'leaving':
      case 'walking':
      case 'entering':
        stepWalk(g, v, dt);
        break;
    }

    if (v.state === 'walking') {
      v.think -= dt;
      if (v.think <= 0 && v.path.length === 0) think(g, v);
    }

    // Драка от отчаяния.
    if (v.state === 'walking' && v.mood < 12 && g.rnd() < 0.0009) {
      v.state = 'fighting';
      v.busyLeft = 14;
      g.stats.fights++;
      for (const o of g.visitors) {
        if (o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 4) o.mood -= 7;
      }
      if (!g.staff.some((s) => s.kind === 'guard')) {
        g.warnOnce('fight', 'В парке драка. Наймите охранника');
      }
    }

    const outOfMoney = v.wallet < 3;
    const done = v.age > 420 || (v.mood < 18 && v.state === 'walking') || outOfMoney;
    if (done && v.state !== 'leaving' && v.state !== 'busy' && v.state !== 'queue') {
      v.state = 'leaving';
      v.targetId = null;
      v.wish = 'leave';
      v.path = pathTo(g, v, ENTRY.x, MAP_H - 1);
    }
    if (v.state === 'leaving' && v.path.length === 0 && v.y > MAP_H - 2) {
      leaving.push(v.id);
      if (v.mood >= 50) g.stats.visitorsServed++;
      else g.stats.visitorsLeftAngry++;
    }
  }
  if (leaving.length) {
    const set = new Set(leaving);
    g.visitors = g.visitors.filter((v) => !set.has(v.id));
    for (const id of set) g.dropVisitor(id);
  }
}

function comfortOf(g: Game, v: Visitor): number {
  let c = 100 + g.effect.mood;
  c -= Math.max(0, v.needs.hunger - 55) * 0.6;
  c -= Math.max(0, v.needs.thirst - 50) * 0.65;
  c -= Math.max(0, v.needs.bladder - 65) * 0.7;
  c -= Math.max(0, 35 - v.needs.energy) * 0.8;
  c -= v.needs.health * 0.35;
  c -= Math.max(0, v.needs.fun - 70) * 0.25;
  const cx = Math.floor(v.x);
  const cy = Math.floor(v.y);
  if (g.map.inside(cx, cy)) c += Math.min(18, g.map.scenery[g.map.idx(cx, cy)] * 1.4);
  return Math.max(0, Math.min(100, c));
}

function urgentNeed(v: Visitor): NeedKey {
  if (v.needs.health > 50) return 'health';
  if (v.needs.bladder > 72) return 'bladder';
  if (v.needs.thirst > 68) return 'thirst';
  if (v.needs.hunger > 70) return 'hunger';
  if (v.needs.energy < 28) return 'energy';
  return 'fun';
}

function think(g: Game, v: Visitor): void {
  v.think = 1.2 + g.rnd();
  const need = urgentNeed(v);
  v.seeking = need;

  const from = roadCellNear(g, v.x, v.y);
  if (!from) {
    // Сошли с дороги — вернёмся ко входу.
    v.path = [];
    v.x = ENTRY.x + 0.5;
    v.y = MAP_H - 1.5;
    return;
  }
  const field = walkField(g.map, from.x, from.y);
  // Рядом с указателем гость «знает» парк дальше.
  const range = g.map.signage[g.map.idx(from.x, from.y)] ? SEARCH_FAR : SEARCH_NEAR;
  const kind = KINDS[v.kind];

  let best: { id: number; cell: { x: number; y: number }; score: number } | null = null;
  for (const b of g.buildings) {
    const def = DEFS[b.key];
    if (serveNeed(def) !== need) continue;
    if (!isOperating(g, b)) continue;
    if (b.price > v.wallet) continue;
    if (b.queue.length > (def.capacity ?? 1) * 4) continue;
    if (need === 'fun' && (def.intensity ?? 1) > kind.maxIntensity) continue;
    const road = doorRoad(g.map, def, b.x, b.y, b.rot);
    if (!road) continue;
    const d = field.dist[g.map.idx(road.x, road.y)];
    if (d < 0 || d > range) continue;
    // Аттракционы: чем выше рейтинг, тем охотнее идём даже подальше.
    const score = need === 'fun' ? d - (def.rating ?? 0) * 0.25 : d;
    if (!best || score < best.score) best = { id: b.id, cell: road, score };
  }

  if (!best) {
    v.wish = need === 'fun' ? 'sad' : need;
    v.mood -= 0.6;
    const spot = randomRoad(g, field);
    if (spot) v.path = tracePath(field, spot.x, spot.y);
    return;
  }

  v.wish = v.mood > 55 ? 'happy' : need;
  v.targetId = best.id;
  v.path = tracePath(field, best.cell.x, best.cell.y);
  if (v.path.length === 0) {
    const b = g.building(best.id);
    if (b) enterQueue(g, v, b);
  }
}

function randomRoad(g: Game, field: { dist: Int32Array }): { x: number; y: number } | null {
  const cands: number[] = [];
  for (let i = 0; i < field.dist.length; i++) {
    if (field.dist[i] > 2 && field.dist[i] < 25) cands.push(i);
  }
  if (!cands.length) return null;
  const i = cands[Math.floor(g.rnd() * cands.length)];
  return { x: i % MAP_W, y: (i / MAP_W) | 0 };
}

export function roadCellNear(g: Game, px: number, py: number): { x: number; y: number } | null {
  const x = Math.floor(px);
  const y = Math.floor(py);
  if (g.map.roadAt(x, y) > 0) return { x, y };
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    if (g.map.roadAt(x + dx, y + dy) > 0) return { x: x + dx, y: y + dy };
  }
  return null;
}

function pathTo(g: Game, v: Visitor, tx: number, ty: number): { x: number; y: number }[] {
  const from = roadCellNear(g, v.x, v.y);
  if (!from) return [];
  return tracePath(walkField(g.map, from.x, from.y), tx, ty);
}

function stepWalk(g: Game, v: Visitor, dt: number): void {
  if (v.path.length === 0) {
    if (v.targetId !== null && v.state === 'walking') {
      const b = g.building(v.targetId);
      if (b && isOperating(g, b)) enterQueue(g, v, b);
      else v.targetId = null;
    }
    return;
  }
  const next = v.path[0];
  const kindSpeed = KINDS[v.kind].speed;
  const road = g.map.roadAt(next.x, next.y);
  const speed = (road === 2 ? 2.9 : 2.3) * kindSpeed;
  const tx = next.x + 0.5;
  const ty = next.y + 0.5;
  const dx = tx - v.x;
  const dy = ty - v.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d <= step) {
    v.x = tx;
    v.y = ty;
    v.path.shift();
  } else {
    v.x += (dx / d) * step;
    v.y += (dy / d) * step;
  }
}
