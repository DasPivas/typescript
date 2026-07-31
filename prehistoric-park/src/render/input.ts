import type { Scene } from './scene';

export interface ControlHooks {
  onTap(cell: { x: number; y: number }): void;
  onPaint(cell: { x: number; y: number }): void;
  onHover(cell: { x: number; y: number }): void;
  /** В режиме рисования дорог перетаскивание кладёт дорогу, а не двигает камеру. */
  isPaintMode(): boolean;
}

interface P {
  id: number;
  x: number;
  y: number;
}

const TAP_SLOP = 12;
const TAP_MS = 350;

/** Тач-управление: один палец — панорама или рисование, два — зум. */
export class Controls {
  private pointers = new Map<number, P>();
  private startPos: P | null = null;
  private startTime = 0;
  private moved = false;
  private painting = false;
  private lastCell = { x: -1, y: -1 };
  private pinchDist = 0;
  private pinchZoom = 1;

  constructor(
    private el: HTMLElement,
    private scene: Scene,
    private hooks: ControlHooks,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
  }

  private local(e: PointerEvent): P {
    const r = this.el.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(p.id, p);
    if (this.pointers.size === 1) {
      this.startPos = p;
      this.startTime = performance.now();
      this.moved = false;
      this.painting = this.hooks.isPaintMode();
      if (this.painting) {
        const c = this.scene.screenToCell(p.x, p.y);
        this.lastCell = c;
        this.hooks.onPaint(c);
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchZoom = this.scene.cam.zoom;
      this.painting = false;
    }
  };

  private move = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      const q = this.local(e);
      this.hooks.onHover(this.scene.screenToCell(q.x, q.y));
      return;
    }
    const p = this.local(e);
    this.pointers.set(p.id, p);

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) {
        const z = Math.max(0.5, Math.min(2.4, (this.pinchZoom * d) / this.pinchDist));
        this.scene.cam.zoom = z;
        this.scene.applyCamera();
      }
      this.moved = true;
      return;
    }

    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (this.startPos && Math.hypot(p.x - this.startPos.x, p.y - this.startPos.y) > TAP_SLOP) {
      this.moved = true;
    }
    if (this.painting) {
      const c = this.scene.screenToCell(p.x, p.y);
      if (c.x !== this.lastCell.x || c.y !== this.lastCell.y) {
        this.lastCell = c;
        this.hooks.onPaint(c);
      }
      return;
    }
    if (this.moved) {
      this.scene.cam.x -= dx / this.scene.cam.zoom;
      this.scene.cam.y -= dy / this.scene.cam.zoom;
      this.scene.applyCamera();
    }
    this.hooks.onHover(this.scene.screenToCell(p.x, p.y));
  };

  private up = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (this.pointers.size === 0) {
      const quick = performance.now() - this.startTime < TAP_MS;
      if (!this.moved && quick && !this.painting) {
        this.hooks.onTap(this.scene.screenToCell(p.x, p.y));
      }
      this.painting = false;
      this.startPos = null;
      this.lastCell = { x: -1, y: -1 };
    }
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const z = Math.max(0.5, Math.min(2.4, this.scene.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    this.scene.cam.zoom = z;
    this.scene.applyCamera();
  };
}
