import type { Point } from './types';
import { clamp, ctx2d, hexToRgb, newCanvas } from './canvas';

export interface BrushSettings {
  /** Diameter in layer pixels. */
  size: number;
  /** 0 = fully feathered, 1 = a hard disc. */
  hardness: number;
  /** 0..1, applied once when the stroke commits. */
  opacity: number;
  color: string;
}

/**
 * A soft round brush.
 *
 * The stamp is a radial gradient that stays fully opaque out to `hardness`
 * and falls to zero at the rim, which is what "hardness" means in every
 * editor people already know. Stamps are cached because rebuilding a gradient
 * per dab would dominate the cost of a stroke.
 */
export class Brush {
  private canvas = newCanvas(2, 2);
  private key = '';

  stamp(s: BrushSettings, erasing: boolean): HTMLCanvasElement {
    const d = Math.max(2, Math.round(s.size));
    const key = `${d}|${s.hardness}|${erasing ? 'e' : s.color}`;
    if (key === this.key) return this.canvas;
    this.key = key;

    this.canvas = newCanvas(d, d);
    const c = ctx2d(this.canvas);
    const r = d / 2;
    // Erasing writes into a mask, so only its alpha matters.
    const rgb = erasing ? ([0, 0, 0] as const) : hexToRgb(s.color);
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    const solid = clamp(s.hardness, 0, 0.98);
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    g.addColorStop(solid, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(r, r, r, 0, Math.PI * 2);
    c.fill();
    return this.canvas;
  }

  invalidate(): void {
    this.key = '';
  }

  dab(ctx: CanvasRenderingContext2D, s: BrushSettings, erasing: boolean, p: Point): void {
    const st = this.stamp(s, erasing);
    ctx.drawImage(st, p.x - st.width / 2, p.y - st.height / 2);
  }

  /**
   * Dabs evenly along a segment. Spacing is a fraction of the diameter, the
   * same convention other editors use, so wide brushes do not need more dabs
   * than narrow ones to look continuous.
   */
  segment(ctx: CanvasRenderingContext2D, s: BrushSettings, erasing: boolean, a: Point, b: Point): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, s.size * 0.14);
    if (dist < step) {
      this.dab(ctx, s, erasing, b);
      return;
    }
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      this.dab(ctx, s, erasing, { x: a.x + dx * (i / n), y: a.y + dy * (i / n) });
    }
  }
}

/**
 * Accumulates a stroke at full alpha in its own buffer, then composites once.
 *
 * Stamping straight onto the layer at partial alpha would darken wherever the
 * stroke crosses itself; buffering keeps a soft edge soft.
 */
export class StrokeBuffer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  last: Point;

  constructor(w: number, h: number, start: Point) {
    this.canvas = newCanvas(w, h);
    this.ctx = ctx2d(this.canvas);
    this.last = start;
  }
}
