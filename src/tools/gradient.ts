import type { StrokeSample } from '../core/brush';
import { ctx2d, hexToRgb, newCanvas } from '../core/canvas';
import { toLayerSpace } from '../core/compositor';
import type { EditTarget, Point, StrokeOverlay } from '../core/types';
import { chipRow, colorField, hint, sign } from '../ui/controls';
import type { Tool, ToolContext } from './types';

type Shape = 'linear' | 'radial';

/**
 * Drag a gradient across the surface.
 *
 * On a mask this is the quickest blend there is: drag across the seam between
 * two images and one fades into the other along exactly the axis you drew.
 * Doing the same by hand with a soft eraser takes a dozen strokes and never
 * comes out as even.
 */
class GradientTool implements Tool {
  readonly id = 'gradient';
  readonly label = 'Gradient';
  readonly icon =
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 16.5h17M3.5 13h17" opacity=".55"/><path d="M3.5 9.5h17" opacity=".28"/>';
  readonly hint = 'Drag to fade across the layer. On a mask this blends one image into the next.';
  readonly shortcut = 'g';

  private shape: Shape = 'linear';
  /** On a mask, whether the drag hides or reveals as it goes. */
  private reversed = false;
  private drag: { start: Point; current: Point; layerId: number; target: EditTarget } | null = null;
  private buffer: HTMLCanvasElement | null = null;

  buildOptions(host: HTMLElement, ctx: ToolContext): void {
    const onMask = ctx.target === 'mask';
    host.appendChild(sign(onMask ? 'Gradient — on mask' : 'Gradient'));

    host.appendChild(
      chipRow<Shape>(
        'Shape',
        [
          { label: 'Linear', value: 'linear' },
          { label: 'Radial', value: 'radial' },
        ],
        (v) => v === this.shape,
        (v) => {
          this.shape = v;
          ctx.refreshOptions();
        },
      ),
    );

    host.appendChild(
      chipRow<boolean>(
        'Direction',
        onMask
          ? [
              { label: 'Hide → show', value: false },
              { label: 'Show → hide', value: true },
            ]
          : [
              { label: 'Colour → clear', value: false },
              { label: 'Clear → colour', value: true },
            ],
        (v) => v === this.reversed,
        (v) => {
          this.reversed = v;
          ctx.refreshOptions();
        },
      ),
    );

    if (!onMask) {
      host.appendChild(
        colorField('Colour', ctx.brushSettings.color, (v) => {
          ctx.brushSettings.color = v;
        }),
      );
    }

    host.appendChild(
      hint(
        onMask
          ? 'Drag from the part you want gone toward the part you want kept. Hold and redrag to try another angle before letting go.'
          : 'Select a mask on this layer to blend it into the layers below instead of painting over it.',
      ),
    );
  }

  /** Paint the gradient into a scratch buffer sized to the target surface. */
  private paint(ctx: ToolContext): void {
    const d = this.drag;
    if (!d || !this.buffer) return;
    const c = ctx2d(this.buffer);
    c.clearRect(0, 0, this.buffer.width, this.buffer.height);

    const onMask = d.target === 'mask';
    const rgb = onMask ? ([255, 255, 255] as const) : hexToRgb(ctx.brushSettings.color);
    const solid = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`;
    const clear = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`;

    const g =
      this.shape === 'linear'
        ? c.createLinearGradient(d.start.x, d.start.y, d.current.x, d.current.y)
        : c.createRadialGradient(
            d.start.x,
            d.start.y,
            0,
            d.start.x,
            d.start.y,
            Math.max(1, Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y)),
          );

    g.addColorStop(0, this.reversed ? clear : solid);
    g.addColorStop(1, this.reversed ? solid : clear);
    c.fillStyle = g;
    c.fillRect(0, 0, this.buffer.width, this.buffer.height);
  }

  onPointerDown(p: StrokeSample, ctx: ToolContext): void {
    const layer = ctx.store.activeLayer();
    if (!layer) return;
    const surface = ctx.store.surface(layer, ctx.target);
    if (!surface) return;

    const local = toLayerSpace(p, layer);
    this.buffer = newCanvas(surface.width, surface.height);
    this.drag = { start: local, current: local, layerId: layer.id, target: ctx.target };
    ctx.requestRender(true);
  }

  onPointerMove(p: StrokeSample, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = ctx.store.layerById(this.drag.layerId);
    if (!layer) return;
    this.drag.current = toLayerSpace(p, layer);
    this.paint(ctx);
    ctx.requestRender(true);
  }

  onPointerUp(p: StrokeSample, ctx: ToolContext): void {
    const d = this.drag;
    const buffer = this.buffer;
    this.drag = null;
    this.buffer = null;
    if (!d || !buffer) return;

    const layer = ctx.store.layerById(d.layerId);
    if (layer) {
      const local = toLayerSpace(p, layer);
      // A click with no drag has nowhere to run, so ignore it rather than
      // filling the whole surface from a zero-length axis.
      if (Math.hypot(local.x - d.start.x, local.y - d.start.y) >= 2) {
        ctx.history.push();
        ctx.store.detachTarget(layer, d.target);
        const surface = ctx.store.surface(layer, d.target);
        if (surface) {
          const c = ctx2d(surface);
          c.save();
          // On a mask the gradient carves visibility out; on pixels it paints.
          c.globalCompositeOperation = d.target === 'mask' ? 'destination-out' : 'source-over';
          c.drawImage(buffer, 0, 0);
          c.restore();
        }
      }
    }
    ctx.store.emit();
    ctx.requestRender(false);
  }

  overlay(): StrokeOverlay | null {
    if (!this.drag || !this.buffer) return null;
    return {
      layerId: this.drag.layerId,
      buffer: this.buffer,
      target: this.drag.target,
      mode: this.drag.target === 'mask' ? 'destination-out' : 'source-over',
      alpha: 1,
    };
  }
}

export const gradientTool = new GradientTool();
