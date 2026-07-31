import { DEFS, PATROL_STAFF, STAFF } from './catalog';
import { isOperating, updateBuildings } from './buildings';
import {
  canPlace,
  canPlaceRoad,
  ENTRY,
  MAP_H,
  MAP_W,
  ParkMap,
  recalcFields,
  stamp,
  unstamp,
} from './grid';
import { mulberry32 } from './rng';
import { updateStaff } from './staffAI';
import { spawn, updateVisitors } from './visitors';
import { effectOf, rollWeather, seasonOf, type WeatherEffect } from './weather';
import type {
  Building,
  LevelDef,
  RoadKind,
  Rot,
  Season,
  Staff,
  StaffKind,
  Stats,
  Visitor,
  Weather,
} from './types';

/** Секунд игрового времени в сутках. Полный цикл луны — месяц. */
export const DAY = 36;
export const MONTH_DAYS = 5;
export const MONTH = DAY * MONTH_DAYS;

export { fairPrice, isOperating, serveNeed } from './buildings';

export interface Toast {
  text: string;
  life: number;
}

/**
 * Оркестратор: держит состояние парка и по очереди дёргает системы
 * (постройки → гости → работники → приток). Сама логика живёт в соседних модулях.
 */
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
    peakVisitors: 0,
    fights: 0,
    breakdowns: 0,
  };

  /** Что уже изобретено на этом уровне сверх стартового набора. */
  invented: string[] = [];
  season: Season = 'spring';
  weather: Weather = 'clear';
  effect: WeatherEffect;
  /** Сколько звёзд заработано, когда уровень пройден. */
  stars = 0;

  /** Звуковые события наружу — ядро само ничего не проигрывает. */
  onEvent: ((e: string) => void) | null = null;
  /** Изобретение нового аттракциона — чтобы интерфейс показал окно. */
  onInvent: ((key: string) => void) | null = null;

  rnd: () => number;
  spawnAcc = 0;

  private nextId = 1;
  private ratingAcc = 0;
  private weatherAcc = 0;
  private brokeMonths = 0;
  private warned = new Set<string>();
  private buildingsById = new Map<number, Building>();
  private visitorsById = new Map<number, Visitor>();

  constructor(level: LevelDef) {
    this.level = level;
    this.map = new ParkMap(level.seed, level.water, level.rocks);
    this.money = level.money;
    this.rnd = mulberry32(level.seed ^ 0x9e37);
    this.season = seasonOf(0);
    this.effect = effectOf(this.weather, this.season);
  }

  // ───────────────────────── индексы ─────────────────────────

  takeId(): number {
    return this.nextId++;
  }

  building(id: number): Building | undefined {
    return this.buildingsById.get(id);
  }

  visitor(id: number): Visitor | undefined {
    return this.visitorsById.get(id);
  }

  indexVisitor(v: Visitor): void {
    this.visitorsById.set(v.id, v);
  }

  dropVisitor(id: number): void {
    this.visitorsById.delete(id);
  }

  // ───────────────────────── строительство ─────────────────────────

  isUnlocked(key: string): boolean {
    return this.level.unlocked.includes(key) || this.invented.includes(key);
  }

  buildingAt(x: number, y: number): Building | null {
    const id = this.map.buildingIdAt(x, y);
    if (id < 0) return null;
    return this.buildingsById.get(id) ?? null;
  }

  emit(e: string): void {
    this.onEvent?.(e);
  }

  toast(text: string): void {
    if (this.toasts.some((t) => t.text === text)) return;
    this.toasts.push({ text, life: 3.2 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  /** Однократное предупреждение за месяц — чтобы не спамить. */
  warnOnce(key: string, text: string): void {
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
      id: this.takeId(),
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
    this.buildingsById.set(b.id, b);
    stamp(this.map, b);
    this.money -= def.cost;
    this.stats.expense += def.cost;
    recalcFields(this.map, this.buildings);
    this.dropQueueSlots();
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
      this.emit('error');
      return false;
    }
    if (this.money < def.cost) {
      this.toast('не хватает денег');
      this.emit('error');
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
      this.buildingsById.delete(b.id);
      this.money += Math.floor(def.cost / 2);
      recalcFields(this.map, this.buildings);
      this.dropQueueSlots();
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
    const b = this.building(id);
    if (b) b.price = Math.max(0, Math.round(price));
  }

  // ───────────────────────── работники ─────────────────────────

  hireFor(buildingId: number): boolean {
    const b = this.building(buildingId);
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
      id: this.takeId(),
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
      id: this.takeId(),
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
      const b = this.building(s.buildingId);
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
    this.month = nowMonth;

    this.weatherAcc += dt;
    if (this.weatherAcc > DAY * 1.5) {
      this.weatherAcc = 0;
      this.setWeather(rollWeather(this.season, this.rnd));
    }

    updateBuildings(this, dt);
    updateVisitors(this, dt);
    updateStaff(this, dt);
    spawn(this, dt);

    for (const t of this.toasts) t.life -= dtReal;
    this.toasts = this.toasts.filter((t) => t.life > 0);

    this.ratingAcc += dt;
    if (this.ratingAcc > 1) {
      this.ratingAcc = 0;
      this.recalcRating();
      this.checkInventions();
      this.checkGoals();
    }

    if (nowMonth !== prevMonth) this.endMonth(nowMonth);
  }

  setWeather(w: Weather): void {
    if (w === this.weather) return;
    this.weather = w;
    this.effect = effectOf(this.weather, this.season);
    this.toast(`погода: ${w === 'rain' ? 'дождь' : w === 'heat' ? 'жара' : w === 'cold' ? 'холод' : 'ясно'}`);
  }

  private endMonth(nowMonth: number): void {
    this.month = nowMonth;
    this.season = seasonOf(this.month);
    this.effect = effectOf(this.weather, this.season);
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
    r -= rides.filter((b) => b.broken).length * 5;
    this.rating = Math.max(0, Math.min(100, r));
  }

  /** «Изобретение!» — новые аттракционы открываются по ходу игры. */
  private checkInventions(): void {
    const queue = this.level.inventions ?? [];
    const i = this.invented.length;
    if (i >= queue.length) return;
    const byRides = this.stats.ridesTaken >= 40 + i * 55;
    const byTime = this.month >= i + 2;
    if (!byRides && !byTime) return;
    this.invented.push(queue[i]);
    this.toast('изобретение!');
    this.onInvent?.(queue[i]);
  }

  /** Звёзды: базовая цель — одна, полторы — две, вдвое — три. */
  starsFor(): number {
    const g = this.level.goals;
    if (!g.money && !g.rating) return 1;
    const moneyOk = (m: number) => !g.money || this.money >= g.money * m;
    const ratingOk = (add: number) => !g.rating || this.rating >= Math.min(100, g.rating + add);
    let stars = 1;
    if (moneyOk(1.5) && ratingOk(7)) stars = 2;
    if (moneyOk(2.2) && ratingOk(13)) stars = 3;
    return stars;
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
      this.stars = this.starsFor();
      this.status = 'won';
      this.toast('поздравляем!');
      this.emit('win');
    }
  }

  /** Сколько парк зарабатывает за игровую минуту — для офлайн-дохода. */
  get incomePerMinute(): number {
    if (this.time < 60) return 0;
    return (this.stats.income / this.time) * 60;
  }

  isOperating(b: Building): boolean {
    return isOperating(this, b);
  }

  /** После загрузки сохранения: восстановить индексы карты и поля. */
  restoreAfterLoad(): void {
    this.buildingsById.clear();
    this.visitorsById.clear();
    this.map.occ.fill(-1);
    let maxId = 0;
    for (const b of this.buildings) {
      b.slots = undefined;
      b.queue = [];
      b.riders = [];
      stamp(this.map, b);
      this.buildingsById.set(b.id, b);
      maxId = Math.max(maxId, b.id);
    }
    for (const v of this.visitors) {
      this.visitorsById.set(v.id, v);
      maxId = Math.max(maxId, v.id);
      // Гость, застрявший «внутри» постройки, просто пойдёт дальше.
      if (v.state === 'busy' || v.state === 'queue') {
        v.state = 'walking';
        v.targetId = null;
        v.path = [];
        v.busyAt = null;
        v.busySeat = false;
      }
    }
    for (const s of this.staff) {
      s.path = [];
      s.busy = 0;
      s.taskId = null;
      maxId = Math.max(maxId, s.id);
    }
    this.nextId = maxId + 1;
    this.effect = effectOf(this.weather, this.season);
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
