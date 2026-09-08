import type { Point } from './types';
import { clamp, ctx2d, hexToRgb, newCanvas } from './canvas';

export interface BrushSettings {
  /** Diameter in layer pixels. */
  size: number;
  /** 0 = fully feathered, 1 = a hard disc. */
  hardness: number;
  /**
   * Ceiling for the whole stroke, applied once when it commits. Crossing your
   * own stroke never goes past this.
   */
  opacity: number;
  /**
   * How much each dab lays down. Below 1 the stroke builds up as it overlaps
   * itself, up to `opacity`. This is the control that makes soft blending
   * feel like an airbrush rather than a stencil.
   */
  flow: number;
  /** Dab spacing as a fraction of the diameter. Lower is smoother and slower. */
  spacing: number;
  /** 0 = raw pointer, higher lags the stroke behind to iron out shake. */
  smoothing: number;
  /** Let a stylus drive the diameter. */
  pressureSize: boolean;
  /** Let a stylus drive the flow. */
  pressureFlow: boolean;
  color: string;
}

export function defaultBrush(): BrushSettings {
  return {
    size: 60,
    hardness: 0.35,
    opacity: 1,
    flow: 1,
    spacing: 0.14,
    smoothing: 0.35,
    pressureSize: true,
    pressureFlow: false,
    color: '#ffffff',
  };
}

/** A pointer sample. `pressure` is 0..1; mice report 0.5 while held. */
export interface StrokeSample extends Point {
  pressure: number;
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

  /** Diameter for a sample, after pressure. */
  sizeFor(s: BrushSettings, pressure: number): number {
    if (!s.pressureSize) return s.size;
    // Never collapse to nothing: a stylus reporting near zero should still mark.
    return Math.max(1, s.size * (0.15 + 0.85 * clamp(pressure, 0, 1)));
  }

  flowFor(s: BrushSettings, pressure: number): number {
    return s.pressureFlow ? s.flow * clamp(pressure, 0, 1) : s.flow;
  }

  stamp(s: BrushSettings, erasing: boolean, diameter?: number): HTMLCanvasElement {
    const d = Math.max(2, Math.round(diameter ?? s.size));
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

  dab(ctx: CanvasRenderingContext2D, s: BrushSettings, erasing: boolean, p: StrokeSample): void {
    const d = this.sizeFor(s, p.pressure);
    const st = this.stamp(s, erasing, d);
    ctx.save();
    ctx.globalAlpha = this.flowFor(s, p.pressure);
    ctx.drawImage(st, p.x - st.width / 2, p.y - st.height / 2);
    ctx.restore();
  }

  /**
   * Dabs evenly along a segment, interpolating pressure across it. Spacing is
   * a fraction of the diameter, the convention other editors use, so wide
   * brushes do not need more dabs than narrow ones to look continuous.
   */
  segment(
    ctx: CanvasRenderingContext2D,
    s: BrushSettings,
    erasing: boolean,
    a: StrokeSample,
    b: StrokeSample,
  ): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, this.sizeFor(s, b.pressure) * clamp(s.spacing, 0.02, 1));
    if (dist < step) {
      this.dab(ctx, s, erasing, b);
      return;
    }
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.dab(ctx, s, erasing, {
        x: a.x + dx * t,
        y: a.y + dy * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
    }
  }
}

/**
 * Accumulates a stroke in its own buffer, then composites once.
 *
 * Stamping straight onto the target at partial alpha would darken wherever
 * the stroke crosses itself; buffering keeps a soft edge soft and lets flow
 * and opacity mean two different things.
 */
export class StrokeBuffer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Where the smoothed pen actually is, which lags the raw pointer. */
  last: StrokeSample;

  constructor(w: number, h: number, start: StrokeSample) {
    this.canvas = newCanvas(w, h);
    this.ctx = ctx2d(this.canvas);
    this.last = start;
  }
}

/**
 * Exponential smoothing towards the raw pointer.
 *
 * Cheap, has no lookahead so it never lags behind a fast stroke by more than
 * one step, and at 0 it is exactly the raw input.
 */
export function smoothToward(current: StrokeSample, target: StrokeSample, smoothing: number): StrokeSample {
  const k = 1 - clamp(smoothing, 0, 0.95);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
    pressure: current.pressure + (target.pressure - current.pressure) * k,
  };
}
