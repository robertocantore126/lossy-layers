import { clamp, copyCanvas, ctx2d, newCanvas } from '../core/canvas';
import type { ParamValues } from '../core/types';
import { canEncode, encodeAs, registerCodec, type Codec, type CodecPass } from './codecs';

function num(v: ParamValues, k: string, fallback: number): number {
  const x = v[k];
  return typeof x === 'number' ? x : fallback;
}
function flag(v: ParamValues, k: string, fallback: boolean): boolean {
  const x = v[k];
  return typeof x === 'boolean' ? x : fallback;
}

/** Round trip a canvas through a real image format. */
async function throughFormat(
  source: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<CodecPass> {
  const blob = encodeAs(source, mime, quality);
  if (!blob) {
    // The format is unavailable here; hand back the input untouched rather
    // than a PNG masquerading as a lossy pass.
    return { blob: new Blob([]), canvas: source };
  }
  const bmp = await createImageBitmap(blob);
  const out = newCanvas(source.width, source.height);
  const c = ctx2d(out);
  c.drawImage(bmp, 0, 0);
  bmp.close();
  return { blob, canvas: out };
}

const jpeg: Codec = {
  id: 'jpeg',
  label: 'JPEG',
  character: 'Eight-pixel blocks, ringing around hard edges, colour smeared across them.',
  params: [{ kind: 'range', key: 'quality', label: 'Quality', min: 1, max: 100, default: 24 }],
  run: (src, v) => throughFormat(src, 'image/jpeg', num(v, 'quality', 24) / 100),
};

const webp: Codec = {
  id: 'webp',
  label: 'WebP',
  character: 'Smears rather than blocks. Flat waxy patches and lost fine texture.',
  params: [{ kind: 'range', key: 'quality', label: 'Quality', min: 1, max: 100, default: 20 }],
  run: (src, v) => throughFormat(src, 'image/webp', num(v, 'quality', 20) / 100),
};

/* ------------------------------------------------------------------ palette */

interface Box {
  pixels: number[][];
  min: [number, number, number];
  max: [number, number, number];
}

function boxBounds(pixels: number[][]): Box {
  const min: [number, number, number] = [255, 255, 255];
  const max: [number, number, number] = [0, 0, 0];
  for (const p of pixels) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  }
  return { pixels, min, max };
}

/**
 * Median cut: split the colour cloud along its widest axis, repeatedly, then
 * average each box. Picks a palette from the image rather than from a fixed
 * grid, which is why it holds a photograph together at 16 colours where
 * uniform quantisation falls apart.
 */
function medianCut(samples: number[][], wanted: number): [number, number, number][] {
  let boxes: Box[] = [boxBounds(samples)];

  while (boxes.length < wanted) {
    // Split whichever box spans the most colour.
    let target = -1;
    let bestSpan = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (b.pixels.length < 2) continue;
      const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      if (span > bestSpan) {
        bestSpan = span;
        target = i;
      }
    }
    if (target < 0 || bestSpan === 0) break;

    const b = boxes[target]!;
    const spans = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const axis = spans.indexOf(Math.max(...spans));
    b.pixels.sort((p, q) => p[axis]! - q[axis]!);
    const mid = b.pixels.length >> 1;
    boxes.splice(target, 1, boxBounds(b.pixels.slice(0, mid)), boxBounds(b.pixels.slice(mid)));
  }

  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const p of b.pixels) {
      r += p[0]!;
      g += p[1]!;
      bl += p[2]!;
    }
    const n = Math.max(1, b.pixels.length);
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as [number, number, number];
  });
}

/**
 * Nearest-palette-colour for every 5-bit RGB cell.
 *
 * Searching the palette per pixel would be 380k times the palette size. One
 * lookup table over 32768 cells is built once and reused for the whole frame.
 */
function buildLut(palette: [number, number, number][]): Uint8Array {
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4;
        const G = g * 8 + 4;
        const B = b * 8 + 4;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < palette.length; i++) {
          const p = palette[i]!;
          const d = (R - p[0]) ** 2 + (G - p[1]) ** 2 + (B - p[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        lut[(r << 10) | (g << 5) | b] = best;
      }
    }
  }
  return lut;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Bits an index needs, rounded to what PNG actually supports. */
function indexDepth(colors: number): 1 | 2 | 4 | 8 {
  if (colors <= 2) return 1;
  if (colors <= 4) return 2;
  if (colors <= 16) return 4;
  return 8;
}

/**
 * What an indexed image really costs.
 *
 * The canvas PNG encoder always writes truecolour, so its file size says
 * nothing about the method: a 16-colour image comes back the same size as the
 * original. This packs the indices at their real bit depth, one filter byte
 * and byte-aligned rows exactly as PNG-8 does, deflates them, and adds the
 * palette. It is a measurement rather than an estimate.
 */
async function indexedPayloadSize(
  indices: Uint8Array,
  width: number,
  height: number,
  colors: number,
): Promise<number> {
  const depth = indexDepth(colors);
  const perByte = 8 / depth;
  const rowBytes = Math.ceil(width / perByte);
  const packed = new Uint8Array((rowBytes + 1) * height);

  let out = 0;
  for (let y = 0; y < height; y++) {
    packed[out++] = 0; // PNG filter type 0, the usual choice for indexed rows
    let acc = 0;
    let filled = 0;
    for (let x = 0; x < width; x++) {
      acc = (acc << depth) | (indices[y * width + x]! & ((1 << depth) - 1));
      filled += depth;
      if (filled === 8) {
        packed[out++] = acc & 0xff;
        acc = 0;
        filled = 0;
      }
    }
    if (filled > 0) packed[out++] = (acc << (8 - filled)) & 0xff;
  }

  let deflated = packed.length;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    void writer.write(packed);
    void writer.close();
    deflated = (await new Response(cs.readable).arrayBuffer()).byteLength;
  }
  // Palette chunk plus the fixed PNG chunk overhead.
  return deflated + colors * 3 + 60;
}

const indexed: Codec = {
  id: 'indexed',
  label: 'Indexed colour',
  character: 'A palette chosen from the image. Banding, and dot patterns where it dithers.',
  params: [
    { kind: 'range', key: 'colors', label: 'Colours', min: 2, max: 256, default: 24 },
    { kind: 'toggle', key: 'dither', label: 'Dither', default: true },
  ],
  async run(source, v) {
    const wanted = Math.max(2, Math.round(num(v, 'colors', 24)));
    const dither = flag(v, 'dither', true);

    const work = copyCanvas(source);
    const c = ctx2d(work);
    const img = c.getImageData(0, 0, work.width, work.height);
    const d = img.data;

    // Sample rather than sort every pixel; the palette barely differs and the
    // sort is the expensive part.
    const samples: number[][] = [];
    const stride = Math.max(1, Math.floor(d.length / 4 / 24000)) * 4;
    for (let i = 0; i < d.length; i += stride) {
      if (d[i + 3]! < 8) continue;
      samples.push([d[i]!, d[i + 1]!, d[i + 2]!]);
    }
    if (!samples.length) return { blob: new Blob([]), canvas: source };

    const palette = medianCut(samples, wanted);
    const lut = buildLut(palette);

    const w = work.width;
    const indices = new Uint8Array(w * work.height);
    for (let y = 0; y < work.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = d[i]!;
        let g = d[i + 1]!;
        let b = d[i + 2]!;
        if (dither) {
          // Nudge before quantising so flat areas break into a pattern
          // instead of a hard band.
          const t = ((BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5) * (256 / Math.cbrt(wanted));
          r = clamp(r + t, 0, 255);
          g = clamp(g + t, 0, 255);
          b = clamp(b + t, 0, 255);
        }
        const idx = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]!;
        indices[y * w + x] = idx;
        const p = palette[idx]!;
        d[i] = p[0];
        d[i + 1] = p[1];
        d[i + 2] = p[2];
      }
    }
    c.putImageData(img, 0, 0);

    // A saveable PNG for export, but the size we report is the indexed
    // payload, because that is what this method actually costs.
    const blob = encodeAs(work, 'image/png', 1) ?? new Blob([]);
    const reportedBytes = await indexedPayloadSize(indices, w, work.height, palette.length);
    return { blob, canvas: work, reportedBytes };
  },
};

/* ------------------------------------------------------------ chroma crush */

const chroma: Codec = {
  id: 'chroma',
  label: 'Chroma crush',
  character: 'Detail survives, colour does not. Hues bleed past the edges that hold them.',
  params: [
    { kind: 'range', key: 'factor', label: 'Colour resolution', min: 2, max: 40, default: 12, unit: '×' },
    { kind: 'range', key: 'quality', label: 'JPEG quality', min: 1, max: 100, default: 40 },
  ],
  async run(source, v) {
    const factor = Math.max(2, Math.round(num(v, 'factor', 12)));
    const quality = num(v, 'quality', 40) / 100;

    // Colour at a fraction of the resolution, brightness at full.
    const small = newCanvas(
      Math.max(1, Math.round(source.width / factor)),
      Math.max(1, Math.round(source.height / factor)),
    );
    const sc = ctx2d(small);
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(source, 0, 0, small.width, small.height);

    const blurred = newCanvas(source.width, source.height);
    const bc = ctx2d(blurred);
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, 0, 0, blurred.width, blurred.height);

    const out = copyCanvas(source);
    const oc = ctx2d(out);
    const full = oc.getImageData(0, 0, out.width, out.height);
    const low = bc.getImageData(0, 0, out.width, out.height);
    const f = full.data;
    const l = low.data;

    for (let i = 0; i < f.length; i += 4) {
      // Luma from the sharp image, colour difference from the soft one. This
      // is what 4:2:0 does, taken far past where a real encoder would stop.
      const y = 0.299 * f[i]! + 0.587 * f[i + 1]! + 0.114 * f[i + 2]!;
      const ly = 0.299 * l[i]! + 0.587 * l[i + 1]! + 0.114 * l[i + 2]!;
      const cb = l[i + 2]! - ly;
      const cr = l[i]! - ly;
      f[i] = clamp(y + cr, 0, 255);
      f[i + 2] = clamp(y + cb, 0, 255);
      f[i + 1] = clamp((y - 0.299 * f[i]! - 0.114 * f[i + 2]!) / 0.587, 0, 255);
    }
    oc.putImageData(full, 0, 0);

    return throughFormat(out, 'image/jpeg', quality);
  },
};

/* ------------------------------------------------------------ repost chain */

/**
 * An image passed between platforms, not one encoder run repeatedly.
 *
 * This is what actually happened to old internet images: saved as JPEG,
 * uploaded somewhere that re-encoded to WebP, saved again, resized by
 * whatever it landed on next, reposted. Each hop compresses the previous
 * hop's artifacts in a different format, and the two damage each other in a
 * way neither does alone. JPEG's block edges become real detail that WebP
 * then smears; WebP's flat patches give JPEG new edges to ring against.
 *
 * `passes` is the number of hops. Everything here needs the pass index,
 * which is why codecs get one.
 */
const repost: Codec = {
  id: 'repost',
  label: 'Repost chain',
  character: 'JPEG and WebP alternating, each hop a little worse. The look of an image saved and reuploaded too many times.',
  params: [
    { kind: 'range', key: 'jpegQuality', label: 'JPEG hops', min: 1, max: 100, default: 45 },
    { kind: 'range', key: 'webpQuality', label: 'WebP hops', min: 1, max: 100, default: 40 },
    { kind: 'range', key: 'decay', label: 'Quality lost per hop', min: 0, max: 12, default: 3 },
    { kind: 'range', key: 'resample', label: 'Resize per hop', min: 0, max: 60, default: 0, unit: '%' },
    {
      kind: 'choice',
      key: 'start',
      label: 'First hop',
      options: [
        { value: 'jpeg', label: 'JPEG first' },
        { value: 'webp', label: 'WebP first' },
      ],
      default: 'jpeg',
    },
  ],
  async run(source, v, pass) {
    const startsJpeg = (v['start'] ?? 'jpeg') !== 'webp';
    const jpegFirst = pass.index % 2 === 0 ? startsJpeg : !startsJpeg;
    const mime = jpegFirst || !canEncode('image/webp') ? 'image/jpeg' : 'image/webp';

    const base = num(v, jpegFirst ? 'jpegQuality' : 'webpQuality', 40);
    // Every hop starts from an already-degraded copy, so the chain gets worse
    // even before the encoder settings do.
    const quality = clamp(base - num(v, 'decay', 3) * pass.index, 1, 100) / 100;

    let staged = source;
    const shrink = num(v, 'resample', 0) / 100;
    if (shrink > 0) {
      // Platforms resize, and the image gets viewed back at full size. The
      // round trip costs real detail on top of whatever the encoder takes.
      const w = Math.max(1, Math.round(source.width * (1 - shrink)));
      const h = Math.max(1, Math.round(source.height * (1 - shrink)));
      const small = newCanvas(w, h);
      const sc = ctx2d(small);
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(source, 0, 0, w, h);

      staged = newCanvas(source.width, source.height);
      const bc = ctx2d(staged);
      bc.imageSmoothingQuality = 'high';
      bc.drawImage(small, 0, 0, source.width, source.height);
    }

    return throughFormat(staged, mime, quality);
  },
};

export function registerBuiltinCodecs(): void {
  registerCodec(jpeg);
  // Only offer a format this browser can really encode. A silent PNG
  // fallback would look like a codec that never damages anything.
  if (canEncode('image/webp')) registerCodec(webp);
  registerCodec(indexed);
  registerCodec(chroma);
  // Needs both formats to alternate; with one it would just be that one.
  if (canEncode('image/webp')) registerCodec(repost);
}
