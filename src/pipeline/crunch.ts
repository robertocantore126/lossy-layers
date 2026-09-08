import { ctx2d, newCanvas } from '../core/canvas';
import { defaultsOf, type ParamValues } from '../core/types';
import { getCodec, type Codec } from './codecs';

/**
 * How faithful the preview stays while you are dragging.
 *
 * `full` always shows the real result, which is what you want when judging a
 * method. `fast` drops to a single pass, which was the old fixed behaviour
 * and makes a strong method look weak mid-stroke. `adaptive` fits as many
 * passes as the frame budget allows.
 */
export type LivePreview = 'full' | 'adaptive' | 'fast';

export interface CrunchSettings {
  /** Which compression method runs. See `pipeline/codecs`. */
  codecId: string;
  livePreview: LivePreview;
  /** Kept per codec, so switching back and forth remembers your settings. */
  codecParams: Record<string, ParamValues>;
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
    codecId: 'jpeg',
    livePreview: 'full',
    codecParams: {},
    passes: 1,
    maxDimension: 0,
    squishX: 1,
    squishY: 1,
    border: { enabled: false, width: 14, color: 'rgb(255,0,0)' },
  };
}

/** The parameter values for a codec, filling in defaults on first use. */
export function paramsFor(settings: CrunchSettings, codec: Codec): ParamValues {
  let values = settings.codecParams[codec.id];
  if (!values) {
    values = defaultsOf(codec.params);
    settings.codecParams[codec.id] = values;
  }
  return values;
}

export interface CrunchResult {
  canvas: HTMLCanvasElement;
  /** A saveable file, for export. */
  blob: Blob | null;
  /** What the method actually costs, which is not always the file's size. */
  bytes: number;
  passes: number;
  elapsedMs: number;
}

/**
 * Geometry applied before the codec sees anything. Pure scaling, so a point
 * on the output maps back to the document by dividing it out.
 */
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
 * Run the selected compression method over the image, `passes` times.
 *
 * A single pass is ordinary compression. Repeated passes are generation loss,
 * where each round is handed the previous round's own artifacts to compress
 * again, which is where the look comes from.
 */
export async function crunch(
  source: HTMLCanvasElement,
  settings: CrunchSettings,
  passes: number,
  cancelled: Cancelled = () => false,
): Promise<CrunchResult> {
  const t0 = performance.now();
  const codec = getCodec(settings.codecId) ?? getCodec('jpeg');
  // buildStage already hands back a canvas of its own, so there is nothing
  // here to protect the caller from and nothing to copy.
  let work = buildStage(source, settings);
  let last: Blob | null = null;
  let bytes = 0;

  if (!codec) return { canvas: work, blob: null, bytes: 0, passes: 0, elapsedMs: 0 };
  const values = paramsFor(settings, codec);

  for (let i = 0; i < passes; i++) {
    if (cancelled()) break;
    const pass = await codec.run(work, values, { index: i, total: passes });
    if (cancelled()) break;
    if (pass.blob.size > 0) {
      last = pass.blob;
      bytes = pass.reportedBytes ?? pass.blob.size;
    }
    work = pass.canvas;
  }

  return { canvas: work, blob: last, bytes, passes, elapsedMs: performance.now() - t0 };
}
