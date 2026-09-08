import type { DocState, Layer, StrokeOverlay } from './types';
import { ctx2d, newCanvas, resizeCanvas } from './canvas';

/**
 * Flattens the layer stack into one canvas.
 *
 * Two things happen per layer. A mask, if present and enabled, is applied as
 * a `destination-in` so the layer shows only where the mask is opaque. A
 * stroke in progress is drawn over whichever surface it targets, through
 * scratch canvases, so neither the layer's pixels nor its mask are touched
 * until the pointer lifts and the tool commits.
 */
export class Compositor {
  readonly output: HTMLCanvasElement = newCanvas(1, 1);
  private pixelScratch: HTMLCanvasElement = newCanvas(1, 1);
  private maskScratch: HTMLCanvasElement = newCanvas(1, 1);

  composite(doc: DocState, overlay: StrokeOverlay | null): HTMLCanvasElement {
    resizeCanvas(this.output, doc.width, doc.height);
    const c = ctx2d(this.output);
    c.imageSmoothingQuality = 'high';
    c.clearRect(0, 0, doc.width, doc.height);
    c.fillStyle = doc.matte;
    c.fillRect(0, 0, doc.width, doc.height);

    for (const l of doc.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      const active = overlay && overlay.layerId === l.id ? overlay : null;
      const source = this.resolve(l, active);
      c.save();
      c.globalAlpha = l.opacity;
      c.globalCompositeOperation = l.blend;
      c.drawImage(source, l.x, l.y, l.canvas.width * l.scale, l.canvas.height * l.scale);
      c.restore();
    }
    return this.output;
  }

  /** The layer's final pixels: its own, plus any live stroke, minus its mask. */
  private resolve(l: Layer, overlay: StrokeOverlay | null): HTMLCanvasElement {
    const paintingPixels = overlay?.target === 'pixels';
    const paintingMask = overlay?.target === 'mask';
    const hasMask = Boolean(l.mask) && l.maskEnabled;

    if (!overlay && !hasMask) return l.canvas;

    // Start from the layer's pixels, adding a live pixel stroke if there is one.
    let pixels: HTMLCanvasElement = l.canvas;
    if (paintingPixels) {
      resizeCanvas(this.pixelScratch, l.canvas.width, l.canvas.height);
      const p = ctx2d(this.pixelScratch);
      p.clearRect(0, 0, this.pixelScratch.width, this.pixelScratch.height);
      p.drawImage(l.canvas, 0, 0);
      p.save();
      p.globalAlpha = overlay!.alpha;
      p.globalCompositeOperation = overlay!.mode;
      p.drawImage(overlay!.buffer, 0, 0);
      p.restore();
      pixels = this.pixelScratch;
    }

    if (!hasMask && !paintingMask) return pixels;

    // Then the mask, again including any live stroke aimed at it.
    let mask: HTMLCanvasElement | null = l.maskEnabled ? l.mask : null;
    if (paintingMask && l.mask) {
      resizeCanvas(this.maskScratch, l.mask.width, l.mask.height);
      const m = ctx2d(this.maskScratch);
      m.clearRect(0, 0, this.maskScratch.width, this.maskScratch.height);
      m.drawImage(l.mask, 0, 0);
      m.save();
      m.globalAlpha = overlay!.alpha;
      m.globalCompositeOperation = overlay!.mode;
      m.drawImage(overlay!.buffer, 0, 0);
      m.restore();
      mask = this.maskScratch;
    }
    if (!mask) return pixels;

    // `pixels` may already be pixelScratch, so the masked result needs a
    // surface of its own rather than compositing over the one we read from.
    const out = newCanvas(l.canvas.width, l.canvas.height);
    const o = ctx2d(out);
    o.drawImage(pixels, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(mask, 0, 0);
    return out;
  }
}

/** Document space to a layer's own pixel space. */
export function toLayerSpace(p: { x: number; y: number }, l: Layer): { x: number; y: number } {
  return { x: (p.x - l.x) / l.scale, y: (p.y - l.y) / l.scale };
}
