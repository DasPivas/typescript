import { DEFS } from './catalog';
import type { Game } from './game';
import { doorCell, doorRoad, exitRoad } from './grid';
import type { Building, BuildingDef, NeedKey, Visitor } from './types';

/** Что закрывает постройка: сервис — свою потребность, аттракцион — скуку. */
export function serveNeed(def: BuildingDef): NeedKey | null {
  if (def.cat === 'ride') return 'fun';
  if (def.serves) return def.serves;
  if (def.seat) return 'energy';
  return null;
}

/** Справедливая цена: аттракцион — по рейтингу, сервис — по «полезности». */
export function fairPrice(def: BuildingDef): number {
  if (def.cat === 'ride') return (def.rating ?? 10) * 0.35;
  return (def.servePower ?? 30) * 0.09;
}

export function isOperating(_g: Game, b: Building): boolean {
  const def = DEFS[b.key];
  return !b.broken && (!def.needsStaff || b.staffId !== null);
}

/**
 * Клетки, по которым тянется очередь: от дороги у входа и дальше вдоль дороги,
 * прочь от постройки. Считается один раз и живёт до перестройки дорог.
 */
export function queueSlots(g: Game, b: Building): { x: number; y: number }[] {
  if (b.slots) return b.slots;
  const def = DEFS[b.key];
  const road = doorRoad(g.map, def, b.x, b.y, b.rot);
  if (!road) {
    b.slots = [];
    return b.slots;
  }
  const door = doorCell(def, b.x, b.y, b.rot);
  const slots = [road];
  let prev = door;
  let cur = road;
  for (let i = 0; i < 5; i++) {
    // Сначала пробуем идти прямо, потом вбок.
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const cands = [
      { x: cur.x + dx, y: cur.y + dy },
      { x: cur.x + dy, y: cur.y + dx },
      { x: cur.x - dy, y: cur.y - dx },
    ];
    const next = cands.find(
      (c) => g.map.roadAt(c.x, c.y) > 0 && !slots.some((s) => s.x === c.x && s.y === c.y),
    );
    if (!next) break;
    slots.push(next);
    prev = cur;
    cur = next;
  }
  b.slots = slots;
  return slots;
}

/** Поставить гостя на своё место в ленте очереди (по два человека на клетку). */
export function placeInQueue(g: Game, v: Visitor, b: Building, index: number): void {
  const slots = queueSlots(g, b);
  if (!slots.length) return;
  const cell = slots[Math.min(Math.floor(index / 2), slots.length - 1)];
  const side = index % 2 === 0 ? -0.22 : 0.22;
  const depth = Math.max(0, Math.floor(index / 2) - (slots.length - 1)) * 0.18;
  v.x = cell.x + 0.5 + side;
  v.y = cell.y + 0.5 + depth;
}

export function repositionQueue(g: Game, b: Building): void {
  for (let i = 0; i < b.queue.length; i++) {
    const v = g.visitor(b.queue[i]);
    if (v && v.state === 'queue') placeInQueue(g, v, b, i);
  }
}

export function enterQueue(g: Game, v: Visitor, b: Building): void {
  v.state = 'queue';
  v.waited = 0;
  b.queue.push(v.id);
  placeInQueue(g, v, b, b.queue.length - 1);
}

/** Выдернуть гостя из очереди, где бы он ни стоял. */
export function leaveQueue(g: Game, v: Visitor): void {
  for (const b of g.buildings) {
    const i = b.queue.indexOf(v.id);
    if (i >= 0) {
      b.queue.splice(i, 1);
      repositionQueue(g, b);
      break;
    }
  }
  v.state = 'walking';
  v.targetId = null;
  v.waited = 0;
  v.think = 0;
}

export function updateBuildings(g: Game, dt: number): void {
  for (const b of g.buildings) {
    const def = DEFS[b.key];
    if (!def.capacity) continue;

    for (const r of b.riders) r.left -= dt;
    const done = b.riders.filter((r) => r.left <= 0);
    if (done.length) {
      b.riders = b.riders.filter((r) => r.left > 0);
      for (const r of done) finishUse(g, b, r.vid);
    }

    if (!isOperating(g, b)) continue;
    let moved = false;
    while (b.riders.length < (def.capacity ?? 1) && b.queue.length) {
      const vid = b.queue.shift()!;
      const v = g.visitor(vid);
      if (!v || v.state !== 'queue') continue;
      if (v.wallet < b.price) {
        v.wish = 'sad';
        v.mood -= 8;
        v.state = 'walking';
        v.targetId = null;
        continue;
      }
      v.wallet -= b.price;
      v.spent += b.price;
      g.money += b.price;
      g.stats.income += b.price;
      b.revenue += b.price;
      b.uses++;
      g.emit(b.price > 0 ? 'coin' : 'click');
      if (def.cat === 'ride') g.emit('ride');
      v.state = 'busy';
      v.busyLeft = def.duration ?? 5;
      v.busySeat = def.seat === true;
      v.busyAt = def.seat ? { x: b.x, y: b.y } : null;
      b.riders.push({ vid: v.id, left: v.busyLeft });
      wear(g, b);
      moved = true;
    }
    if (moved) repositionQueue(g, b);
  }
}

function wear(g: Game, b: Building): void {
  const def = DEFS[b.key];
  if (def.cat !== 'ride') return;
  // Бодрые аттракционы изнашиваются быстрее.
  b.condition -= (0.3 + g.rnd() * 0.2) * (0.7 + (def.intensity ?? 1) * 0.5);
  if (b.condition < 45 && g.rnd() < (45 - b.condition) / 45 / 22) {
    b.broken = true;
    b.condition = Math.max(5, b.condition);
    g.stats.breakdowns++;
    g.emit('break');
    for (const vid of b.queue) {
      const v = g.visitor(vid);
      if (v) {
        v.state = 'walking';
        v.targetId = null;
        v.mood -= 10;
      }
    }
    b.queue = [];
    if (!g.staff.some((s) => s.kind === 'repairman')) {
      g.warnOnce('repair', 'Сломался аттракцион. Наймите ремонтника');
    } else {
      g.toast('аттракцион сломан, необходим ремонт');
    }
  }
}

function finishUse(g: Game, b: Building, vid: number): void {
  const v = g.visitor(vid);
  if (!v) return;
  const def = DEFS[b.key];
  const need = serveNeed(def);
  const fair = fairPrice(def);
  const delta = Math.max(-25, Math.min(20, (fair - b.price) * 1.3));

  if (need === 'fun') {
    v.needs.fun = Math.max(0, v.needs.fun - 55 - (def.rating ?? 20) * 0.4);
    v.needs.energy = Math.max(0, v.needs.energy - 5 * (def.intensity ?? 1));
    v.needs.hunger = Math.min(100, v.needs.hunger + 4);
    v.mood = clamp(v.mood + 6 + (def.rating ?? 20) * 0.12 + delta);
    g.stats.ridesTaken++;
  } else if (need === 'energy') {
    v.needs.energy = Math.min(100, v.needs.energy + (def.servePower ?? 70));
    v.mood = clamp(v.mood + 5);
  } else if (need) {
    v.needs[need] = Math.max(0, v.needs[need] - (def.servePower ?? 60));
    v.mood = clamp(v.mood + 4 + delta);
  }

  // Выходим на дорогу у выхода объекта (у аттракционов он отдельный).
  const road = exitRoad(g.map, def, b.x, b.y, b.rot);
  if (road) {
    v.x = road.x + 0.5;
    v.y = road.y + 0.5;
  }
  v.state = 'walking';
  v.targetId = null;
  v.seeking = null;
  v.path = [];
  v.think = 0;
  v.busyAt = null;
  v.busySeat = false;
}

export function clamp(v: number, lo = 0, hi = 100): number {
  return v < lo ? lo : v > hi ? hi : v;
}
