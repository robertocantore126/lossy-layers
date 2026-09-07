import { clamp, ctx2d, newCanvas } from '../core/canvas';
import type { ParamValues } from '../core/types';
import { registerFilter } from './registry';
import { num, type Filter } from './types';

function sameSize(src: HTMLCanvasElement): { out: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const out = newCanvas(src.width, src.height);
  return { out, c: ctx2d(out) };
}

/** Splits the colour channels sideways, the way a cheap lens fringes an edge. */
const chromatic: Filter = {
  id: 'chromatic',
  label: 'Chromatic aberration',
  group: 'Optical',
  params: [
    { kind: 'range', key: 'shift', label: 'Shift', min: 0, max: 40, default: 6, unit: ' px' },
    { kind: 'range', key: 'angle', label: 'Angle', min: 0, max: 360, default: 0, unit: '°' },
  ],
  apply(src, values) {
    const shift = num(values, 'shift', 6);
    const rad = (num(values, 'angle', 0) * Math.PI) / 180;
    const dx = Math.cos(rad) * shift;
    const dy = Math.sin(rad) * shift;
    const { out, c } = sameSize(src);

    // Draw the same image three times, each time keeping one channel.
    const passes: [number, number, string][] = [
      [dx, dy, 'rgb(255,0,0)'],
      [0, 0, 'rgb(0,255,0)'],
      [-dx, -dy, 'rgb(0,0,255)'],
    ];
    for (const [ox, oy, keep] of passes) {
      const tmp = newCanvas(src.width, src.height);
      const t = ctx2d(tmp);
      t.drawImage(src, ox, oy);
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = keep;
      t.fillRect(0, 0, tmp.width, tmp.height);
      // Restore the alpha the multiply just flattened.
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(src, ox, oy);

      c.globalCompositeOperation = 'lighter';
      c.drawImage(tmp, 0, 0);
    }
    return out;
  },
};

/** Horizontal slice displacement: the classic torn-signal look. */
const glitch: Filter = {
  id: 'glitch',
  label: 'Slice glitch',
  group: 'Damage',
  params: [
    { kind: 'range', key: 'slices', label: 'Slices', min: 1, max: 60, default: 14 },
    { kind: 'range', key: 'amount', label: 'Displacement', min: 0, max: 200, default: 40, unit: ' px' },
    { kind: 'range', key: 'seed', label: 'Seed', min: 0, max: 999, default: 7 },
  ],
  apply(src, values) {
    const slices = Math.max(1, Math.round(num(values, 'slices', 14)));
    const amount = num(values, 'amount', 40);
    let seed = num(values, 'seed', 7) + 1;
    const rand = (): number => {
      // Small deterministic PRNG so the same seed gives the same tear.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const { out, c } = sameSize(src);
    const h = src.height / slices;
    for (let i = 0; i < slices; i++) {
      const y = i * h;
      const dx = (rand() * 2 - 1) * amount;
      c.drawImage(src, 0, y, src.width, h, dx, y, src.width, h);
      // Wrap the slice so no gap is left at the edge.
      c.drawImage(src, 0, y, src.width, h, dx + (dx > 0 ? -src.width : src.width), y, src.width, h);
    }
    return out;
  },
};

/** Ordered dithering on a 4x4 Bayer matrix, then a hard colour-depth cut. */
const dither: Filter = {
  id: 'dither',
  label: 'Ordered dither',
  group: 'Damage',
  params: [
    { kind: 'range', key: 'levels', label: 'Levels per channel', min: 2, max: 16, default: 4 },
    { kind: 'range', key: 'strength', label: 'Strength', min: 0, max: 100, default: 100, unit: '%' },
  ],
  apply(src, values) {
    const levels = Math.max(2, Math.round(num(values, 'levels', 4)));
    const strength = num(values, 'strength', 100) / 100;
    const { out, c } = sameSize(src);
    c.drawImage(src, 0, 0);
    const img = c.getImageData(0, 0, out.width, out.height);
    const d = img.data;

    const bayer = [
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ];
    const step = 255 / (levels - 1);

    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const i = (y * out.width + x) * 4;
        const threshold = ((bayer[(y % 4) * 4 + (x % 4)]! + 0.5) / 16 - 0.5) * step * strength;
        for (let ch = 0; ch < 3; ch++) {
          const v = d[i + ch]! + threshold;
          d[i + ch] = clamp(Math.round(v / step) * step, 0, 255);
        }
      }
    }
    c.putImageData(img, 0, 0);
    return out;
  },
};

/** Darkened lines across the image, like an interlaced display. */
const scanlines: Filter = {
  id: 'scanlines',
  label: 'Scanlines',
  group: 'Optical',
  params: [
    { kind: 'range', key: 'gap', label: 'Line spacing', min: 2, max: 24, default: 4, unit: ' px' },
    { kind: 'range', key: 'strength', label: 'Darkness', min: 0, max: 100, default: 45, unit: '%' },
  ],
  apply(src, values) {
    const gap = Math.max(2, Math.round(num(values, 'gap', 4)));
    const strength = num(values, 'strength', 45) / 100;
    const { out, c } = sameSize(src);
    c.drawImage(src, 0, 0);
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = `rgba(0,0,0,${strength})`;
    for (let y = 0; y < out.height; y += gap) {
      c.fillRect(0, y, out.width, Math.max(1, Math.floor(gap / 2)));
    }
    c.restore();
    return out;
  },
};

/** Per-pixel noise, monochrome or coloured. */
const noise: Filter = {
  id: 'noise',
  label: 'Noise',
  group: 'Damage',
  params: [
    { kind: 'range', key: 'amount', label: 'Amount', min: 0, max: 100, default: 18, unit: '%' },
    { kind: 'toggle', key: 'colored', label: 'Coloured', default: false },
  ],
  apply(src, values) {
    const amount = (num(values, 'amount', 18) / 100) * 255;
    const colored = values['colored'] === true;
    const { out, c } = sameSize(src);
    c.drawImage(src, 0, 0);
    const img = c.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (colored) {
        d[i] = clamp(d[i]! + (Math.random() - 0.5) * amount, 0, 255);
        d[i + 1] = clamp(d[i + 1]! + (Math.random() - 0.5) * amount, 0, 255);
        d[i + 2] = clamp(d[i + 2]! + (Math.random() - 0.5) * amount, 0, 255);
      } else {
        const n = (Math.random() - 0.5) * amount;
        d[i] = clamp(d[i]! + n, 0, 255);
        d[i + 1] = clamp(d[i + 1]! + n, 0, 255);
        d[i + 2] = clamp(d[i + 2]! + n, 0, 255);
      }
    }
    c.putImageData(img, 0, 0);
    return out;
  },
};

/** Brightness, contrast and saturation in one pass, via the native filter. */
const levels: Filter = {
  id: 'levels',
  label: 'Brightness and contrast',
  group: 'Adjust',
  params: [
    { kind: 'range', key: 'brightness', label: 'Brightness', min: 0, max: 300, default: 100, unit: '%' },
    { kind: 'range', key: 'contrast', label: 'Contrast', min: 0, max: 300, default: 100, unit: '%' },
    { kind: 'range', key: 'saturate', label: 'Saturation', min: 0, max: 300, default: 100, unit: '%' },
    { kind: 'range', key: 'hue', label: 'Hue shift', min: 0, max: 360, default: 0, unit: '°' },
  ],
  apply(src, values: ParamValues) {
    const { out, c } = sameSize(src);
    c.filter = [
      `brightness(${num(values, 'brightness', 100)}%)`,
      `contrast(${num(values, 'contrast', 100)}%)`,
      `saturate(${num(values, 'saturate', 100)}%)`,
      `hue-rotate(${num(values, 'hue', 0)}deg)`,
    ].join(' ');
    c.drawImage(src, 0, 0);
    return out;
  },
};

/** Gaussian blur, again through the native filter so it stays fast. */
const blur: Filter = {
  id: 'blur',
  label: 'Blur',
  group: 'Adjust',
  params: [{ kind: 'range', key: 'radius', label: 'Radius', min: 0, max: 60, step: 0.5, default: 3, unit: ' px' }],
  apply(src, values) {
    const { out, c } = sameSize(src);
    c.filter = `blur(${num(values, 'radius', 3)}px)`;
    c.drawImage(src, 0, 0);
    return out;
  },
};

/** Snap the image to a coarse grid of blocks. */
const pixelate: Filter = {
  id: 'pixelate',
  label: 'Pixelate',
  group: 'Damage',
  params: [{ kind: 'range', key: 'block', label: 'Block size', min: 2, max: 64, default: 8, unit: ' px' }],
  apply(src, values) {
    const block = Math.max(2, Math.round(num(values, 'block', 8)));
    const w = Math.max(1, Math.round(src.width / block));
    const h = Math.max(1, Math.round(src.height / block));
    const small = newCanvas(w, h);
    const sc = ctx2d(small);
    sc.imageSmoothingEnabled = true;
    sc.drawImage(src, 0, 0, w, h);

    const { out, c } = sameSize(src);
    c.imageSmoothingEnabled = false;
    c.drawImage(small, 0, 0, out.width, out.height);
    return out;
  },
};

export function registerBuiltinFilters(): void {
  for (const f of [levels, blur, chromatic, scanlines, glitch, dither, noise, pixelate]) {
    registerFilter(f);
  }
}
