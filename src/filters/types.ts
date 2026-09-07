import type { ParamSpec, ParamValues } from '../core/types';

/**
 * A filter transforms one canvas into another. It never sees the layer stack,
 * the store, or the DOM, which keeps every filter trivially testable and means
 * the same filter can later run on a selection or a preview thumbnail.
 */
export interface Filter {
  readonly id: string;
  readonly label: string;
  /** Groups the filter list into sections. */
  readonly group: string;
  readonly params: readonly ParamSpec[];
  apply(src: HTMLCanvasElement, values: ParamValues): HTMLCanvasElement;
}

export function num(values: ParamValues, key: string, fallback = 0): number {
  const v = values[key];
  return typeof v === 'number' ? v : fallback;
}

export function bool(values: ParamValues, key: string, fallback = false): boolean {
  const v = values[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(values: ParamValues, key: string, fallback = ''): string {
  const v = values[key];
  return typeof v === 'string' ? v : fallback;
}
