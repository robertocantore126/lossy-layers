import { StrokeBuffer } from '../core/brush';
import { ctx2d } from '../core/canvas';
import { toLayerSpace } from '../core/compositor';
import type { Point, StrokeOverlay } from '../core/types';
import { colorField, el, hint, sign, slider } from '../ui/controls';
import type { Tool, ToolContext } from './types';

/**
 * Brush and eraser are the same tool with a different composite operation,
 * so they share everything except that one line and their colour control.
 */
class PaintTool implements Tool {
  private stroke: StrokeBuffer | null = null;
  private strokeLayerId = -1;
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

  buildOptions(host: HTMLElement, ctx: ToolContext): void {
    const s = ctx.brushSettings;
    host.appendChild(sign(this.label));

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
      const stamp = ctx.brush.stamp(s, false);
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

    if (!this.erasing) {
      host.appendChild(
        colorField('Colour', s.color, (v) => { s.color = v; ctx.brush.invalidate(); drawPreview(); }),
      );
    }

    host.appendChild(hint('[ and ] resize the brush.'));
    drawPreview();
  }

  onPointerDown(p: Point, ctx: ToolContext): void {
    const layer = ctx.store.activeLayer();
    if (!layer) return;
    ctx.history.push();
    ctx.store.detach(layer);

    const lp = toLayerSpace(p, layer);
    this.stroke = new StrokeBuffer(layer.canvas.width, layer.canvas.height, lp);
    this.strokeLayerId = layer.id;
    this.strokeAlpha = ctx.brushSettings.opacity;
    ctx.brush.dab(this.stroke.ctx, ctx.brushSettings, this.erasing, lp);
    ctx.requestRender(true);
  }

  onPointerMove(p: Point, ctx: ToolContext): void {
    if (!this.stroke) return;
    const layer = ctx.store.layerById(this.strokeLayerId);
    if (!layer) return;
    const lp = toLayerSpace(p, layer);
    ctx.brush.segment(this.stroke.ctx, ctx.brushSettings, this.erasing, this.stroke.last, lp);
    this.stroke.last = lp;
    ctx.requestRender(true);
  }

  onPointerUp(_p: Point, ctx: ToolContext): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    const layer = ctx.store.layerById(this.strokeLayerId);
    if (layer) {
      const c = ctx2d(layer.canvas);
      c.save();
      c.globalAlpha = this.strokeAlpha;
      c.globalCompositeOperation = this.mode;
      c.drawImage(stroke.canvas, 0, 0);
      c.restore();
    }
    ctx.store.emit();
    ctx.requestRender(false);
  }

  overlay(): StrokeOverlay | null {
    if (!this.stroke) return null;
    return {
      layerId: this.strokeLayerId,
      buffer: this.stroke.canvas,
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
  'Paints on the selected layer only. Hardness sets how soft the edge is.',
  'b', false,
);

export const eraserTool = new PaintTool(
  'eraser', 'Eraser', ERASER_ICON,
  'Rubs through the selected layer to whatever sits under it. Drop the hardness for a soft edge.',
  'e', true,
);
