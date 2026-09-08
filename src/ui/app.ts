import { Brush, defaultBrush, type BrushSettings, type StrokeSample } from '../core/brush';
import { formatBytes } from '../core/canvas';
import { Compositor } from '../core/compositor';
import { History } from '../core/history';
import { Store } from '../core/store';
import type { EditTarget } from '../core/types';
import { registerBuiltinFilters } from '../filters/builtin';
import { allFilters } from '../filters/registry';
import { acceptFiles, IMAGE_TYPES } from '../io/files';
import { deserialize, PROJECT_EXTENSION, projectBlob, serialize } from '../io/project';
import { saveFile } from '../io/save';
import { registerBuiltinCodecs } from '../pipeline/builtinCodecs';
import { allCodecs, getCodec } from '../pipeline/codecs';
import { crunch, defaultCrunch, paramsFor, type CrunchSettings } from '../pipeline/crunch';
import { registerTool, allTools, getTool, toolForShortcut } from '../tools/registry';
import { brushTool, eraserTool } from '../tools/paint';
import { moveTool } from '../tools/move';
import { gradientTool } from '../tools/gradient';
import type { Tool, ToolContext } from '../tools/types';
import { el } from './controls';
import { CrunchPanel } from './crunchPanel';
import { FilterPanel } from './filterPanel';
import { LayerPanel } from './layerPanel';
import { openNewDocument } from './newDocument';
import { seedDocument } from './seed';
import { Viewport, type ViewMode, type Zoom } from './viewport';

export class App {
  private store = new Store();
  private history = new History(this.store);
  private compositor = new Compositor();
  private brush = new Brush();

  private brushSettings: BrushSettings = defaultBrush();
  /** Which surface of the active layer the tools write to. */
  private editTarget: EditTarget = 'pixels';
  private crunchSettings: CrunchSettings = defaultCrunch();

  private tool: Tool;
  private viewport: Viewport;
  private layerPanel: LayerPanel;
  private filterPanel: FilterPanel;
  private crunchPanel: CrunchPanel;

  private toolButtons = new Map<string, HTMLButtonElement>();
  private optionsHost = el('div', 'block');
  private toolHint = el('p', 'hint');
  private stats: Record<string, HTMLElement> = {};
  private historyButtons: Record<string, HTMLButtonElement> = {};
  private statusEl = el('p', 'note');

  /** Cost of the last full render, used to budget the drag preview. */
  private lastFullMs = 0;
  private lastFullPasses = 0;

  private renderSeq = 0;
  private renderBusy = false;
  private renderQueued: false | 'fast' | 'full' = false;

  constructor(private mount: HTMLElement) {
    registerBuiltinFilters();
    registerBuiltinCodecs();
    registerTool(moveTool);
    registerTool(brushTool);
    registerTool(eraserTool);
    registerTool(gradientTool);
    this.tool = eraserTool;

    this.viewport = new Viewport({
      onDown: (p) => this.dispatch('down', p),
      onMove: (p) => this.dispatch('move', p),
      onUp: (p) => this.dispatch('up', p),
    });

    this.layerPanel = new LayerPanel(
      this.store,
      this.history,
      () => {
        this.buildToolOptions();
        this.refresh(false);
      },
      () => this.resolvedTarget(),
      (t) => { this.editTarget = t; },
    );
    this.filterPanel = new FilterPanel(this.store, this.history, () => this.refresh(true));
    this.crunchPanel = new CrunchPanel(
      this.crunchSettings,
      () => this.store.doc.matte,
      (v) => { this.store.doc.matte = v; },
      (fast) => this.refresh(fast),
    );

    this.build();
    this.history.subscribe(() => this.syncHistoryButtons());

    seedDocument(this.store);
    this.layerPanel.render();
    this.buildToolOptions();
    this.refresh(false);
  }

  // ------------------------------------------------------------- tool context

  private context(): ToolContext {
    return {
      store: this.store,
      history: this.history,
      brush: this.brush,
      brushSettings: this.brushSettings,
      target: this.resolvedTarget(),
      requestRender: (fast) => this.refresh(fast),
      refreshOptions: () => this.buildToolOptions(),
    };
  }

  /**
   * The edit target, guarded: a layer with no mask can only be painted on
   * directly, so the tools never have to check for a missing surface.
   */
  private resolvedTarget(): EditTarget {
    const l = this.store.activeLayer();
    if (this.editTarget === 'mask' && (!l || !l.mask)) return 'pixels';
    return this.editTarget;
  }

  private dispatch(phase: 'down' | 'move' | 'up', p: StrokeSample): void {
    const ctx = this.context();
    if (phase === 'down') this.tool.onPointerDown(p, ctx);
    else if (phase === 'move') this.tool.onPointerMove(p, ctx);
    else {
      this.tool.onPointerUp(p, ctx);
    }
  }

  private selectTool(t: Tool): void {
    this.tool = t;
    for (const [id, b] of this.toolButtons) {
      b.setAttribute('aria-pressed', id === t.id ? 'true' : 'false');
    }
    this.toolHint.textContent = t.hint;
    this.buildToolOptions();
  }

  private buildToolOptions(): void {
    this.optionsHost.textContent = '';
    this.tool.buildOptions(this.optionsHost, this.context());
  }

  // ------------------------------------------------------------------ render

  /**
   * Recomposite and re-encode. A `fast` pass forces a single compression pass
   * so dragging stays interactive; the full pass count runs when things settle.
   * Overlapping calls collapse into one trailing render.
   */
  private refresh(fast: boolean): void {
    // The clean view is the surface being drawn on, and compositing is cheap.
    // It must never wait behind an encode, or a slow method makes the brush
    // itself feel broken rather than just the preview lagging.
    const overlay = this.tool.overlay?.() ?? null;
    const composite = this.compositor.composite(this.store.doc, overlay);
    this.viewport.showClean(composite);
    this.stats['layers']!.textContent = String(this.store.layers.length);

    if (this.renderBusy) {
      // A pending full render outranks a fast one.
      if (this.renderQueued !== 'full') this.renderQueued = fast ? 'fast' : 'full';
      return;
    }
    this.renderBusy = true;
    const seq = ++this.renderSeq;

    if (!this.store.layers.length) {
      this.viewport.clearCompressed();
      this.stats['size']!.textContent = '—';
      this.renderBusy = false;
      this.drainQueue();
      return;
    }

    const passes = fast ? this.dragPasses() : this.crunchSettings.passes;
    void crunch(composite, this.crunchSettings, passes, () => seq !== this.renderSeq)
      .then((result) => {
        if (seq !== this.renderSeq) return;
        this.viewport.showCompressed(result.canvas);
        if (result.bytes) this.stats['size']!.textContent = formatBytes(result.bytes);
        this.stats['method']!.textContent = getCodec(this.crunchSettings.codecId)?.label ?? '—';
        const reduced = fast && passes < this.crunchSettings.passes;
        this.stats['passes']!.textContent = passes + (reduced ? ' (preview)' : '');
        this.stats['time']!.textContent = `${Math.round(result.elapsedMs)} ms`;
        if (!fast && result.passes > 0) {
          this.lastFullMs = result.elapsedMs;
          this.lastFullPasses = result.passes;
        }
      })
      .catch(() => {
        /* a newer render superseded this one */
      })
      .finally(() => {
        this.renderBusy = false;
        this.drainQueue();
      });
  }

  /**
   * Passes to run while the pointer is down.
   *
   * Showing fewer than the real count makes a strong method look weak exactly
   * when you are judging it, so the default is to show the truth and only
   * trim if the user asks for it.
   */
  private dragPasses(): number {
    const want = this.crunchSettings.passes;
    if (want <= 1) return want;
    switch (this.crunchSettings.livePreview) {
      case 'full':
        return want;
      case 'fast':
        return 1;
      case 'adaptive': {
        if (this.lastFullPasses <= 0 || this.lastFullMs <= 0) return want;
        const perPass = this.lastFullMs / this.lastFullPasses;
        const affordable = Math.floor(120 / Math.max(1, perPass));
        return Math.max(1, Math.min(want, affordable));
      }
    }
  }

  private drainQueue(): void {
    const q = this.renderQueued;
    if (!q) return;
    this.renderQueued = false;
    this.refresh(q === 'fast');
  }

  private status(text: string): void {
    this.statusEl.textContent = text;
  }

  // ------------------------------------------------------------------- files

  private async handleFiles(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    const result = await acceptFiles(this.store, files, () => this.history.push());
    if (result.projectLoaded) this.history.clear();
    this.buildToolOptions();
    this.refresh(false);

    const parts: string[] = [];
    if (result.projectLoaded) parts.push('Project opened.');
    if (result.imagesAdded) parts.push(`${result.imagesAdded} image${result.imagesAdded > 1 ? 's' : ''} added.`);
    parts.push(...result.errors);
    this.status(parts.join(' '));
  }

  private async exportJpeg(btn: HTMLButtonElement): Promise<void> {
    if (!this.store.layers.length) return;
    const label = btn.textContent ?? 'Export JPEG';
    btn.textContent = 'Encoding…';
    const composite = this.compositor.composite(this.store.doc, null);
    const result = await crunch(composite, this.crunchSettings, this.crunchSettings.passes);
    if (!result.blob) {
      btn.textContent = label;
      this.status('The encoder returned nothing.');
      return;
    }
    const outcome = await saveFile(result.blob, this.exportName(result.blob.type));
    btn.textContent = label;
    this.status(
      outcome === 'saved' ? `Saved ${formatBytes(result.blob.size)}.`
        : outcome === 'declined' ? 'Save cancelled.'
          : 'Saving is not available here.',
    );
  }

  /** Name the file after the method and whatever its leading control is. */
  private exportName(mime: string): string {
    const s = this.crunchSettings;
    const codec = getCodec(s.codecId);
    const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
    const bits = [codec?.id ?? 'lossy'];
    if (codec) {
      const values = paramsFor(s, codec);
      const lead = codec.params.find((p) => p.kind === 'range');
      if (lead) bits.push(`${lead.key}${String(values[lead.key] ?? '')}`);
    }
    if (s.passes > 1) bits.push(`x${s.passes}`);
    return `${bits.join('_')}.${ext}`;
  }

  private async saveProject(btn: HTMLButtonElement): Promise<void> {
    if (!this.store.layers.length) return;
    const label = btn.textContent ?? 'Save project';
    btn.textContent = 'Writing…';
    const blob = projectBlob(this.store);
    const outcome = await saveFile(blob, `untitled.${PROJECT_EXTENSION}`);
    btn.textContent = label;
    this.status(
      outcome === 'saved' ? `Project saved, ${formatBytes(blob.size)}, layers intact.`
        : outcome === 'declined' ? 'Save cancelled.'
          : 'Saving is not available here.',
    );
  }

  // -------------------------------------------------------------------- shell

  private build(): void {
    // --- top bar
    const bar = el('header', 'bar');
    const brand = el('div', 'brand');
    const h1 = el('h1', undefined, 'Lossy Layers');
    brand.append(h1, el('p', 'tag', 'Stack it, erase it, watch the JPEG eat it.'));

    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = `${IMAGE_TYPES},application/json,.json`;
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      void this.handleFiles(Array.from(fileInput.files ?? [])).then(() => { fileInput.value = ''; });
    });

    const newBtn = this.barButton('New', () => {
      openNewDocument((choice) => {
        this.store.newDocument(choice.width, choice.height, choice.matte, choice.fill);
        this.history.clear();
        this.buildToolOptions();
        this.crunchPanel.render();
        this.refresh(false);
        this.status(`New document, ${choice.width} × ${choice.height}.`);
      });
    }, 'btn');

    const openLabel = el('label', 'btn');
    openLabel.append(
      document.createRange().createContextualFragment(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 16v3h16v-3M12 4v11m0 0l-4-4m4 4l4-4"/></svg>',
      ),
      document.createTextNode('Open'),
      fileInput,
    );

    this.historyButtons['undo'] = this.barButton('Undo', () => {
      this.filterPanel.revert();
      this.history.undo();
      this.buildToolOptions();
      this.refresh(false);
    }, 'btn ghost');
    this.historyButtons['redo'] = this.barButton('Redo', () => {
      this.filterPanel.revert();
      this.history.redo();
      this.buildToolOptions();
      this.refresh(false);
    }, 'btn ghost');

    const saveBtn = this.barButton('Save project', () => { void this.saveProject(saveBtn); }, 'btn');
    const exportBtn = this.barButton('Export JPEG', () => { void this.exportJpeg(exportBtn); }, 'btn primary');

    bar.append(brand, newBtn, openLabel, this.historyButtons['undo']!, this.historyButtons['redo']!, saveBtn, exportBtn);

    // --- tool rail
    const rail = el('aside', 'panel rail');
    const railScroll = el('div', 'scroll');
    const toolBlock = el('div', 'block');
    toolBlock.appendChild(el('p', 'sign', 'Tools'));
    const toolGrid = el('div', 'tool-grid');
    for (const t of allTools()) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.title = t.shortcut ? `${t.label} (${t.shortcut.toUpperCase()})` : t.label;
      b.setAttribute('aria-pressed', t.id === this.tool.id ? 'true' : 'false');
      b.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg><span>${t.label}</span>`;
      b.addEventListener('click', () => this.selectTool(t));
      this.toolButtons.set(t.id, b);
      toolGrid.appendChild(b);
    }
    toolBlock.append(toolGrid, this.toolHint);
    this.toolHint.textContent = this.tool.hint;
    railScroll.append(toolBlock, this.optionsHost, this.filterPanel.root);
    rail.appendChild(railScroll);

    // --- stage
    const stage = el('section', 'stage');
    const viewbar = el('div', 'viewbar');
    viewbar.append(
      this.segmented<ViewMode>(
        [
          { label: 'Split', value: 'split' },
          { label: 'Clean', value: 'clean' },
          { label: 'Compressed', value: 'compressed' },
        ],
        'split',
        (v) => this.viewport.setMode(v),
      ),
      this.segmented<Zoom>(
        [
          { label: 'Fit', value: 'fit' },
          { label: '50%', value: 0.5 },
          { label: '100%', value: 1 },
          { label: '200%', value: 2 },
        ],
        'fit',
        (v) => this.viewport.setZoom(v),
      ),
      this.viewport.note,
    );

    const readout = el('div', 'readout');
    for (const [key, label] of [
      ['size', 'Encoded size'], ['method', 'Method'], ['passes', 'Passes'],
      ['layers', 'Layers'], ['time', 'Encode time'],
    ] as const) {
      const stat = el('div', key === 'size' ? 'stat hero' : 'stat');
      const value = el('span', 'stat-value mono', '—');
      stat.append(el('span', 'sign', label), value);
      this.stats[key] = value;
      readout.appendChild(stat);
    }

    stage.append(viewbar, this.viewport.root, readout, this.statusEl);

    // --- right side
    const side = el('aside', 'panel side');
    const sideScroll = el('div', 'scroll');
    sideScroll.append(this.layerPanel.root, this.crunchPanel.root);
    side.appendChild(sideScroll);

    const grid = el('main', 'grid');
    grid.append(rail, stage, side);

    const app = el('div', 'app');
    app.append(bar, grid);
    this.mount.appendChild(app);

    this.installGlobalEvents();
    this.syncHistoryButtons();
  }

  private barButton(label: string, onClick: () => void, className: string): HTMLButtonElement {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private segmented<T>(
    items: readonly { label: string; value: T }[],
    initial: T,
    onPick: (v: T) => void,
  ): HTMLElement {
    const seg = el('div', 'seg');
    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
      const b = el('button', undefined, item.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', item.value === initial ? 'true' : 'false');
      b.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        onPick(item.value);
      });
      buttons.push(b);
      seg.appendChild(b);
    }
    return seg;
  }

  private syncHistoryButtons(): void {
    this.historyButtons['undo']!.disabled = !this.history.canUndo;
    this.historyButtons['redo']!.disabled = !this.history.canRedo;
  }

  private installGlobalEvents(): void {
    let overlay: HTMLElement | null = null;
    const showOverlay = (): void => {
      if (overlay) return;
      overlay = el('div', 'dropzone');
      overlay.appendChild(el('p', undefined, 'Drop images or a project'));
      document.body.appendChild(overlay);
    };
    const hideOverlay = (): void => {
      overlay?.remove();
      overlay = null;
    };

    for (const type of ['dragenter', 'dragover'] as const) {
      document.addEventListener(type, (e) => { e.preventDefault(); showOverlay(); });
    }
    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (!e.relatedTarget) hideOverlay();
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      hideOverlay();
      void this.handleFiles(Array.from(e.dataTransfer?.files ?? []));
    });
    document.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void this.handleFiles(files);
      }
    });

    document.addEventListener('keydown', (e) => {
      // Not every keydown target is an element: with nothing focused it is
      // the document, which has no `matches`.
      const t = e.target;
      if (t instanceof Element && t.matches('input, select, textarea')) return;
      const k = e.key.toLowerCase();

      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') {
          e.preventDefault();
          this.filterPanel.revert();
          if (e.shiftKey) this.history.redo(); else this.history.undo();
          this.buildToolOptions();
          this.refresh(false);
        } else if (k === 'y') {
          e.preventDefault();
          this.filterPanel.revert();
          this.history.redo();
          this.buildToolOptions();
          this.refresh(false);
        }
        return;
      }

      if (e.key === '[' || e.key === ']') {
        const d = e.key === '[' ? -4 : 4;
        this.brushSettings.size = Math.max(1, Math.min(400, this.brushSettings.size + d));
        this.brush.invalidate();
        this.buildToolOptions();
        return;
      }

      const tool = toolForShortcut(k);
      if (tool) this.selectTool(tool);
    });
  }

  /** Exposed so the console and future tests can drive the app. */
  debug(): Record<string, unknown> {
    return {
      store: this.store,
      history: this.history,
      tools: allTools(),
      getTool,
      filters: allFilters(),
      crunchSettings: this.crunchSettings,
      codecs: allCodecs(),
      serialize: () => serialize(this.store.doc),
      openProject: async (text: string): Promise<void> => {
        this.store.load(await deserialize(text));
        this.history.clear();
        this.buildToolOptions();
        this.refresh(false);
      },
      refresh: (fast = false): void => this.refresh(fast),
    };
  }
}
