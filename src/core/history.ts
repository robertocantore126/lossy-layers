import type { DocState, Layer } from './types';
import type { Store } from './store';

interface Snapshot {
  width: number;
  height: number;
  matte: string;
  activeId: number | null;
  layers: Layer[];
}

const LIMIT = 30;

/**
 * Undo by snapshotting the layer array with pixels shared by reference.
 *
 * A snapshot therefore costs an array, not a stack of canvases. The
 * arrangement only holds because `Store.detach` gives a layer fresh pixels
 * before anything writes to it, so a snapshot taken earlier keeps pointing at
 * the pixels it captured. Call `push` *before* mutating, always.
 */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<() => void>();

  constructor(private store: Store) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private capture(): Snapshot {
    const d = this.store.doc;
    return {
      width: d.width,
      height: d.height,
      matte: d.matte,
      activeId: d.activeId,
      layers: d.layers.map((l) => ({ ...l })),
    };
  }

  push(): void {
    this.undoStack.push(this.capture());
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  private apply(s: Snapshot): void {
    const doc: DocState = {
      width: s.width,
      height: s.height,
      matte: s.matte,
      activeId: s.activeId,
      layers: s.layers.map((l) => ({ ...l })),
    };
    this.store.doc = doc;
    this.store.emit();
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.capture());
    this.apply(s);
    this.emit();
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.capture());
    this.apply(s);
    this.emit();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }
}
