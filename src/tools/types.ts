import type { Brush, BrushSettings } from '../core/brush';
import type { History } from '../core/history';
import type { Store } from '../core/store';
import type { Point, StrokeOverlay } from '../core/types';

/** Everything a tool is allowed to reach. Tools never touch the DOM shell. */
export interface ToolContext {
  store: Store;
  history: History;
  brush: Brush;
  brushSettings: BrushSettings;
  /** `fast` renders a single compression pass so dragging stays responsive. */
  requestRender(fast: boolean): void;
  /** Rebuild the tool's own options panel, after a tool changes its settings. */
  refreshOptions(): void;
}

/**
 * A tool owns pointer behaviour and its own options panel.
 *
 * Adding one means writing a file here and registering it; nothing in the UI
 * shell needs to know the tool exists.
 */
export interface Tool {
  readonly id: string;
  readonly label: string;
  /** Inner SVG markup, drawn into a 24x24 stroked viewBox by the toolbar. */
  readonly icon: string;
  readonly hint: string;
  /** Single character, matched case-insensitively. */
  readonly shortcut?: string;

  /** Build the options panel. Called whenever the tool or selection changes. */
  buildOptions(host: HTMLElement, ctx: ToolContext): void;

  onPointerDown(p: Point, ctx: ToolContext): void;
  onPointerMove(p: Point, ctx: ToolContext): void;
  onPointerUp(p: Point, ctx: ToolContext): void;

  /** The in-progress stroke, if this tool has one to show. */
  overlay?(): StrokeOverlay | null;
}
