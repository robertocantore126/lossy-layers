/** Canvas plumbing everything else builds on. */

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A 2D context, or a thrown error — every caller needs one and none can recover. */
export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas context unavailable');
  return x;
}

export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function resizeCanvas(c: HTMLCanvasElement, w: number, h: number): void {
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
}

export function clear(c: HTMLCanvasElement): void {
  ctx2d(c).clearRect(0, 0, c.width, c.height);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Scale factor that fits `w x h` inside `maxW x maxH`, never enlarging past 1. */
export function fitScale(w: number, h: number, maxW: number, maxH: number): number {
  return Math.min(1, Math.min(maxW / w, maxH / h));
}

export function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), type, quality));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image failed to decode'));
    i.src = src;
  });
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
