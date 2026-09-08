import { ctx2d, resizeCanvas } from '../core/canvas';
import type { StrokeSample } from '../core/brush';
import { el } from './controls';

export type ViewMode = 'split' | 'clean' | 'compressed';
export type Zoom = 'fit' | number;

export interface ViewportHandlers {
  onDown(p: StrokeSample): void;
  onMove(p: StrokeSample): void;
  onUp(p: StrokeSample): void;
}

/**
 * The two canvases and everything about turning a pointer event into a point
 * in document space.
 *
 * Both canvases accept strokes. The compressed one only differs from the
 * clean one by the crunch geometry, which is pure scaling, so mapping back is
 * a division and drawing on the compressed view is exact rather than an
 * approximation.
 */
export class Viewport {
  readonly root: HTMLElement;
  readonly clean: HTMLCanvasElement;
  readonly compressed: HTMLCanvasElement;

  private figClean: HTMLElement;
  private figCompressed: HTMLElement;
  private canvasesEl: HTMLElement;
  private cleanDim: HTMLElement;
  private compressedDim: HTMLElement;
  private noteEl: HTMLElement;

  private zoom: Zoom = 'fit';
  private docW = 1;
  private docH = 1;
  private dragging: HTMLCanvasElement | null = null;

  constructor(private handlers: ViewportHandlers) {
    this.clean = el('canvas');
    this.clean.id = 'clean-canvas';
    this.compressed = el('canvas');
    this.compressed.id = 'compressed-canvas';

    this.cleanDim = el('span', 'sign mono');
    this.compressedDim = el('span', 'sign mono');

    this.figClean = this.buildFigure('Clean — you work here', this.cleanDim, this.clean);
    this.figCompressed = this.buildFigure('Compressed — live', this.compressedDim, this.compressed);

    this.canvasesEl = el('div', 'canvases');
    this.canvasesEl.append(this.figClean, this.figCompressed);

    this.noteEl = el('p', 'note');

    this.root = el('div', 'viewport');
    this.root.append(this.canvasesEl);

    this.attach(this.clean);
    this.attach(this.compressed);
    this.setMode('split');
  }

  get note(): HTMLElement {
    return this.noteEl;
  }

  private buildFigure(label: string, dim: HTMLElement, canvas: HTMLCanvasElement): HTMLElement {
    const fig = el('figure');
    const cap = el('figcaption');
    cap.append(el('span', 'sign', label), dim);
    const holder = el('div', 'holder');
    holder.appendChild(canvas);
    fig.append(cap, holder);
    return fig;
  }

  setMode(mode: ViewMode): void {
    this.figClean.hidden = mode === 'compressed';
    this.figCompressed.hidden = mode === 'clean';
    this.canvasesEl.classList.toggle('single', mode !== 'split');
    this.noteEl.textContent =
      mode === 'compressed'
        ? 'Working straight on the compressed view. Strokes still land in the layer underneath.'
        : mode === 'clean'
          ? 'The clean composite, before any encoding.'
          : 'Both views take strokes. The right one is what the JPEG keeps.';
    this.applyZoom();
  }

  setZoom(z: Zoom): void {
    this.zoom = z;
    this.applyZoom();
  }

  private applyZoom(): void {
    for (const cv of [this.clean, this.compressed]) {
      if (this.zoom === 'fit') {
        cv.style.width = '';
        cv.style.height = '';
        cv.style.maxWidth = '100%';
        cv.style.maxHeight = '100%';
      } else {
        cv.style.maxWidth = 'none';
        cv.style.maxHeight = 'none';
        cv.style.width = `${Math.round(cv.width * this.zoom)}px`;
        cv.style.height = `${Math.round(cv.height * this.zoom)}px`;
      }
    }
  }

  /** Show the clean composite. Also fixes document size for pointer mapping. */
  showClean(source: HTMLCanvasElement): void {
    this.docW = source.width;
    this.docH = source.height;
    resizeCanvas(this.clean, source.width, source.height);
    ctx2d(this.clean).drawImage(source, 0, 0);
    this.cleanDim.textContent = `${source.width} × ${source.height}`;
    this.applyZoom();
  }

  showCompressed(source: HTMLCanvasElement): void {
    resizeCanvas(this.compressed, source.width, source.height);
    ctx2d(this.compressed).drawImage(source, 0, 0);
    this.compressedDim.textContent = `${source.width} × ${source.height}`;
    this.applyZoom();
  }

  clearCompressed(): void {
    resizeCanvas(this.compressed, 1, 1);
    this.compressedDim.textContent = '';
  }

  /** Pointer position in document space, whichever canvas it came from. */
  private toDoc(ev: PointerEvent, canvas: HTMLCanvasElement): StrokeSample {
    const r = canvas.getBoundingClientRect();
    // A mouse reports 0.5 while held and 0 otherwise; a stylus reports its own.
    const pressure = ev.pointerType === 'mouse' || ev.pressure === 0 ? 0.5 : ev.pressure;
    if (r.width === 0 || r.height === 0) return { x: 0, y: 0, pressure };
    // Both canvases represent the same document, so normalising by the
    // displayed rect and scaling to document size covers the crunch geometry
    // and the zoom in one step.
    return {
      x: ((ev.clientX - r.left) / r.width) * this.docW,
      y: ((ev.clientY - r.top) / r.height) * this.docH,
      pressure,
    };
  }

  private attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      this.dragging = canvas;
      this.handlers.onDown(this.toDoc(ev, canvas));
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (this.dragging !== canvas) return;
      this.handlers.onMove(this.toDoc(ev, canvas));
    });
    const end = (ev: PointerEvent): void => {
      if (this.dragging !== canvas) return;
      this.dragging = null;
      this.handlers.onUp(this.toDoc(ev, canvas));
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
}
