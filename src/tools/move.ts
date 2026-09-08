import type { StrokeSample } from '../core/brush';
import type { Layer, Point } from '../core/types';
import { button, hint, row, sign, slider } from '../ui/controls';
import type { Tool, ToolContext } from './types';

/**
 * Repositions and rescales a layer without touching its pixels. The transform
 * lives on the layer and is applied at composite time, so moving a layer is
 * free and lossless no matter how often you do it.
 */
class MoveTool implements Tool {
  readonly id = 'move';
  readonly label = 'Move';
  readonly icon =
    '<path d="M12 3v18M3 12h18M12 3l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3"/>';
  readonly hint = 'Drag to reposition the selected layer. Scale resizes it around its own corner.';
  readonly shortcut = 'v';

  private grab: { layer: Layer; start: Point; ox: number; oy: number } | null = null;

  buildOptions(host: HTMLElement, ctx: ToolContext): void {
    host.appendChild(sign('Layer transform'));
    const layer = ctx.store.activeLayer();
    if (!layer) {
      host.appendChild(hint('Add an image first.'));
      return;
    }

    host.appendChild(
      slider({
        label: 'Scale', min: 5, max: 400, value: Math.round(layer.scale * 100), unit: '%',
        onInput: (n) => {
          const l = ctx.store.activeLayer();
          if (!l) return;
          l.scale = n / 100;
          ctx.requestRender(true);
        },
        onCommit: () => ctx.requestRender(false),
      }),
    );

    host.appendChild(
      row(
        button('Fit to canvas', () => {
          const l = ctx.store.activeLayer();
          if (!l) return;
          ctx.history.push();
          ctx.store.fitToCanvas(l);
          ctx.refreshOptions();
          ctx.store.emit();
          ctx.requestRender(false);
        }),
        button('Centre', () => {
          const l = ctx.store.activeLayer();
          if (!l) return;
          ctx.history.push();
          ctx.store.centre(l);
          ctx.store.emit();
          ctx.requestRender(false);
        }),
        button('Reset', () => {
          const l = ctx.store.activeLayer();
          if (!l) return;
          ctx.history.push();
          l.scale = 1;
          l.x = 0;
          l.y = 0;
          ctx.refreshOptions();
          ctx.store.emit();
          ctx.requestRender(false);
        }),
      ),
    );
  }

  onPointerDown(p: StrokeSample, ctx: ToolContext): void {
    const layer = ctx.store.activeLayer();
    if (!layer) return;
    ctx.history.push();
    this.grab = { layer, start: p, ox: layer.x, oy: layer.y };
  }

  onPointerMove(p: StrokeSample, ctx: ToolContext): void {
    if (!this.grab) return;
    this.grab.layer.x = Math.round(this.grab.ox + (p.x - this.grab.start.x));
    this.grab.layer.y = Math.round(this.grab.oy + (p.y - this.grab.start.y));
    ctx.requestRender(true);
  }

  onPointerUp(_p: StrokeSample, ctx: ToolContext): void {
    if (!this.grab) return;
    this.grab = null;
    ctx.store.emit();
    ctx.requestRender(false);
  }
}

export const moveTool = new MoveTool();
