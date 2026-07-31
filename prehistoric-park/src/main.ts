import { Sprite } from 'pixi.js';
import './style/app.css';
import { ACHIEVEMENTS, achievementDone } from './core/achievements';
import { ALL_DEFS, DEFS } from './core/catalog';
import { Game } from './core/game';
import { canPlace, canPlaceRoad, ENTRY, MAP_H } from './core/grid';
import { levelByKey, SANDBOX } from './core/levels';
import { EMPTY_PROFILE, offlineIncome, store, type Profile, type SaveData } from './core/save';
import { TUTORIAL, TUTORIAL_STEPS } from './core/tutorial';
import type { Rot } from './core/types';
import { sound, type Sfx } from './audio/sound';
import { Controls } from './render/input';
import { Scene } from './render/scene';
import { UI, type AppApi } from './ui/ui';

class App implements AppApi {
  game = new Game(SANDBOX);
  scene = new Scene();
  ui!: UI;
  icons: Record<string, string> = {};
  selectedKey: string | null = null;
  removeMode = false;
  rot: Rot = 0;
  profile: Profile = { ...EMPTY_PROFILE, stars: {}, achievements: [], records: [] };

  private uiAcc = 0;
  private achAcc = 0;
  private lastStatus: 'playing' | 'won' | 'lost' = 'playing';
  private tutorialStep = -1;
  private tutorialHold = 0;
  private saveTimer = 0;

  async start(): Promise<void> {
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    await this.scene.init(canvas);
    this.makeIcons();
    this.profile = await store.loadProfile();

    this.ui = new UI(document.getElementById('ui')!, this);
    new Controls(canvas, this.scene, {
      isPaintMode: () => this.selectedKey !== null && DEFS[this.selectedKey].cat === 'road',
      onTap: (c) => this.tap(c),
      onPaint: (c) => this.paint(c),
      onHover: (c) => this.hover(c),
    });

    // Звук нельзя завести без жеста — ловим первое касание.
    addEventListener('pointerdown', () => sound.unlock(), { capture: true });
    document.getElementById('ui')!.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button') || t.closest('.card')) sound.play('click');
      },
      true,
    );

    this.startLevel('tutorial');
    const boot = () => void this.bootMenu();
    if (sound.asked) boot();
    else this.ui.askSound(boot);

    this.scene.app.ticker.add((t) => this.frame(t.deltaMS / 1000));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save(true);
    });
    this.registerServiceWorker();
  }

  /** При запуске подхватываем последнюю партию, иначе показываем уровни. */
  private async bootMenu(): Promise<void> {
    const saved = await store.loadSave();
    if (saved) {
      this.ui.closeModal();
      this.load(saved);
      return;
    }
    this.ui.openLevels();
  }

  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    const go = () => {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        /* офлайн-режим не критичен */
      });
    };
    // Страница может быть уже загружена — тогда событие load не придёт.
    if (document.readyState === 'complete') go();
    else addEventListener('load', go);
  }

  /** Иконки для меню строительства — берём те же текстуры, что и на карте. */
  private makeIcons(): void {
    for (const def of ALL_DEFS) {
      const frames = this.scene.art.buildings[def.key];
      const src =
        def.key === 'road_dirt'
          ? this.scene.art.roadDirt
          : def.key === 'road_stone'
            ? this.scene.art.roadStone
            : frames?.[0];
      if (!src) continue;
      try {
        const sprite = new Sprite(src);
        const canvas = this.scene.app.renderer.extract.canvas(sprite);
        this.icons[def.key] = (canvas as HTMLCanvasElement).toDataURL();
        sprite.destroy();
      } catch {
        /* иконка не критична */
      }
    }
  }

  // ─────────── уровни и сохранения ───────────

  levelDone(key: string): boolean {
    return (this.profile.stars[key] ?? 0) > 0;
  }

  startLevel(key: string): void {
    this.game = new Game(key === 'sandbox' ? SANDBOX : levelByKey(key));
    this.game.onEvent = (e) => sound.play(e as Sfx);
    this.game.onInvent = (k) => {
      this.ui.openInvention(k);
      this.ui.renderItems();
    };
    this.selectedKey = null;
    this.removeMode = false;
    this.rot = 0;
    this.lastStatus = 'playing';
    this.scene.ghost = null;
    this.scene.showSigns = false;
    this.scene.reset(this.game);
    this.setTutorial(key === TUTORIAL.key ? 0 : -1);
    this.ui?.renderItems();
    this.ui?.renderPicked();
    this.ui?.openIntro();
  }

  private setTutorial(step: number): void {
    this.tutorialStep = step;
    this.tutorialHold = 0;
    this.ui?.setTutorial(
      step >= 0 && step < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[step] : null,
      Math.max(0, step),
      TUTORIAL_STEPS.length,
    );
  }

  hasSave(): boolean {
    return true;
  }

  save(silent = false): void {
    const g = this.game;
    if (g.status !== 'playing') return;
    const data: SaveData = {
      version: 2,
      levelKey: g.level.key,
      money: g.money,
      time: g.time,
      month: g.month,
      roads: Array.from(g.map.road),
      buildings: g.buildings,
      visitors: g.visitors,
      staff: g.staff,
      stats: g.stats,
      invented: g.invented,
      weather: g.weather,
      season: g.season,
      tutorialStep: this.tutorialStep,
      savedAt: Date.now(),
    };
    void store.saveSave(data).then((ok) => {
      if (silent) return;
      g.toast(ok ? 'игра успешно сохранена.' : 'не хватает памяти для сохранения игры.');
    });
  }

  load(preloaded?: SaveData): void {
    const apply = (data: SaveData | null) => {
      if (!data) {
        this.game.toast('сохранений нет');
        return;
      }
      this.startLevel(data.levelKey);
      this.ui.closeModal();
      const g = this.game;
      g.money = data.money;
      g.time = data.time;
      g.month = data.month;
      g.map.road.set(data.roads);
      g.buildings = data.buildings;
      g.visitors = data.visitors ?? [];
      g.staff = data.staff;
      g.invented = data.invented ?? [];
      g.weather = data.weather ?? 'clear';
      g.season = data.season ?? 'spring';
      Object.assign(g.stats, data.stats);
      g.restoreAfterLoad();
      this.scene.reset(g);
      this.setTutorial(data.tutorialStep ?? -1);
      this.ui.renderItems();

      const bonus = offlineIncome(g.incomePerMinute, data.savedAt);
      if (bonus.money > 0) {
        g.money += bonus.money;
        g.stats.income += bonus.money;
        this.ui.openOffline(bonus.minutes, bonus.money);
      }
    };
    if (preloaded) apply(preloaded);
    else void store.loadSave().then(apply);
  }

  // ─────────── ввод ───────────

  selectKey(key: string | null): void {
    this.selectedKey = key;
    this.scene.ghost = null;
    this.scene.showMotor = key !== null && (DEFS[key].needsMotor === true || key === 'dinomotor');
    if (key === null) this.scene.showSigns = false;
  }

  showSigns(on: boolean): void {
    this.scene.showSigns = on;
  }

  setRemoveMode(v: boolean): void {
    this.removeMode = v;
    if (v) {
      this.selectedKey = null;
      this.scene.ghost = null;
    }
  }

  rotate(): void {
    const key = this.selectedKey;
    if (!key) return;
    const def = DEFS[key];
    const allowed: Rot[] = def.w === def.h ? [0, 1, 2, 3] : [0, 2];
    const i = allowed.indexOf(this.rot);
    this.rot = allowed[(i + 1) % allowed.length];
    if (this.scene.ghost) {
      this.scene.ghost.rot = this.rot;
      this.refreshGhost();
    }
  }

  private refreshGhost(): void {
    const gh = this.scene.ghost;
    if (!gh) return;
    gh.ok = canPlace(this.game.map, gh.def, gh.x, gh.y, gh.rot).ok;
  }

  private paint(c: { x: number; y: number }): void {
    const key = this.selectedKey;
    if (!key) return;
    const def = DEFS[key];
    if (def.cat !== 'road') return;
    if (!canPlaceRoad(this.game.map, c.x, c.y).ok) return;
    if (this.game.buildRoad(key === 'road_stone' ? 2 : 1, c.x, c.y)) {
      this.scene.markRoadsDirty();
    }
  }

  private hover(c: { x: number; y: number }): void {
    const key = this.selectedKey;
    if (!key || this.removeMode) return;
    const def = DEFS[key];
    if (def.cat === 'road') {
      this.scene.ghost = {
        def,
        x: c.x,
        y: c.y,
        rot: 0,
        ok: canPlaceRoad(this.game.map, c.x, c.y).ok,
      };
    }
  }

  private tap(c: { x: number; y: number }): void {
    const g = this.game;
    if (this.removeMode) {
      if (g.removeAt(c.x, c.y)) this.scene.markRoadsDirty();
      return;
    }
    const key = this.selectedKey;
    if (key) {
      const def = DEFS[key];
      if (def.cat === 'road') {
        this.paint(c);
        return;
      }
      const gh = this.scene.ghost;
      // Первый тап ставит призрак, второй по той же клетке подтверждает.
      if (gh && gh.def.key === key && gh.x === c.x && gh.y === c.y) {
        if (g.build(key, c.x, c.y, this.rot)) this.scene.ghost = null;
        return;
      }
      this.scene.ghost = { def, x: c.x, y: c.y, rot: this.rot, ok: false };
      this.refreshGhost();
      return;
    }
    const b = g.buildingAt(c.x, c.y);
    if (b) this.ui.openBuilding(b);
  }

  // ─────────── цикл ───────────

  /** Шаг обучения закрывается сам, как только условие выполнено. */
  private stepTutorial(dt: number): void {
    const i = this.tutorialStep;
    const step = TUTORIAL_STEPS[i];
    if (!step) return;
    if (i === TUTORIAL_STEPS.length - 1) {
      this.tutorialHold += dt;
      if (this.tutorialHold > 10) {
        this.setTutorial(-1);
        this.markStars(TUTORIAL.key, 1);
        this.game.toast('обучение пройдено');
      }
      return;
    }
    if (step.done(this.game)) {
      this.setTutorial(i + 1);
      this.game.toast('шаг пройден');
      sound.play('win');
    }
  }

  private markStars(level: string, stars: number): void {
    this.profile.stars[level] = Math.max(this.profile.stars[level] ?? 0, stars);
    void store.saveProfile(this.profile);
  }

  /** Задания считаются по текущей партии, но зачёт запоминается навсегда. */
  private checkAchievements(): void {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (this.profile.achievements.includes(a.key)) continue;
      if (!achievementDone(a, this.game)) continue;
      this.profile.achievements.push(a.key);
      this.game.toast(`задание: ${a.name}`);
      sound.play('win');
      changed = true;
    }
    if (changed) void store.saveProfile(this.profile);
  }

  private finishLevel(won: boolean): void {
    const g = this.game;
    if (won) {
      this.markStars(g.level.key, g.stars || 1);
      this.profile.records.push({
        level: g.level.key,
        stars: g.stars || 1,
        money: Math.round(g.money),
        rating: Math.round(g.rating),
        months: g.month + 1,
        at: Date.now(),
      });
      this.profile.records = this.profile.records.slice(-60);
      void store.saveProfile(this.profile);
    }
    this.ui.openResult(won);
  }

  private frame(dt: number): void {
    const g = this.game;
    if (!this.ui.modalOpen) g.update(dt);
    this.scene.render(g);
    if (this.tutorialStep >= 0) this.stepTutorial(dt);

    this.uiAcc += dt;
    if (this.uiAcc > 0.2) {
      this.uiAcc = 0;
      this.ui.update();
    }
    this.achAcc += dt;
    if (this.achAcc > 2) {
      this.achAcc = 0;
      this.checkAchievements();
    }
    // Автосохранение раз в полминуты, чтобы офлайн-доход имел смысл.
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.save(true);
    }
    if (g.status !== 'playing' && this.lastStatus === 'playing') {
      this.lastStatus = g.status;
      this.finishLevel(g.status === 'won');
    }
  }
}

const app = new App();
void app.start();

// Немного удобства при отладке в браузере.
Object.assign(window as unknown as Record<string, unknown>, { pp: app, sound, ENTRY, MAP_H });
