import { describe, expect, it } from 'vitest';
import { Game, MONTH } from '../core/game';
import { canPlace, doorRoad, ENTRY, exitRoad, MAP_H } from '../core/grid';
import { walkField, tracePath } from '../core/path';
import { DEFS } from '../core/catalog';
import { levelByKey, SANDBOX } from '../core/levels';
import { offlineIncome } from '../core/save';
import { TUTORIAL_STEPS } from '../core/tutorial';
import { effectOf, seasonOf } from '../core/weather';
import type { LevelDef } from '../core/types';

/** Ровная карта без воды и скал — чтобы тесты не зависели от генератора. */
const FLAT: LevelDef = {
  ...SANDBOX,
  key: 'test',
  seed: 1,
  water: 0,
  rocks: 0,
  money: 50000,
  goals: {},
};

function park(level: LevelDef = FLAT): Game {
  const g = new Game(level);
  // Вертикаль от входа и горизонталь-«улица».
  for (let y = MAP_H - 1; y >= MAP_H - 20; y--) g.buildRoad(1, ENTRY.x, y);
  for (let x = ENTRY.x - 8; x <= ENTRY.x + 8; x++) g.buildRoad(1, x, MAP_H - 12);
  return g;
}

/** Прокрутить симуляцию на n секунд шагами по 100 мс. */
function run(g: Game, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) g.update(0.1);
}

describe('размещение построек', () => {
  it('аттракцион требует дорогу и у входа, и у выхода', () => {
    const g = park();
    // Над горизонтальной улицей: обе клетки нижнего ряда касаются дороги.
    expect(g.build('batut', ENTRY.x + 2, MAP_H - 14, 0)).toBe(true);
    // Сбоку от вертикальной дороги дорогу видит только вход.
    expect(g.build('kacheli', ENTRY.x + 1, MAP_H - 18, 0)).toBe(false);
    expect(g.toasts.at(-1)?.text).toBe('не подведена дорога к выходу');
  });

  it('на занятую клетку и на дорогу не ставит', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    expect(canPlace(g.map, DEFS.batut, ENTRY.x + 2, MAP_H - 14, 0).ok).toBe(false);
    expect(canPlace(g.map, DEFS.batut, ENTRY.x, MAP_H - 13, 0).reason).toBe('здесь дорога');
  });

  it('водному аттракциону нужна вода, аттракциону с шестерёнкой — диномотор', () => {
    const g = park();
    expect(canPlace(g.map, DEFS.vyshka, ENTRY.x + 2, MAP_H - 14, 0).reason).toBe('нужна вода рядом');
    expect(canPlace(g.map, DEFS.karusel, ENTRY.x + 2, MAP_H - 15, 0).reason).toBe('нужен диномотор');
    g.build('dinomotor', ENTRY.x + 3, MAP_H - 14, 0);
    expect(canPlace(g.map, DEFS.karusel, ENTRY.x - 3, MAP_H - 15, 0).ok).toBe(true);
  });

  it('вход и выход считаются с учётом поворота', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    const b = g.buildings.at(-1)!;
    const def = DEFS[b.key];
    expect(doorRoad(g.map, def, b.x, b.y, b.rot)).not.toBeNull();
    expect(exitRoad(g.map, def, b.x, b.y, b.rot)).not.toBeNull();
    const rotated = exitRoad(g.map, def, b.x, b.y, 2);
    expect(rotated).toBeNull(); // после разворота выход смотрит в траву
  });
});

describe('дороги и маршруты', () => {
  it('волна доходит по дороге и не проходит по траве', () => {
    const g = park();
    const f = walkField(g.map, ENTRY.x, MAP_H - 1);
    expect(f.dist[g.map.idx(ENTRY.x, MAP_H - 12)]).toBe(11);
    expect(f.dist[g.map.idx(ENTRY.x + 3, MAP_H - 14)]).toBe(-1);
    const path = tracePath(f, ENTRY.x - 4, MAP_H - 12);
    expect(path.at(-1)).toEqual({ x: ENTRY.x - 4, y: MAP_H - 12 });
  });

  it('снос дороги у входа запрещён', () => {
    const g = park();
    expect(g.removeAt(ENTRY.x, MAP_H - 1)).toBe(false);
    expect(g.removeAt(ENTRY.x, MAP_H - 8)).toBe(true);
  });
});

describe('жизнь парка', () => {
  it('гости приходят, катаются и платят', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    g.build('kacheli', ENTRY.x - 4, MAP_H - 14, 0);
    g.build('istochnik', ENTRY.x + 1, MAP_H - 11, 2);
    const before = g.money;
    run(g, 120);
    expect(g.visitors.length).toBeGreaterThan(0);
    expect(g.stats.ridesTaken).toBeGreaterThan(0);
    expect(g.stats.income).toBeGreaterThan(0);
    expect(g.money).toBeGreaterThan(before - DEFS.batut.cost);
    // Все гости стоят на дороге или в постройке, а не посреди травы.
    for (const v of g.visitors) {
      if (v.state === 'busy') continue;
      const near =
        g.map.roadAt(Math.floor(v.x), Math.floor(v.y)) > 0 ||
        g.map.roadAt(Math.round(v.x), Math.round(v.y)) > 0;
      expect(near).toBe(true);
    }
  });

  it('очередь выстраивается вдоль дороги и не копится бесконечно', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    run(g, 200);
    const b = g.buildings[0];
    expect(b.queue.length).toBeLessThanOrEqual((DEFS.batut.capacity ?? 1) * 4 + 2);
    for (const id of b.queue) {
      const v = g.visitor(id)!;
      expect(g.map.roadAt(Math.floor(v.x), Math.floor(v.y))).toBeGreaterThan(0);
    }
  });

  it('в конце месяца списываются зарплаты и обслуживание', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    g.hirePatrol('repairman');
    const costs = g.monthlyCosts;
    expect(costs).toBeGreaterThan(0);
    const before = g.money;
    run(g, MONTH + 1);
    expect(g.stats.expense).toBeGreaterThan(0);
    expect(g.money).toBeLessThan(before + g.stats.income);
  });
});

describe('уровни', () => {
  it('цель выполняется и даёт звёзды', () => {
    const g = new Game({ ...FLAT, key: 'goal', money: 1000, goals: { money: 1500 } });
    g.money = 4000;
    run(g, 2);
    expect(g.status).toBe('won');
    expect(g.stars).toBe(3);
  });

  it('изобретения открываются по ходу игры', () => {
    const level = levelByKey('ravnina');
    const g = new Game({ ...level, water: 0, rocks: 0 });
    expect(g.isUnlocked('tir')).toBe(false);
    g.time = MONTH * 2;
    run(g, 2);
    expect(g.invented[0]).toBe('tir');
    expect(g.isUnlocked('tir')).toBe(true);
  });

  it('обучение проверяет ровно то, что просит', () => {
    const g = park();
    expect(TUTORIAL_STEPS[0].done(g)).toBe(true); // дороги уже проложены
    expect(TUTORIAL_STEPS[1].done(g)).toBe(false);
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    g.build('kacheli', ENTRY.x - 4, MAP_H - 14, 0);
    g.build('vesy', ENTRY.x - 6, MAP_H - 13, 0);
    expect(TUTORIAL_STEPS[1].done(g)).toBe(true);
  });
});

describe('погода и офлайн', () => {
  it('сезон меняется каждые три месяца, дождь снижает приток', () => {
    expect(seasonOf(0)).toBe('spring');
    expect(seasonOf(4)).toBe('summer');
    expect(seasonOf(11)).toBe('winter');
    const clear = effectOf('clear', 'summer').attendance;
    const rain = effectOf('rain', 'summer').attendance;
    expect(rain).toBeLessThan(clear);
    expect(effectOf('heat', 'summer').thirst).toBeGreaterThan(1);
  });

  it('офлайн-доход ограничен восемью часами и требует пары минут', () => {
    const now = Date.now();
    expect(offlineIncome(100, now - 30_000, now).money).toBe(0);
    expect(offlineIncome(100, now - 3_600_000, now).money).toBe(1500);
    const long = offlineIncome(100, now - 24 * 3_600_000, now);
    expect(long.minutes).toBe(480);
  });
});

describe('сохранение', () => {
  it('восстановление после загрузки не ломает карту', () => {
    const g = park();
    g.build('batut', ENTRY.x + 2, MAP_H - 14, 0);
    run(g, 40);
    const clone = new Game(FLAT);
    clone.map.road.set(g.map.road);
    clone.buildings = JSON.parse(JSON.stringify(g.buildings));
    clone.visitors = JSON.parse(JSON.stringify(g.visitors));
    clone.staff = JSON.parse(JSON.stringify(g.staff));
    clone.restoreAfterLoad();
    expect(clone.buildingAt(ENTRY.x + 2, MAP_H - 14)?.key).toBe('batut');
    expect(clone.visitors.every((v) => v.state !== 'busy')).toBe(true);
    run(clone, 20);
    expect(clone.status).toBe('playing');
  });
});
