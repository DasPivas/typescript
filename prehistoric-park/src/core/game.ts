import { DEFS, PATROL_STAFF, STAFF } from './catalog';
import {
  canPlace,
  canPlaceRoad,
  doorCell,
  doorRoad,
  exitRoad,
  ENTRY,
  MAP_H,
  MAP_W,
  ParkMap,
  recalcFields,
  stamp,
  unstamp,
} from './grid';
import { tracePath, walkField } from './path';
import { mulberry32 } from './rng';
import type {
  Building,
  BuildingDef,
  LevelDef,
  NeedKey,
  RoadKind,
  Rot,
  Staff,
  StaffKind,
  Stats,
  Visitor,
  VisitorState,
} from './types';

/** Секунд игрового времени в сутках. Полный цикл луны — месяц. */
export const DAY = 36;
export const MONTH_DAYS = 5;
export const MONTH = DAY * MONTH_DAYS;

const NEED_RATE: Record<NeedKey, number> = {
  hunger: 0.85,
  thirst: 1.05,
  bladder: 0.7,
  energy: -0.55,
  health: 0.05,
  fun: 1.25,
};

export interface Toast {
  text: string;
  life: number;
}

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

export class Game {
  level: LevelDef;
  map: ParkMap;
  buildings: Building[] = [];
  visitors: Visitor[] = [];
  staff: Staff[] = [];
  money: number;
  time = 0;
  month = 0;
  speed = 1;
  paused = false;
  status: 'playing' | 'won' | 'lost' = 'playing';
  rating = 20;
  avgMood = 60;
  toasts: Toast[] = [];
  stats: Stats = {
    income: 0,
    expense: 0,
    visitorsServed: 0,
    visitorsLeftAngry: 0,
    ridesTaken: 0,
  };

  /** Звуковые события наружу — ядро само ничего не проигрывает. */
  onEvent: ((e: string) => void) | null = null;

  private nextId = 1;
  private spawnAcc = 0;
  private ratingAcc = 0;
  private brokeMonths = 0;
  private rnd: () => number;
  private warned = new Set<string>();

  constructor(level: LevelDef) {
    this.level = level;
    this.map = new ParkMap(level.seed, level.water, level.rocks);
    this.money = level.money;
    this.rnd = mulberry32(level.seed ^ 0x9e37);
  }

  // ───────────────────────── строительство ─────────────────────────

  get unlocked(): string[] {
    return this.level.unlocked;
  }

  isUnlocked(key: string): boolean {
    return this.level.unlocked.includes(key);
  }

  buildingAt(x: number, y: number): Building | null {
    const id = this.map.buildingIdAt(x, y);
    if (id < 0) return null;
    return this.buildings.find((b) => b.id === id) ?? null;
  }

  private emit(e: string): void {
    this.onEvent?.(e);
  }

  toast(text: string): void {
    if (this.toasts.some((t) => t.text === text)) return;
    this.toasts.push({ text, life: 3.2 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  /** Однократное предупреждение за месяц — чтобы не спамить. */
  private warnOnce(key: string, text: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.toast(text);
  }

  build(key: string, x: number, y: number, rot: Rot): boolean {
    const def = DEFS[key];
    if (!def) return false;
    if (def.cat === 'road') return this.buildRoad(key === 'road_stone' ? 2 : 1, x, y);
    if (this.money < def.cost) {
      this.toast('не хватает денег');
      this.emit('error');
      return false;
    }
    const check = canPlace(this.map, def, x, y, rot);
    if (!check.ok) {
      this.toast(check.reason ?? 'сюда нельзя');
      this.emit('error');
      return false;
    }
    const b: Building = {
      id: this.nextId++,
      key,
      x,
      y,
      rot,
      price: def.basePrice ?? 0,
      condition: 100,
      broken: false,
      queue: [],
      riders: [],
      staffId: null,
      revenue: 0,
      uses: 0,
      cooldown: 0,
    };
    this.buildings.push(b);
    stamp(this.map, b);
    this.money -= def.cost;
    this.stats.expense += def.cost;
    recalcFields(this.map, this.buildings);
    this.emit('build');
    return true;
  }

  buildRoad(kind: RoadKind, x: number, y: number): boolean {
    if (kind === 0) return false;
    const def = kind === 2 ? DEFS.road_stone : DEFS.road_dirt;
    if (this.map.roadAt(x, y) === kind) return false;
    const check = canPlaceRoad(this.map, x, y);
    if (!check.ok) {
      this.toast(check.reason ?? 'сюда нельзя');
      return false;
    }
    if (this.money < def.cost) {
      this.toast('не хватает денег');
      return false;
    }
    this.map.road[this.map.idx(x, y)] = kind;
    this.money -= def.cost;
    this.stats.expense += def.cost;
    recalcFields(this.map, this.buildings);
    this.dropQueueSlots();
    this.emit('build');
    return true;
  }

  /** Дороги изменились — маршрут очереди надо пересчитать. */
  private dropQueueSlots(): void {
    for (const b of this.buildings) b.slots = undefined;
  }

  /** Снос: половина стоимости возвращается. */
  removeAt(x: number, y: number): boolean {
    const b = this.buildingAt(x, y);
    if (b) {
      const def = DEFS[b.key];
      if (b.queue.length || b.riders.length) {
        this.toast('на объекте пока есть люди');
        return false;
      }
      if (b.staffId !== null) this.fire(b.staffId);
      unstamp(this.map, b);
      this.buildings = this.buildings.filter((o) => o.id !== b.id);
      this.money += Math.floor(def.cost / 2);
      recalcFields(this.map, this.buildings);
      return true;
    }
    if (this.map.roadAt(x, y) > 0) {
      if (x === ENTRY.x && y >= MAP_H - 2) {
        this.toast('нельзя удалять дорогу у входа в парк');
        return false;
      }
      const kind = this.map.roadAt(x, y);
      this.map.road[this.map.idx(x, y)] = 0;
      this.dropQueueSlots();
      this.money += Math.floor((kind === 2 ? DEFS.road_stone.cost : DEFS.road_dirt.cost) / 2);
      recalcFields(this.map, this.buildings);
      return true;
    }
    return false;
  }

  setPrice(id: number, price: number): void {
    const b = this.buildings.find((o) => o.id === id);
    if (b) b.price = Math.max(0, Math.round(price));
  }

  // ───────────────────────── работники ─────────────────────────

  hireFor(buildingId: number): boolean {
    const b = this.buildings.find((o) => o.id === buildingId);
    if (!b) return false;
    const def = DEFS[b.key];
    if (!def.needsStaff || b.staffId !== null) return false;
    const sd = STAFF[def.needsStaff];
    if (this.money < sd.hireCost) {
      this.toast('не хватает денег');
      return false;
    }
    this.money -= sd.hireCost;
    this.stats.expense += sd.hireCost;
    const s: Staff = {
      id: this.nextId++,
      kind: def.needsStaff,
      x: b.x + 0.5,
      y: b.y + 0.5,
      path: [],
      buildingId: b.id,
      taskId: null,
      think: 0,
      busy: 0,
    };
    this.staff.push(s);
    b.staffId = s.id;
    return true;
  }

  hirePatrol(kind: StaffKind): boolean {
    if (!PATROL_STAFF.includes(kind)) return false;
    const sd = STAFF[kind];
    if (this.money < sd.hireCost) {
      this.toast('не хватает денег');
      return false;
    }
    this.money -= sd.hireCost;
    this.stats.expense += sd.hireCost;
    this.staff.push({
      id: this.nextId++,
      kind,
      x: ENTRY.x + 0.5,
      y: MAP_H - 1.5,
      path: [],
      buildingId: null,
      taskId: null,
      think: 0,
      busy: 0,
    });
    return true;
  }

  fire(staffId: number): void {
    const s = this.staff.find((o) => o.id === staffId);
    if (!s) return;
    if (s.buildingId !== null) {
      const b = this.buildings.find((o) => o.id === s.buildingId);
      if (b) b.staffId = null;
    }
    this.staff = this.staff.filter((o) => o.id !== staffId);
  }

  get monthlyCosts(): number {
    let sum = 0;
    for (const s of this.staff) sum += STAFF[s.kind].salary;
    for (const b of this.buildings) sum += DEFS[b.key].upkeep;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (this.map.road[i] === 2) sum += 1;
    return sum;
  }

  // ───────────────────────── цикл ─────────────────────────

  update(dtReal: number): void {
    if (this.paused || this.status !== 'playing') return;
    const dt = Math.min(dtReal, 0.1) * this.speed;
    const prevMonth = Math.floor(this.time / MONTH);
    this.time += dt;
    const nowMonth = Math.floor(this.time / MONTH);

    this.updateBuildings(dt);
    this.updateVisitors(dt);
    this.updateStaff(dt);
    this.spawn(dt);

    for (const t of this.toasts) t.life -= dtReal;
    this.toasts = this.toasts.filter((t) => t.life > 0);

    this.ratingAcc += dt;
    if (this.ratingAcc > 1) {
      this.ratingAcc = 0;
      this.recalcRating();
      this.checkGoals();
    }

    if (nowMonth !== prevMonth) this.endMonth(nowMonth);
  }

  private endMonth(nowMonth: number): void {
    this.month = nowMonth;
    this.warned.clear();
    const costs = this.monthlyCosts;
    this.money -= costs;
    this.stats.expense += costs;
    this.toast(`день зарплаты: −${costs}`);
    if (this.money < 0) {
      this.brokeMonths++;
      if (this.brokeMonths >= 3) {
        this.status = 'lost';
        this.toast('вы проиграли!');
        this.emit('lose');
        return;
      }
      this.toast('баланс очень низок. восстановите его за 3 месяца');
    } else {
      this.brokeMonths = 0;
    }
    const limit = this.level.goals.months ?? 0;
    if (limit && this.month >= limit && this.status === 'playing') {
      this.status = 'lost';
      this.toast('время вышло');
      this.emit('lose');
    }
  }

  private recalcRating(): void {
    const n = this.visitors.length;
    let mood = 0;
    for (const v of this.visitors) mood += v.mood;
    this.avgMood = n ? mood / n : 60;

    const rides = this.buildings.filter((b) => DEFS[b.key].cat === 'ride');
    const variety = new Set(rides.map((b) => b.key)).size;
    const services = this.buildings.filter((b) => DEFS[b.key].cat === 'service').length;

    let r = this.avgMood * 0.5;
    r += Math.min(rides.length, 14) * 1.8;
    r += variety * 2.2;
    r += Math.min(services, 10) * 0.9;
    const broken = rides.filter((b) => b.broken).length;
    r -= broken * 5;
    this.rating = Math.max(0, Math.min(100, r));
  }

  private checkGoals(): void {
    const g = this.level.goals;
    if (!g.money && !g.rating && !g.visitorsServed && !g.rides) return;
    const rides = this.buildings.filter((b) => DEFS[b.key].cat === 'ride').length;
    const ok =
      (!g.money || this.money >= g.money) &&
      (!g.rating || this.rating >= g.rating) &&
      (!g.visitorsServed || this.stats.visitorsServed >= g.visitorsServed) &&
      (!g.rides || rides >= g.rides);
    if (ok) {
      this.status = 'won';
      this.toast('поздравляем!');
      this.emit('win');
    }
  }

  // ───────────────────────── постройки ─────────────────────────

  private staffed(b: Building): boolean {
    const def = DEFS[b.key];
    return !def.needsStaff || b.staffId !== null;
  }

  /** Работает ли объект прямо сейчас. */
  isOperating(b: Building): boolean {
    return !b.broken && this.staffed(b);
  }

  private updateBuildings(dt: number): void {
    for (const b of this.buildings) {
      const def = DEFS[b.key];
      if (!def.capacity) continue;

      for (const r of b.riders) r.left -= dt;
      const done = b.riders.filter((r) => r.left <= 0);
      if (done.length) {
        b.riders = b.riders.filter((r) => r.left > 0);
        for (const r of done) this.finishUse(b, r.vid);
      }

      if (!this.isOperating(b)) continue;
      let moved = false;
      while (b.riders.length < (def.capacity ?? 1) && b.queue.length) {
        const vid = b.queue.shift()!;
        const v = this.visitors.find((o) => o.id === vid);
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
        this.money += b.price;
        this.stats.income += b.price;
        b.revenue += b.price;
        b.uses++;
        this.emit(b.price > 0 ? 'coin' : 'click');
        if (def.cat === 'ride') this.emit('ride');
        v.state = 'busy';
        v.busyLeft = def.duration ?? 5;
        b.riders.push({ vid: v.id, left: v.busyLeft });
        this.wear(b);
        moved = true;
      }
      if (moved) this.repositionQueue(b);
    }
  }

  private wear(b: Building): void {
    const def = DEFS[b.key];
    if (def.cat !== 'ride') return;
    b.condition -= 0.35 + this.rnd() * 0.25;
    if (b.condition < 45 && this.rnd() < (45 - b.condition) / 45 / 22) {
      b.broken = true;
      b.condition = Math.max(5, b.condition);
      this.emit('break');
      for (const vid of b.queue) {
        const v = this.visitors.find((o) => o.id === vid);
        if (v) {
          v.state = 'walking';
          v.targetId = null;
          v.mood -= 10;
        }
      }
      b.queue = [];
      if (!this.staff.some((s) => s.kind === 'repairman')) {
        this.warnOnce('repair', 'Сломался аттракцион. Наймите ремонтника');
      } else {
        this.toast('аттракцион сломан, необходим ремонт');
      }
    }
  }

  private finishUse(b: Building, vid: number): void {
    const v = this.visitors.find((o) => o.id === vid);
    if (!v) return;
    const def = DEFS[b.key];
    const need = serveNeed(def);
    const fair = fairPrice(def);
    const delta = Math.max(-25, Math.min(20, (fair - b.price) * 1.3));

    if (need === 'fun') {
      v.needs.fun = Math.max(0, v.needs.fun - 55 - (def.rating ?? 20) * 0.4);
      v.needs.energy = Math.max(0, v.needs.energy - 6);
      v.needs.hunger = Math.min(100, v.needs.hunger + 4);
      v.mood = clamp(v.mood + 6 + (def.rating ?? 20) * 0.12 + delta);
      this.stats.ridesTaken++;
    } else if (need === 'energy') {
      v.needs.energy = Math.min(100, v.needs.energy + (def.servePower ?? 70));
      v.mood = clamp(v.mood + 5);
    } else if (need) {
      v.needs[need] = Math.max(0, v.needs[need] - (def.servePower ?? 60));
      v.mood = clamp(v.mood + 4 + delta);
    }

    // Выходим на дорогу у выхода объекта (у аттракционов он отдельный).
    const road = exitRoad(this.map, def, b.x, b.y, b.rot);
    if (road) {
      v.x = road.x + 0.5;
      v.y = road.y + 0.5;
    }
    v.state = 'walking';
    v.targetId = null;
    v.seeking = null;
    v.path = [];
    v.think = 0;
  }

  // ───────────────────────── посетители ─────────────────────────

  private spawn(dt: number): void {
    const rides = this.buildings.filter(
      (b) => DEFS[b.key].cat === 'ride' && this.isOperating(b),
    ).length;
    if (rides === 0) return;
    const desired = Math.min(140, (this.rating / 100) * (8 + rides * 6));
    if (this.visitors.length >= desired) return;
    this.spawnAcc += dt;
    const interval = 1.4;
    while (this.spawnAcc >= interval && this.visitors.length < desired) {
      this.spawnAcc -= interval;
      this.addVisitor();
    }
  }

  private addVisitor(): void {
    const v: Visitor = {
      id: this.nextId++,
      x: ENTRY.x + 0.5,
      y: MAP_H - 0.5,
      state: 'walking',
      path: [],
      targetId: null,
      seeking: null,
      needs: {
        hunger: this.rnd() * 25,
        thirst: this.rnd() * 30,
        bladder: this.rnd() * 20,
        energy: 70 + this.rnd() * 30,
        health: 0,
        fun: 45 + this.rnd() * 45,
      },
      mood: 62 + this.rnd() * 18,
      wallet: 70 + Math.floor(this.rnd() * 180),
      spent: 0,
      waited: 0,
      busyLeft: 0,
      tint: Math.floor(this.rnd() * 6),
      age: 0,
      think: 0,
      wish: 'happy',
    };
    this.visitors.push(v);
  }

  private updateVisitors(dt: number): void {
    const leaving: number[] = [];
    for (const v of this.visitors) {
      v.age += dt;
      for (const k of Object.keys(NEED_RATE) as NeedKey[]) {
        v.needs[k] = clamp(v.needs[k] + NEED_RATE[k] * dt);
      }
      if (this.rnd() < 0.00004) v.needs.health = 100;

      const comfort = this.comfortOf(v);
      v.mood += (comfort - v.mood) * Math.min(1, dt * 0.22);
      v.mood = clamp(v.mood);

      switch (v.state) {
        case 'busy':
          v.busyLeft -= dt;
          break;
        case 'queue':
          v.waited += dt;
          if (v.waited > 55) {
            // «Устал стоять в очередях» — уходим искать другое занятие.
            this.leaveQueue(v);
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
          this.stepWalk(v, dt);
          break;
      }

      if (v.state === 'walking') {
        v.think -= dt;
        if (v.think <= 0 && v.path.length === 0) this.think(v);
      }

      // Драка от отчаяния.
      if (v.state === 'walking' && v.mood < 12 && this.rnd() < 0.0009) {
        v.state = 'fighting';
        v.busyLeft = 14;
        for (const o of this.visitors) {
          if (o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 4) o.mood -= 7;
        }
        if (!this.staff.some((s) => s.kind === 'guard')) {
          this.warnOnce('fight', 'В парке драка. Наймите охранника');
        }
      }

      const outOfMoney = v.wallet < 3;
      const done = v.age > 420 || (v.mood < 18 && v.state === 'walking') || outOfMoney;
      if (done && v.state !== 'leaving' && v.state !== 'busy' && v.state !== 'queue') {
        v.state = 'leaving';
        v.targetId = null;
        v.wish = 'leave';
        v.path = this.pathTo(v, ENTRY.x, MAP_H - 1);
      }
      if (v.state === 'leaving' && v.path.length === 0 && v.y > MAP_H - 2) {
        leaving.push(v.id);
        if (v.mood >= 50) this.stats.visitorsServed++;
        else this.stats.visitorsLeftAngry++;
      }
    }
    if (leaving.length) {
      const set = new Set(leaving);
      this.visitors = this.visitors.filter((v) => !set.has(v.id));
    }
  }

  private comfortOf(v: Visitor): number {
    let c = 100;
    c -= Math.max(0, v.needs.hunger - 55) * 0.6;
    c -= Math.max(0, v.needs.thirst - 50) * 0.65;
    c -= Math.max(0, v.needs.bladder - 65) * 0.7;
    c -= Math.max(0, 35 - v.needs.energy) * 0.8;
    c -= v.needs.health * 0.35;
    c -= Math.max(0, v.needs.fun - 70) * 0.25;
    const cx = Math.floor(v.x);
    const cy = Math.floor(v.y);
    if (this.map.inside(cx, cy)) c += Math.min(18, this.map.scenery[this.map.idx(cx, cy)] * 1.4);
    return Math.max(0, Math.min(100, c));
  }

  /** Самая срочная потребность. */
  private urgentNeed(v: Visitor): NeedKey {
    if (v.needs.health > 50) return 'health';
    if (v.needs.bladder > 72) return 'bladder';
    if (v.needs.thirst > 68) return 'thirst';
    if (v.needs.hunger > 70) return 'hunger';
    if (v.needs.energy < 28) return 'energy';
    return 'fun';
  }

  private think(v: Visitor): void {
    v.think = 1.2 + this.rnd();
    const need = this.urgentNeed(v);
    v.seeking = need;

    const from = this.roadCellNear(v.x, v.y);
    if (!from) {
      // Сошли с дороги — вернёмся ко входу.
      v.path = [];
      v.x = ENTRY.x + 0.5;
      v.y = MAP_H - 1.5;
      return;
    }
    const field = walkField(this.map, from.x, from.y);

    let best: { b: Building; cell: { x: number; y: number }; d: number } | null = null;
    for (const b of this.buildings) {
      const def = DEFS[b.key];
      if (serveNeed(def) !== need) continue;
      if (!this.isOperating(b)) continue;
      if (b.price > v.wallet) continue;
      if (b.queue.length > (def.capacity ?? 1) * 4) continue;
      const road = doorRoad(this.map, def, b.x, b.y, b.rot);
      if (!road) continue;
      const d = field.dist[this.map.idx(road.x, road.y)];
      if (d < 0) continue;
      // Аттракционы: чем выше рейтинг, тем охотнее идём даже подальше.
      const score = need === 'fun' ? d - (def.rating ?? 0) * 0.25 : d;
      if (!best || score < best.d) best = { b, cell: road, d: score };
    }

    if (!best) {
      v.wish = need === 'fun' ? 'sad' : need;
      v.mood -= 0.6;
      // Побродим.
      const spots = this.randomRoad(field);
      if (spots) v.path = tracePath(field, spots.x, spots.y);
      return;
    }

    v.wish = v.mood > 55 ? 'happy' : need;
    v.targetId = best.b.id;
    v.path = tracePath(field, best.cell.x, best.cell.y);
    if (v.path.length === 0) {
      // Уже стоим у входа.
      this.enterQueue(v, best.b);
    }
  }

  private randomRoad(field: { dist: Int32Array }): { x: number; y: number } | null {
    const cands: number[] = [];
    for (let i = 0; i < field.dist.length; i++) {
      if (field.dist[i] > 2 && field.dist[i] < 25) cands.push(i);
    }
    if (!cands.length) return null;
    const i = cands[Math.floor(this.rnd() * cands.length)];
    return { x: i % MAP_W, y: (i / MAP_W) | 0 };
  }

  private roadCellNear(px: number, py: number): { x: number; y: number } | null {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (this.map.roadAt(x, y) > 0) return { x, y };
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      if (this.map.roadAt(x + dx, y + dy) > 0) return { x: x + dx, y: y + dy };
    }
    return null;
  }

  private pathTo(v: Visitor, tx: number, ty: number): { x: number; y: number }[] {
    const from = this.roadCellNear(v.x, v.y);
    if (!from) return [];
    const field = walkField(this.map, from.x, from.y);
    return tracePath(field, tx, ty);
  }

  private enterQueue(v: Visitor, b: Building): void {
    v.state = 'queue';
    v.waited = 0;
    b.queue.push(v.id);
    this.placeInQueue(v, b, b.queue.length - 1);
  }

  /**
   * Клетки, по которым тянется очередь: от дороги у входа и дальше вдоль дороги,
   * прочь от постройки. Считается один раз и живёт до перестройки дорог.
   */
  private queueSlots(b: Building): { x: number; y: number }[] {
    if (b.slots) return b.slots;
    const def = DEFS[b.key];
    const road = doorRoad(this.map, def, b.x, b.y, b.rot);
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
        (c) =>
          this.map.roadAt(c.x, c.y) > 0 && !slots.some((s) => s.x === c.x && s.y === c.y),
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
  private placeInQueue(v: Visitor, b: Building, index: number): void {
    const slots = this.queueSlots(b);
    if (!slots.length) return;
    const cell = slots[Math.min(Math.floor(index / 2), slots.length - 1)];
    const side = index % 2 === 0 ? -0.22 : 0.22;
    const depth = Math.max(0, Math.floor(index / 2) - (slots.length - 1)) * 0.18;
    v.x = cell.x + 0.5 + side;
    v.y = cell.y + 0.5 + depth;
  }

  /** Очередь сдвинулась — подтягиваем всех вперёд. */
  private repositionQueue(b: Building): void {
    for (let i = 0; i < b.queue.length; i++) {
      const v = this.visitors.find((o) => o.id === b.queue[i]);
      if (v && v.state === 'queue') this.placeInQueue(v, b, i);
    }
  }

  /** Выдернуть гостя из очереди, где бы он ни стоял. */
  private leaveQueue(v: Visitor): void {
    for (const b of this.buildings) {
      const i = b.queue.indexOf(v.id);
      if (i >= 0) {
        b.queue.splice(i, 1);
        this.repositionQueue(b);
        break;
      }
    }
    v.state = 'walking';
    v.targetId = null;
    v.waited = 0;
    v.think = 0;
  }

  private stepWalk(v: Visitor, dt: number): void {
    if (v.path.length === 0) {
      if (v.targetId !== null && v.state === 'walking') {
        const b = this.buildings.find((o) => o.id === v.targetId);
        if (b && this.isOperating(b)) this.enterQueue(v, b);
        else v.targetId = null;
      }
      return;
    }
    const next = v.path[0];
    const kind = this.map.roadAt(next.x, next.y);
    const speed = kind === 2 ? 2.9 : 2.3;
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

  // ───────────────────────── работники ─────────────────────────

  private updateStaff(dt: number): void {
    for (const s of this.staff) {
      if (s.busy > 0) {
        s.busy -= dt;
        if (s.busy <= 0) this.finishStaffTask(s);
        continue;
      }
      if (s.buildingId !== null) continue; // сервисный работник стоит на месте
      this.stepStaff(s, dt);
      if (s.path.length === 0) {
        s.think -= dt;
        if (s.think <= 0) this.thinkStaff(s);
      }
    }
  }

  private finishStaffTask(s: Staff): void {
    if (s.kind === 'repairman' && s.taskId !== null) {
      const b = this.buildings.find((o) => o.id === s.taskId);
      if (b) {
        b.broken = false;
        b.condition = 100;
      }
    }
    if (s.kind === 'guard' && s.taskId !== null) {
      const v = this.visitors.find((o) => o.id === s.taskId);
      if (v && v.state === 'fighting') {
        v.state = 'walking';
        v.busyLeft = 0;
        v.mood = clamp(v.mood + 20);
      }
    }
    s.taskId = null;
  }

  private thinkStaff(s: Staff): void {
    s.think = 1.5;
    const from = this.roadCellNear(s.x, s.y);
    if (!from) return;
    const field = walkField(this.map, from.x, from.y);

    if (s.kind === 'repairman') {
      const broken = this.buildings.filter((b) => b.broken);
      let best: { cell: { x: number; y: number }; id: number; d: number } | null = null;
      for (const b of broken) {
        const road = doorRoad(this.map, DEFS[b.key], b.x, b.y, b.rot);
        if (!road) continue;
        const d = field.dist[this.map.idx(road.x, road.y)];
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
      const worn = this.buildings
        .filter((b) => DEFS[b.key].cat === 'ride' && b.condition < 70)
        .sort((a, b) => a.condition - b.condition)[0];
      if (worn) {
        const road = doorRoad(this.map, DEFS[worn.key], worn.x, worn.y, worn.rot);
        if (road) {
          s.taskId = worn.id;
          s.path = tracePath(field, road.x, road.y);
          if (s.path.length === 0) s.busy = 4;
          return;
        }
      }
    }

    if (s.kind === 'guard') {
      const fight = this.visitors.find((v) => v.state === 'fighting');
      if (fight) {
        const cell = this.roadCellNear(fight.x, fight.y);
        if (cell) {
          s.taskId = fight.id;
          s.path = tracePath(field, cell.x, cell.y);
          if (s.path.length === 0) s.busy = 2;
          return;
        }
      }
    }

    const spot = this.randomRoad(field);
    if (spot) s.path = tracePath(field, spot.x, spot.y);
  }

  private stepStaff(s: Staff, dt: number): void {
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
    const step = 2.6 * dt;
    if (d <= step) {
      s.x = tx;
      s.y = ty;
      s.path.shift();
    } else {
      s.x += (dx / d) * step;
      s.y += (dy / d) * step;
    }
  }

  /** После загрузки сохранения: восстановить индексы карты и поля. */
  restoreAfterLoad(): void {
    this.visitors = [];
    this.map.occ.fill(-1);
    let maxId = 0;
    for (const b of this.buildings) {
      b.queue = [];
      b.riders = [];
      stamp(this.map, b);
      maxId = Math.max(maxId, b.id);
    }
    for (const s of this.staff) {
      s.path = [];
      s.busy = 0;
      s.taskId = null;
      maxId = Math.max(maxId, s.id);
    }
    this.nextId = maxId + 1;
    recalcFields(this.map, this.buildings);
    this.recalcRating();
  }

  // ───────────────────────── справка для UI ─────────────────────────

  /** Фаза луны 0..1 — полный цикл равен месяцу. */
  get moonPhase(): number {
    return (this.time % MONTH) / MONTH;
  }

  get day(): number {
    return Math.floor(this.time / DAY) + 1;
  }
}

function clamp(v: number, lo = 0, hi = 100): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type { VisitorState };
