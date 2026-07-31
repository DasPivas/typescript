import { Sprite } from 'pixi.js';
import './style/app.css';
import { ALL_DEFS, DEFS } from './core/catalog';
import { Game } from './core/game';
import { canPlace, canPlaceRoad, ENTRY, MAP_H } from './core/grid';
import { levelByKey, SANDBOX } from './core/levels';
import { TUTORIAL, TUTORIAL_STEPS } from './core/tutorial';
import { sound, type Sfx } from './audio/sound';
import type { Rot } from './core/types';
import { Controls } from './render/input';
import { Scene } from './render/scene';
import { UI, type AppApi } from './ui/ui';

const SAVE_KEY = 'pp.save.v1';
const PROGRESS_KEY = 'pp.progress.v1';

interface SaveData {
  levelKey: string;
  money: number;
  time: number;
  month: number;
  roads: number[];
  buildings: unknown[];
  staff: unknown[];
  stats: unknown;
}

class App implements AppApi {
  game = new Game(SANDBOX);
  scene = new Scene();
  ui!: UI;
  icons: Record<string, string> = {};
  selectedKey: string | null = null;
  removeMode = false;
  rot: Rot = 0;
  private progress = new Set<string>();
  private uiAcc = 0;
  private lastStatus: 'playing' | 'won' | 'lost' = 'playing';
  private tutorialStep = -1;
  private tutorialHold = 0;

  async start(): Promise<void> {
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    await this.scene.init(canvas);
    this.makeIcons();
    this.loadProgress();

    this.ui = new UI(document.getElementById('ui')!, this);
    new Controls(canvas, this.scene, {
      isPaintMode: () => this.selectedKey !== null && DEFS[this.selectedKey].cat === 'road',
      onTap: (c) => this.tap(c),
      onPaint: (c) => this.paint(c),
      onHover: (c) => this.hover(c),
    });

    // Звук нельзя завести без жеста — ловим первое касание.
    const unlock = () => sound.unlock();
    addEventListener('pointerdown', unlock, { capture: true });
    document.getElementById('ui')!.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button') || t.closest('.card')) sound.play('click');
      },
      true,
    );

    this.startLevel('tutorial');
    if (sound.asked) this.ui.openLevels();
    else this.ui.askSound(() => this.ui.openLevels());

    this.scene.app.ticker.add((t) => this.frame(t.deltaMS / 1000));
    addEventListener('contextmenu', (e) => e.preventDefault());
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
    return this.progress.has(key);
  }

  private loadProgress(): void {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) this.progress = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* пусто */
    }
  }

  private saveProgress(): void {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...this.progress]));
  }

  startLevel(key: string): void {
    this.game = new Game(key === 'sandbox' ? SANDBOX : levelByKey(key));
    this.game.onEvent = (e) => sound.play(e as Sfx);
    this.tutorialStep = key === TUTORIAL.key ? 0 : -1;
    this.tutorialHold = 0;
    this.ui?.setTutorial(
      this.tutorialStep >= 0 ? TUTORIAL_STEPS[0] : null,
      0,
      TUTORIAL_STEPS.length,
    );
    this.selectedKey = null;
    this.removeMode = false;
    this.rot = 0;
    this.lastStatus = 'playing';
    this.scene.ghost = null;
    this.scene.reset(this.game);
    this.ui?.renderItems();
    this.ui?.openIntro();
  }

  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null;
  }

  save(): void {
    const g = this.game;
    const data: SaveData = {
      levelKey: g.level.key,
      money: g.money,
      time: g.time,
      month: g.month,
      roads: Array.from(g.map.road),
      buildings: g.buildings.map((b) => ({ ...b, queue: [], riders: [] })),
      staff: g.staff.map((s) => ({ ...s, path: [] })),
      stats: g.stats,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      g.toast('игра успешно сохранена.');
    } catch {
      g.toast('не хватает памяти для сохранения игры.');
    }
  }

  load(): void {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as SaveData;
      this.startLevel(data.levelKey);
      this.ui.closeModal();
      const g = this.game;
      g.money = data.money;
      g.time = data.time;
      g.month = data.month;
      g.map.road.set(data.roads);
      g.buildings = data.buildings as typeof g.buildings;
      g.staff = data.staff as typeof g.staff;
      Object.assign(g.stats, data.stats);
      g.restoreAfterLoad();
      g.onEvent = (e) => sound.play(e as Sfx);
      this.scene.reset(g);
    } catch {
      this.game.toast('сохранение повреждено');
    }
  }

  // ─────────── ввод ───────────

  selectKey(key: string | null): void {
    this.selectedKey = key;
    this.scene.ghost = null;
    this.scene.showMotor = key !== null && (DEFS[key].needsMotor === true || key === 'dinomotor');
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
      this.scene.ghost = { def, x: c.x, y: c.y, rot: 0, ok: canPlaceRoad(this.game.map, c.x, c.y).ok };
      return;
    }
    if (!this.scene.ghost) return; // до первого тапа призрак не показываем
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
    const last = i === TUTORIAL_STEPS.length - 1;
    if (last) {
      this.tutorialHold += dt;
      if (this.tutorialHold > 10) {
        this.tutorialStep = -1;
        this.ui.setTutorial(null, 0, 0);
        this.progress.add(TUTORIAL.key);
        this.saveProgress();
        this.game.toast('обучение пройдено');
      }
      return;
    }
    if (step.done(this.game)) {
      this.tutorialStep = i + 1;
      this.ui.setTutorial(TUTORIAL_STEPS[i + 1], i + 1, TUTORIAL_STEPS.length);
      this.game.toast('шаг пройден');
      sound.play('win');
    }
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
    if (g.status !== 'playing' && this.lastStatus === 'playing') {
      this.lastStatus = g.status;
      if (g.status === 'won') {
        this.progress.add(g.level.key);
        this.saveProgress();
      }
      this.ui.openResult(g.status === 'won');
    }
  }
}

const app = new App();
void app.start();

// Немного удобства при отладке в браузере.
Object.assign(window as unknown as Record<string, unknown>, { pp: app, sound, ENTRY, MAP_H });
