import { copyCanvas, ctx2d, newCanvas } from '../core/canvas';

export interface CrunchSettings {
  /** 1..100, the JPEG quality handed to the encoder. */
  quality: number;
  /** How many times to re-encode. Each pass eats the previous one's artifacts. */
  passes: number;
  /** Longest side before encoding; 0 keeps the document size. */
  maxDimension: number;
  squishX: number;
  squishY: number;
  border: { enabled: boolean; width: number; color: string };
}

export function defaultCrunch(): CrunchSettings {
  return {
    quality: 24,
    passes: 1,
    maxDimension: 0,
    squishX: 1,
    squishY: 1,
    border: { enabled: false, width: 14, color: 'rgb(255,0,0)' },
  };
}

export interface CrunchResult {
  canvas: HTMLCanvasElement;
  blob: Blob | null;
  passes: number;
  elapsedMs: number;
}

/** Geometry applied before the encoder sees anything. Pure scaling, so a
 *  point on the output maps back to the document by dividing it out. */
export function crunchGeometry(w: number, h: number, s: CrunchSettings): { w: number; h: number } {
  let ow = w;
  let oh = h;
  if (s.maxDimension && Math.max(ow, oh) > s.maxDimension) {
    const r = s.maxDimension / Math.max(ow, oh);
    ow = Math.round(ow * r);
    oh = Math.round(oh * r);
  }
  return {
    w: Math.max(1, Math.round(ow * s.squishX)),
    h: Math.max(1, Math.round(oh * s.squishY)),
  };
}

function buildStage(source: HTMLCanvasElement, s: CrunchSettings): HTMLCanvasElement {
  const g = crunchGeometry(source.width, source.height, s);
  const stage = newCanvas(g.w, g.h);
  const c = ctx2d(stage);
  c.imageSmoothingQuality = 'high';
  c.drawImage(source, 0, 0, g.w, g.h);
  if (s.border.enabled && s.border.width > 0) {
    c.lineWidth = s.border.width;
    c.strokeStyle = s.border.color;
    // Inset by half so the stroke lands inside the frame, as Pillow draws it.
    c.strokeRect(s.border.width / 2, s.border.width / 2, g.w - s.border.width, g.h - s.border.width);
  }
  return stage;
}

/** A cancellation token. `crunch` bails as soon as `cancelled()` turns true. */
export type Cancelled = () => boolean;

/**
 * Decode a data URL into the bytes it stands for.
 *
 * We encode with `toDataURL` rather than `toBlob` on purpose. The encoders
 * produce identical JPEG bytes, but `toBlob` and `OffscreenCanvas
 * .convertToBlob` deliver their result through a scheduled callback that some
 * embedders throttle to roughly one per second. Measured on this pipeline:
 * 2 ms synchronous versus 1005 ms through the callback, which at thirty
 * passes is the difference between instant and half a minute. Decoding is
 * never throttled, so only the encode side has to avoid the callback.
 */
function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data URL from the canvas encoder');
  const mime = /:(.*?);/.exec(url.slice(0, comma))?.[1] ?? 'image/jpeg';
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** One JPEG round trip: encode the canvas, hand back the exact bytes. */
export function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Blob {
  return dataUrlToBlob(canvas.toDataURL('image/jpeg', quality));
}

/**
 * Re-encode `source` as JPEG, `passes` times, decoding between each one.
 *
 * This is the whole point of the app: a single pass is ordinary compression,
 * and repeated passes are generation loss, where each encode is fed the
 * previous encode's own artifacts.
 */
export async function crunch(
  source: HTMLCanvasElement,
  settings: CrunchSettings,
  passes: number,
  cancelled: Cancelled = () => false,
): Promise<CrunchResult> {
  const t0 = performance.now();
  const work = copyCanvas(buildStage(source, settings));
  const wctx = ctx2d(work);
  const q = settings.quality / 100;
  let last: Blob | null = null;

  for (let i = 0; i < passes; i++) {
    if (cancelled()) break;
    const blob = encodeJpeg(work, q);
    last = blob;
    if (cancelled()) break;
    const bmp = await createImageBitmap(blob);
    wctx.clearRect(0, 0, work.width, work.height);
    wctx.drawImage(bmp, 0, 0);
    bmp.close();
  }

  return { canvas: work, blob: last, passes, elapsedMs: performance.now() - t0 };
}
