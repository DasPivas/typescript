import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { DEFS } from '../core/catalog';
import type { Game } from '../core/game';
import { dims, doorCell, exitCell, ENTRY, MAP_H, MAP_W, type ParkMap } from '../core/grid';
import type { Building, BuildingDef, Rot } from '../core/types';
import { ALWAYS_ANIMATED, buildArt, LIFT, TILE, type Art } from './art';
import { C } from './palette';

export interface Ghost {
  def: BuildingDef;
  x: number;
  y: number;
  rot: Rot;
  ok: boolean;
}

export class Scene {
  app = new Application();
  art!: Art;
  world = new Container();
  private ground = new Container();
  private roads = new Container();
  private objects = new Container();
  private overlay = new Graphics();
  private ghostLayer = new Container();
  private ghostSprite = new Sprite();
  private buildingSprites = new Map<number, Sprite>();
  private doorMarks = new Map<number, Graphics>();
  private peoplePool: Sprite[] = [];
  private wishPool: Sprite[] = [];
  private roadDirty = true;

  cam = { x: (MAP_W * TILE) / 2, y: MAP_H * TILE - 220, zoom: 1 };
  ghost: Ghost | null = null;
  /** Подсветка зоны диномоторов при постройке техники. */
  showMotor = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      background: 0x2c4a1a,
      resizeTo: canvas.parentElement ?? window,
    });
    this.art = buildArt(this.app.renderer);

    this.objects.sortableChildren = true;
    this.world.addChild(this.ground, this.roads, this.overlay, this.objects, this.ghostLayer);
    this.app.stage.addChild(this.world);
    this.ghostSprite.alpha = 0.75;
    this.ghostLayer.addChild(this.ghostSprite);
  }

  get screenW(): number {
    return this.app.screen.width;
  }

  get screenH(): number {
    return this.app.screen.height;
  }

  buildGround(map: ParkMap): void {
    this.ground.removeChildren();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = map.terrainAt(x, y);
        let tex: Texture;
        if (t === 1) tex = this.art.water;
        else if (t === 2) tex = this.art.rock;
        else tex = this.art.terrain[(x * 7 + y * 13) % 3];
        const s = new Sprite(tex);
        s.position.set(x * TILE, y * TILE);
        s.width = TILE;
        s.height = TILE;
        this.ground.addChild(s);
      }
    }
    const gate = new Sprite(this.art.entrance);
    gate.width = TILE * 3 + 4;
    gate.height = TILE * 2 + 4;
    gate.position.set((ENTRY.x - 1) * TILE - 2, (MAP_H - 2) * TILE - 2);
    this.ground.addChild(gate);
  }

  markRoadsDirty(): void {
    this.roadDirty = true;
  }

  private rebuildRoads(map: ParkMap): void {
    this.roads.removeChildren();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const r = map.roadAt(x, y);
        if (!r) continue;
        const s = new Sprite(r === 2 ? this.art.roadStone : this.art.roadDirt);
        s.position.set(x * TILE, y * TILE);
        s.width = TILE;
        s.height = TILE;
        this.roads.addChild(s);
      }
    }
    this.roadDirty = false;
  }

  private syncBuildings(game: Game): void {
    const seen = new Set<number>();
    for (const b of game.buildings) {
      seen.add(b.id);
      let s = this.buildingSprites.get(b.id);
      const frames = this.art.buildings[b.key];
      if (!frames) continue;
      if (!s) {
        s = new Sprite(frames[0]);
        const def = DEFS[b.key];
        s.width = def.w * TILE + 4;
        s.height = (def.h + LIFT) * TILE + 4;
        this.objects.addChild(s);
        this.buildingSprites.set(b.id, s);

        const mark = new Graphics();
        this.objects.addChild(mark);
        this.doorMarks.set(b.id, mark);
      }
      const def = DEFS[b.key];
      const d = dims(def, b.rot);
      // Крутится, пока внутри есть гости (мотор и родник — всегда).
      if (frames.length > 1) {
        const active = !b.broken && (b.riders.length > 0 || ALWAYS_ANIMATED.has(b.key));
        s.texture = active ? frames[Math.floor(game.time * 7) % frames.length] : frames[0];
      }
      s.position.set(b.x * TILE - 2, (b.y + d.h - def.h - LIFT) * TILE - 2);
      s.zIndex = (b.y + d.h) * TILE;
      s.tint = b.broken ? 0x9a9a9a : 0xffffff;

      const mark = this.doorMarks.get(b.id)!;
      mark.clear();
      if (def.cat !== 'decor') {
        const center = { x: b.x + d.w / 2, y: b.y + d.h / 2 };
        drawGate(mark, doorCell(def, b.x, b.y, b.rot), true, center);
        const ec = exitCell(def, b.x, b.y, b.rot);
        if (ec) drawGate(mark, ec, false, center);
        mark.zIndex = (b.y + d.h) * TILE + 1;
      }
      if (b.broken) {
        mark
          .moveTo(b.x * TILE + 6, (b.y - 0.4) * TILE)
          .lineTo((b.x + d.w) * TILE - 6, (b.y - 0.4) * TILE)
          .stroke({ width: 4, color: C.red });
      }
    }
    for (const [id, s] of this.buildingSprites) {
      if (seen.has(id)) continue;
      s.destroy();
      this.buildingSprites.delete(id);
      this.doorMarks.get(id)?.destroy();
      this.doorMarks.delete(id);
    }
  }

  private syncPeople(game: Game): void {
    const frameOf = (t: number) => (Math.floor(t * 6) % 2 === 0 ? 1 : 2);
    let i = 0;
    const need = game.visitors.length + game.staff.length;
    while (this.peoplePool.length < need) {
      const s = new Sprite();
      s.anchor.set(0.5, 1);
      this.objects.addChild(s);
      this.peoplePool.push(s);
    }
    const showWishes = this.cam.zoom > 0.85;
    let w = 0;
    while (this.wishPool.length < 40) {
      const s = new Sprite();
      s.anchor.set(0.5, 1);
      this.objects.addChild(s);
      this.wishPool.push(s);
    }

    for (const v of game.visitors) {
      const s = this.peoplePool[i++];
      s.visible = v.state !== 'busy';
      if (!s.visible) continue;
      const moving = v.path.length > 0;
      s.texture = this.art.visitor[v.tint % this.art.visitor.length][
        moving ? frameOf(game.time + v.id) : 0
      ];
      s.width = 17;
      s.height = 24;
      s.position.set(v.x * TILE, v.y * TILE + 6);
      s.zIndex = v.y * TILE + 2;
      s.tint = v.state === 'fighting' ? 0xff8080 : 0xffffff;

      if (showWishes && w < this.wishPool.length && v.wish !== 'happy' && v.state !== 'busy') {
        const b = this.wishPool[w++];
        b.visible = true;
        b.texture = this.art.wish[v.wish] ?? this.art.wish.sad;
        b.width = 19;
        b.height = 21;
        b.position.set(v.x * TILE, v.y * TILE - 14);
        b.zIndex = v.y * TILE + 3;
      }
    }
    for (const st of game.staff) {
      const s = this.peoplePool[i++];
      s.visible = true;
      s.texture = this.art.staff[st.kind];
      s.width = 18;
      s.height = 25;
      s.position.set(st.x * TILE, st.y * TILE + 6);
      s.zIndex = st.y * TILE + 2;
      s.tint = 0xffffff;
    }
    for (; i < this.peoplePool.length; i++) this.peoplePool[i].visible = false;
    for (; w < this.wishPool.length; w++) this.wishPool[w].visible = false;
  }

  private syncOverlay(game: Game): void {
    this.overlay.clear();
    if (this.showMotor) {
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (game.map.motor[game.map.idx(x, y)]) {
            this.overlay.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x7ce0ff, alpha: 0.16 });
          }
        }
      }
    }
    const g = this.ghost;
    if (!g) {
      this.ghostSprite.visible = false;
      return;
    }
    const d = dims(g.def, g.rot);
    if (g.def.cat === 'road') {
      this.ghostSprite.visible = false;
      this.overlay
        .rect(g.x * TILE, g.y * TILE, TILE, TILE)
        .fill({ color: g.ok ? 0x7dff6a : 0xff5a5a, alpha: 0.4 });
      return;
    }
    const frames = this.art.buildings[g.def.key];
    if (!frames) return;
    this.ghostSprite.visible = true;
    this.ghostSprite.texture = frames[0];
    this.ghostSprite.width = g.def.w * TILE + 4;
    this.ghostSprite.height = (g.def.h + LIFT) * TILE + 4;
    this.ghostSprite.position.set(g.x * TILE - 2, (g.y + d.h - g.def.h - LIFT) * TILE - 2);
    this.ghostSprite.tint = g.ok ? 0xffffff : 0xff8080;
    this.overlay
      .rect(g.x * TILE, g.y * TILE, d.w * TILE, d.h * TILE)
      .fill({ color: g.ok ? 0x7dff6a : 0xff5a5a, alpha: 0.28 });
    const dc = doorCell(g.def, g.x, g.y, g.rot);
    this.overlay
      .rect(dc.x * TILE + 3, dc.y * TILE + 3, TILE - 6, TILE - 6)
      .stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
    const ec = exitCell(g.def, g.x, g.y, g.rot);
    if (ec) {
      this.overlay
        .rect(ec.x * TILE + 3, ec.y * TILE + 3, TILE - 6, TILE - 6)
        .stroke({ width: 3, color: 0x8bf05a, alpha: 0.95 });
    }
  }

  render(game: Game): void {
    if (this.roadDirty) this.rebuildRoads(game.map);
    this.syncBuildings(game);
    this.syncPeople(game);
    this.syncOverlay(game);
    this.applyCamera();
  }

  applyCamera(): void {
    const z = this.cam.zoom;
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    const halfW = this.screenW / (2 * z);
    const halfH = this.screenH / (2 * z);
    const pad = TILE * 1.5;
    const minX = Math.min(worldW / 2, halfW - pad);
    const maxX = Math.max(worldW / 2, worldW - halfW + pad);
    const minY = Math.min(worldH / 2, halfH - pad);
    const maxY = Math.max(worldH / 2, worldH - halfH + pad);
    this.cam.x = Math.max(minX, Math.min(this.cam.x, maxX));
    this.cam.y = Math.max(minY, Math.min(this.cam.y, maxY));
    this.world.scale.set(z);
    this.world.position.set(
      -this.cam.x * z + this.screenW / 2,
      -this.cam.y * z + this.screenH / 2,
    );
  }

  screenToCell(sx: number, sy: number): { x: number; y: number } {
    const z = this.cam.zoom;
    const wx = (sx - this.world.position.x) / z;
    const wy = (sy - this.world.position.y) / z;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  centerOn(x: number, y: number): void {
    this.cam.x = x * TILE;
    this.cam.y = y * TILE;
    this.applyCamera();
  }

  /** Полный сброс сцены под новую игру. */
  reset(game: Game): void {
    for (const s of this.buildingSprites.values()) s.destroy();
    this.buildingSprites.clear();
    for (const g of this.doorMarks.values()) g.destroy();
    this.doorMarks.clear();
    this.buildGround(game.map);
    this.markRoadsDirty();
    // Стартовый зум подбираем так, чтобы в ширину влезало ~16 клеток.
    this.cam.zoom = Math.max(0.55, Math.min(1.3, this.screenW / (16 * TILE)));
    this.centerOn(ENTRY.x, MAP_H - 7);
  }
}

/**
 * Вход — светлая рамка со стрелкой внутрь постройки, выход — зелёная со стрелкой
 * наружу, к дороге. Направление считаем от клетки к центру постройки.
 */
function drawGate(
  g: Graphics,
  cell: { x: number; y: number },
  isDoor: boolean,
  center: { x: number; y: number },
): void {
  const x = cell.x * TILE;
  const y = cell.y * TILE;
  const color = isDoor ? C.bone : 0x8bf05a;
  g.roundRect(x + 5, y + 5, TILE - 10, TILE - 10, 4).stroke({ width: 2, color, alpha: 0.8 });
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  let vx = center.x - (cell.x + 0.5);
  let vy = center.y - (cell.y + 0.5);
  const len = Math.hypot(vx, vy) || 1;
  vx /= len;
  vy /= len;
  if (!isDoor) {
    vx = -vx;
    vy = -vy;
  }
  const tipX = cx + vx * 6;
  const tipY = cy + vy * 6;
  g.moveTo(cx - vx * 6, cy - vy * 6)
    .lineTo(tipX, tipY)
    .moveTo(tipX - vx * 4 - vy * 3.5, tipY - vy * 4 + vx * 3.5)
    .lineTo(tipX, tipY)
    .lineTo(tipX - vx * 4 + vy * 3.5, tipY - vy * 4 - vx * 3.5)
    .stroke({ width: 2, color, alpha: 0.9 });
}

export function buildingLabel(b: Building): string {
  return DEFS[b.key].name;
}
