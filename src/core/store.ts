import type { BlendMode, DocState, Layer, LayerKind } from './types';
import { copyCanvas, ctx2d, fitScale, newCanvas } from './canvas';

/** Longest side we keep at full fidelity. Anything larger is sampled down on import. */
export const MAX_DOC = 2400;

type Listener = () => void;

/**
 * The document and every operation that mutates it.
 *
 * Layer pixels are shared by reference with history snapshots, so anything
 * that writes pixels must call `detach` first. That copy-on-write is what
 * keeps undo to one canvas copy per edit instead of a copy of the whole stack.
 */
export class Store {
  doc: DocState = { width: 900, height: 600, matte: '#000000', layers: [], activeId: null };

  private nextId = 1;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---------------------------------------------------------------- queries

  get layers(): Layer[] {
    return this.doc.layers;
  }

  activeLayer(): Layer | null {
    return this.doc.layers.find((l) => l.id === this.doc.activeId) ?? null;
  }

  activeIndex(): number {
    return this.doc.layers.findIndex((l) => l.id === this.doc.activeId);
  }

  layerById(id: number): Layer | null {
    return this.doc.layers.find((l) => l.id === id) ?? null;
  }

  // ---------------------------------------------------------------- mutation

  /** Give a layer its own pixels so existing history snapshots stay valid. */
  detach(layer: Layer): void {
    layer.canvas = copyCanvas(layer.canvas);
  }

  makeLayer(canvas: HTMLCanvasElement, name: string, kind: LayerKind = 'paint'): Layer {
    return {
      id: this.nextId++,
      name,
      canvas,
      x: 0,
      y: 0,
      scale: 1,
      visible: true,
      opacity: 1,
      blend: 'source-over',
      kind,
    };
  }

  /** Keeps ids unique after a project load hands us layers made elsewhere. */
  reserveIds(usedMax: number): void {
    this.nextId = Math.max(this.nextId, usedMax + 1);
  }

  addPaintLayer(): Layer {
    const l = this.makeLayer(newCanvas(this.doc.width, this.doc.height), `Layer ${this.nextId}`, 'paint');
    this.doc.layers.push(l);
    this.doc.activeId = l.id;
    this.emit();
    return l;
  }

  /**
   * Import an image as its own layer. The first image also sets the document
   * size, which is why this is the only place the canvas dimensions move.
   */
  addImageLayer(img: CanvasImageSource, natW: number, natH: number, name: string): Layer {
    if (this.doc.layers.length === 0) {
      let dw = natW;
      let dh = natH;
      if (Math.max(dw, dh) > MAX_DOC) {
        const r = MAX_DOC / Math.max(dw, dh);
        dw = Math.round(dw * r);
        dh = Math.round(dh * r);
      }
      this.doc.width = dw;
      this.doc.height = dh;
    }

    let cw = natW;
    let ch = natH;
    if (Math.max(cw, ch) > MAX_DOC) {
      const r = MAX_DOC / Math.max(cw, ch);
      cw = Math.round(cw * r);
      ch = Math.round(ch * r);
    }

    const canvas = newCanvas(cw, ch);
    const c = ctx2d(canvas);
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, cw, ch);

    const l = this.makeLayer(canvas, name, 'image');
    l.scale = fitScale(cw, ch, this.doc.width, this.doc.height);
    this.centre(l);

    this.doc.layers.push(l);
    this.doc.activeId = l.id;
    this.emit();
    return l;
  }

  centre(l: Layer): void {
    l.x = Math.round((this.doc.width - l.canvas.width * l.scale) / 2);
    l.y = Math.round((this.doc.height - l.canvas.height * l.scale) / 2);
  }

  fitToCanvas(l: Layer): void {
    l.scale = Math.min(this.doc.width / l.canvas.width, this.doc.height / l.canvas.height);
    this.centre(l);
  }

  duplicateActive(): Layer | null {
    const l = this.activeLayer();
    if (!l) return null;
    const d = this.makeLayer(copyCanvas(l.canvas), `${l.name} copy`, l.kind);
    d.x = l.x;
    d.y = l.y;
    d.scale = l.scale;
    d.opacity = l.opacity;
    d.blend = l.blend;
    this.doc.layers.splice(this.activeIndex() + 1, 0, d);
    this.doc.activeId = d.id;
    this.emit();
    return d;
  }

  deleteActive(): void {
    const i = this.activeIndex();
    if (i < 0) return;
    this.doc.layers.splice(i, 1);
    this.doc.activeId = this.doc.layers.length ? this.doc.layers[Math.max(0, i - 1)]!.id : null;
    this.emit();
  }

  /** `dir` is +1 toward the top of the stack. */
  moveActive(dir: 1 | -1): void {
    const i = this.activeIndex();
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.doc.layers.length) return;
    const t = this.doc.layers[i]!;
    this.doc.layers[i] = this.doc.layers[j]!;
    this.doc.layers[j] = t;
    this.emit();
  }

  /** Drop a layer at an absolute position in the stack, for drag reordering. */
  moveLayerTo(id: number, index: number): boolean {
    const from = this.doc.layers.findIndex((l) => l.id === id);
    if (from < 0) return false;
    const to = Math.max(0, Math.min(this.doc.layers.length - 1, Math.round(index)));
    if (from === to) return false;
    const [moved] = this.doc.layers.splice(from, 1);
    this.doc.layers.splice(to, 0, moved!);
    this.emit();
    return true;
  }

  mergeDown(): void {
    const i = this.activeIndex();
    if (i < 1) return;
    const top = this.doc.layers[i]!;
    const bottom = this.doc.layers[i - 1]!;

    // Merge in document space, then hand the result back as a full-size layer.
    const merged = newCanvas(this.doc.width, this.doc.height);
    const c = ctx2d(merged);
    for (const l of [bottom, top]) {
      if (!l.visible) continue;
      c.save();
      c.globalAlpha = l.opacity;
      c.globalCompositeOperation = l.blend;
      c.drawImage(l.canvas, l.x, l.y, l.canvas.width * l.scale, l.canvas.height * l.scale);
      c.restore();
    }

    const out = this.makeLayer(merged, bottom.name, 'paint');
    this.doc.layers.splice(i - 1, 2, out);
    this.doc.activeId = out.id;
    this.emit();
  }

  setBlend(l: Layer, blend: BlendMode): void {
    l.blend = blend;
    this.emit();
  }

  select(id: number): void {
    this.doc.activeId = id;
    this.emit();
  }

  /** Replace the whole document, as a project load does. */
  load(doc: DocState): void {
    this.doc = doc;
    this.reserveIds(doc.layers.reduce((m, l) => Math.max(m, l.id), 0));
    this.emit();
  }
}
