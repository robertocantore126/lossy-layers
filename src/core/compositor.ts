import type { DocState, Layer, StrokeOverlay } from './types';
import { ctx2d, newCanvas, resizeCanvas } from './canvas';

/**
 * Flattens the layer stack into one canvas.
 *
 * A stroke in progress is drawn over its own layer through a scratch canvas,
 * so the layer's real pixels stay untouched until the pointer lifts and the
 * tool commits. That is what makes a stroke cancellable and undo exact.
 */
export class Compositor {
  readonly output: HTMLCanvasElement = newCanvas(1, 1);
  private scratch: HTMLCanvasElement = newCanvas(1, 1);

  composite(doc: DocState, overlay: StrokeOverlay | null): HTMLCanvasElement {
    resizeCanvas(this.output, doc.width, doc.height);
    const c = ctx2d(this.output);
    c.imageSmoothingQuality = 'high';
    c.clearRect(0, 0, doc.width, doc.height);
    c.fillStyle = doc.matte;
    c.fillRect(0, 0, doc.width, doc.height);

    for (const l of doc.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      c.save();
      c.globalAlpha = l.opacity;
      c.globalCompositeOperation = l.blend;
      if (overlay && overlay.layerId === l.id) {
        this.drawWithOverlay(c, l, overlay);
      } else {
        this.drawLayer(c, l, l.canvas);
      }
      c.restore();
    }
    return this.output;
  }

  private drawLayer(c: CanvasRenderingContext2D, l: Layer, source: CanvasImageSource): void {
    c.drawImage(source, l.x, l.y, l.canvas.width * l.scale, l.canvas.height * l.scale);
  }

  private drawWithOverlay(c: CanvasRenderingContext2D, l: Layer, overlay: StrokeOverlay): void {
    resizeCanvas(this.scratch, l.canvas.width, l.canvas.height);
    const s = ctx2d(this.scratch);
    s.clearRect(0, 0, this.scratch.width, this.scratch.height);
    s.drawImage(l.canvas, 0, 0);
    s.save();
    s.globalAlpha = overlay.alpha;
    s.globalCompositeOperation = overlay.mode;
    s.drawImage(overlay.buffer, 0, 0);
    s.restore();
    this.drawLayer(c, l, this.scratch);
  }
}

/** Document space to a layer's own pixel space. */
export function toLayerSpace(p: { x: number; y: number }, l: Layer): { x: number; y: number } {
  return { x: (p.x - l.x) / l.scale, y: (p.y - l.y) / l.scale };
}
