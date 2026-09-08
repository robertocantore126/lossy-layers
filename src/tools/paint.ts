import { smoothToward, StrokeBuffer, type BrushSettings, type StrokeSample } from '../core/brush';
import { ctx2d } from '../core/canvas';
import { toLayerSpace } from '../core/compositor';
import type { EditTarget, StrokeOverlay } from '../core/types';
import { checkbox, colorField, el, hint, sign, slider } from '../ui/controls';
import type { Tool, ToolContext } from './types';

/**
 * Brush and eraser are the same tool with a different composite operation,
 * so they share everything except that one line and their colour control.
 *
 * On a mask the pair reads the way people expect without anyone having to
 * remember a colour convention: the brush reveals the layer, the eraser
 * hides it, and neither touches the layer's own pixels.
 */
class PaintTool implements Tool {
  private stroke: StrokeBuffer | null = null;
  private strokeLayerId = -1;
  private strokeTarget: EditTarget = 'pixels';
  /** Locked in at pointer-down so the live overlay matches what commits. */
  private strokeAlpha = 1;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly icon: string,
    readonly hint: string,
    readonly shortcut: string,
    private readonly erasing: boolean,
  ) {}

  private get mode(): GlobalCompositeOperation {
    return this.erasing ? 'destination-out' : 'source-over';
  }

  /** A mask carries no colour, so painting one always lays down white. */
  private settingsFor(ctx: ToolContext): BrushSettings {
    if (ctx.target !== 'mask') return ctx.brushSettings;
    return { ...ctx.brushSettings, color: '#ffffff' };
  }

  buildOptions(host: HTMLElement, ctx: ToolContext): void {
    const s = ctx.brushSettings;
    const onMask = ctx.target === 'mask';
    host.appendChild(sign(onMask ? `${this.label} — on mask` : this.label));

    const preview = el('canvas', 'brush-preview');
    preview.width = 186;
    preview.height = 54;
    host.appendChild(preview);
    const drawPreview = (): void => {
      const c = ctx2d(preview);
      c.clearRect(0, 0, preview.width, preview.height);
      c.fillStyle = '#0c0e11';
      c.fillRect(0, 0, preview.width, preview.height);
      // Show the eraser's shape rather than the hole it would punch.
      const stamp = ctx.brush.stamp(onMask ? { ...s, color: '#ffffff' } : s, false, s.size);
      const d = Math.min(preview.height - 8, stamp.width);
      c.globalAlpha = s.opacity;
      c.drawImage(stamp, (preview.width - d) / 2, (preview.height - d) / 2, d, d);
      ctx.brush.invalidate();
    };

    host.appendChild(
      slider({
        label: 'Size', min: 1, max: 400, value: s.size, unit: ' px',
        onInput: (n) => { s.size = n; ctx.brush.invalidate(); drawPreview(); },
      }),
    );
    host.appendChild(
      slider({
        label: 'Hardness', min: 0, max: 98, value: Math.round(s.hardness * 100), unit: '%',
        onInput: (n) => { s.hardness = n / 100; ctx.brush.invalidate(); drawPreview(); },
      }),
    );
    host.appendChild(
      slider({
        label: 'Opacity', min: 2, max: 100, value: Math.round(s.opacity * 100), unit: '%',
        onInput: (n) => { s.opacity = n / 100; drawPreview(); },
      }),
    );
    host.appendChild(
      slider({
        label: 'Flow', min: 1, max: 100, value: Math.round(s.flow * 100), unit: '%',
        onInput: (n) => { s.flow = n / 100; },
      }),
    );
    host.appendChild(
      hint(
        s.flow < 1
          ? 'Flow below 100% builds up as the stroke crosses itself, stopping at Opacity.'
          : 'Drop Flow to build a blend up gradually instead of laying it down at once.',
      ),
    );
    host.appendChild(
      slider({
        label: 'Spacing', min: 2, max: 60, value: Math.round(s.spacing * 100), unit: '%',
        onInput: (n) => { s.spacing = n / 100; },
      }),
    );
    host.appendChild(
      slider({
        label: 'Smoothing', min: 0, max: 90, value: Math.round(s.smoothing * 100), unit: '%',
        onInput: (n) => { s.smoothing = n / 100; },
      }),
    );

    host.appendChild(checkbox('Pen pressure sets size', s.pressureSize, (v) => { s.pressureSize = v; }));
    host.appendChild(checkbox('Pen pressure sets flow', s.pressureFlow, (v) => { s.pressureFlow = v; }));

    if (!this.erasing && !onMask) {
      host.appendChild(
        colorField('Colour', s.color, (v) => { s.color = v; ctx.brush.invalidate(); drawPreview(); }),
      );
    }

    host.appendChild(
      hint(
        onMask
          ? this.erasing
            ? 'Hides this layer where you paint, revealing what sits underneath. Switch to the brush to bring it back.'
            : 'Brings this layer back where you paint. Nothing here changes its pixels.'
          : '[ and ] resize the brush.',
      ),
    );
    drawPreview();
  }

  onPointerDown(p: StrokeSample, ctx: ToolContext): void {
    const layer = ctx.store.activeLayer();
    if (!layer) return;
    const surface = ctx.store.surface(layer, ctx.target);
    if (!surface) return;

    ctx.history.push();
    ctx.store.detachTarget(layer, ctx.target);

    const local = toLayerSpace(p, layer);
    const start: StrokeSample = { x: local.x, y: local.y, pressure: p.pressure };
    this.stroke = new StrokeBuffer(surface.width, surface.height, start);
    this.strokeLayerId = layer.id;
    this.strokeTarget = ctx.target;
    this.strokeAlpha = ctx.brushSettings.opacity;
    ctx.brush.dab(this.stroke.ctx, this.settingsFor(ctx), this.erasing, start);
    ctx.requestRender(true);
  }

  onPointerMove(p: StrokeSample, ctx: ToolContext): void {
    if (!this.stroke) return;
    const layer = ctx.store.layerById(this.strokeLayerId);
    if (!layer) return;
    const local = toLayerSpace(p, layer);
    const raw: StrokeSample = { x: local.x, y: local.y, pressure: p.pressure };
    // Smoothing lags the pen behind the pointer, which is what irons out shake.
    const next = smoothToward(this.stroke.last, raw, ctx.brushSettings.smoothing);
    ctx.brush.segment(this.stroke.ctx, this.settingsFor(ctx), this.erasing, this.stroke.last, next);
    this.stroke.last = next;
    ctx.requestRender(true);
  }

  onPointerUp(p: StrokeSample, ctx: ToolContext): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;

    const layer = ctx.store.layerById(this.strokeLayerId);
    if (layer) {
      // Catch the smoothed pen up to where the pointer actually stopped, or a
      // quick flick would end short of its own endpoint.
      const local = toLayerSpace(p, layer);
      ctx.brush.segment(
        stroke.ctx,
        this.settingsFor(ctx),
        this.erasing,
        stroke.last,
        { x: local.x, y: local.y, pressure: p.pressure },
      );

      const surface = ctx.store.surface(layer, this.strokeTarget);
      if (surface) {
        const c = ctx2d(surface);
        c.save();
        c.globalAlpha = this.strokeAlpha;
        c.globalCompositeOperation = this.mode;
        c.drawImage(stroke.canvas, 0, 0);
        c.restore();
      }
    }
    ctx.store.emit();
    ctx.requestRender(false);
  }

  overlay(): StrokeOverlay | null {
    if (!this.stroke) return null;
    return {
      layerId: this.strokeLayerId,
      buffer: this.stroke.canvas,
      target: this.strokeTarget,
      mode: this.mode,
      alpha: this.strokeAlpha,
    };
  }
}

const BRUSH_ICON =
  '<path d="M6 20c2.5 0 4-1.6 4-3.8 0-1.5-1-2.4-2.3-2.4C6.2 13.8 5 15 5 17c0 1.4-.6 2.3-2 3 .8.5 2 .6 3 0z"/><path d="M9.6 14.3 19 5"/>';
const ERASER_ICON = '<path d="M8.5 19H20"/><path d="m13 5 6 6-7.5 7.5H8L4.5 15z"/>';

export const brushTool = new PaintTool(
  'brush', 'Brush', BRUSH_ICON,
  'Paints on the selected layer, or reveals it when a mask is selected.',
  'b', false,
);

export const eraserTool = new PaintTool(
  'eraser', 'Eraser', ERASER_ICON,
  'Rubs through the selected layer. With a mask selected it hides instead of deleting, so you can paint it back.',
  'e', true,
);
