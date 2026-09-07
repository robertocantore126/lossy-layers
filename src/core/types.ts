/** Shared vocabulary for the whole editor. */

/** Canvas composite operations we expose as layer blend modes. */
export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'lighten'
  | 'darken'
  | 'difference'
  | 'exclusion'
  | 'hard-light'
  | 'soft-light'
  | 'color-dodge'
  | 'color-burn'
  | 'lighter';

export const BLEND_MODES: readonly BlendMode[] = [
  'source-over', 'multiply', 'screen', 'overlay', 'lighten', 'darken',
  'difference', 'exclusion', 'hard-light', 'soft-light', 'color-dodge',
  'color-burn', 'lighter',
];

export const BLEND_LABELS: Record<BlendMode, string> = {
  'source-over': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'lighten': 'Lighten',
  'darken': 'Darken',
  'difference': 'Difference',
  'exclusion': 'Exclusion',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  'color-dodge': 'Dodge',
  'color-burn': 'Burn',
  'lighter': 'Add',
};

export type LayerKind = 'image' | 'paint';

export interface Layer {
  id: number;
  name: string;
  /** The layer's own pixels, at its own natural size. */
  canvas: HTMLCanvasElement;
  /** Placement in document space. */
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  kind: LayerKind;
}

export interface DocState {
  width: number;
  height: number;
  /** JPEG has no alpha, so erased areas fall through to this. */
  matte: string;
  /** Bottom-first, matching paint order. */
  layers: Layer[];
  activeId: number | null;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A stroke in progress. The compositor draws it over its layer without
 * committing, so the layer's pixels stay untouched until the pointer lifts.
 */
export interface StrokeOverlay {
  layerId: number;
  buffer: HTMLCanvasElement;
  /** How the buffer merges into its layer. */
  mode: GlobalCompositeOperation;
  alpha: number;
}

/** Parameters a tool or filter exposes to the options panel. */
export type ParamSpec =
  | { kind: 'range'; key: string; label: string; min: number; max: number; step?: number; unit?: string; default: number }
  | { kind: 'toggle'; key: string; label: string; default: boolean }
  | { kind: 'color'; key: string; label: string; default: string }
  | { kind: 'choice'; key: string; label: string; options: { value: string; label: string }[]; default: string };

export type ParamValues = Record<string, number | boolean | string>;

export function defaultsOf(specs: readonly ParamSpec[]): ParamValues {
  const out: ParamValues = {};
  for (const s of specs) out[s.key] = s.default;
  return out;
}
