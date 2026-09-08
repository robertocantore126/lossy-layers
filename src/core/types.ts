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

/** Which surface of a layer the tools write to. */
export type EditTarget = 'pixels' | 'mask';

export interface Layer {
  id: number;
  name: string;
  /** The layer's own pixels, at its own natural size. */
  canvas: HTMLCanvasElement;
  /**
   * Optional alpha mask, same size as `canvas`.
   *
   * Stored as an alpha channel rather than greyscale: opaque means the layer
   * shows, transparent means it is hidden, and the compositor applies it with
   * one `destination-in`. Painting the mask never touches the layer's own
   * pixels, which is the whole point of blending a collage this way.
   */
  mask: HTMLCanvasElement | null;
  /** A mask can be held without being applied, so you can compare. */
  maskEnabled: boolean;
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
  /** Whether the stroke lands on the layer's pixels or on its mask. */
  target: EditTarget;
  /** How the buffer merges into that surface. */
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
