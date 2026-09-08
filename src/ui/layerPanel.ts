import { ctx2d, newCanvas } from '../core/canvas';
import type { History } from '../core/history';
import type { Store } from '../core/store';
import { BLEND_LABELS, BLEND_MODES, type BlendMode, type EditTarget, type Layer } from '../core/types';
import { button, el, iconButton, row, selectField, sign, slider } from './controls';

const EYE_ON =
  '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>';
const EYE_OFF =
  '<path d="M4 4l16 16"/><path d="M9.5 5.8A10.7 10.7 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4M6.4 7.9A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 3.6-.65"/>';

const ICONS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  duplicate: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  up: '<path d="M12 19V6m0 0l-6 6m6-6l6 6"/>',
  down: '<path d="M12 5v13m0 0l6-6m-6 6l-6-6"/>',
  merge: '<path d="M6 8h12M9 12h6M11 16h2"/>',
  remove: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
};

/** Below this the gesture is a click, above it a reorder drag. */
const DRAG_THRESHOLD = 4;

interface DragState {
  id: number;
  startY: number;
  moved: boolean;
  /** History is recorded once, on the first actual move. */
  pushed: boolean;
}

/**
 * The layer stack: ordering, visibility, opacity and blend.
 *
 * The panel re-renders from a store subscription rather than from each
 * handler, so every mutation shows up whether it came from a button here, a
 * drag, a tool, undo, or a project load.
 */
export class LayerPanel {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private props: HTMLElement;
  private buttons: Record<string, HTMLButtonElement> = {};
  private drag: DragState | null = null;

  constructor(
    private store: Store,
    private history: History,
    private onChange: () => void,
    private getTarget: () => EditTarget,
    private setTarget: (t: EditTarget) => void,
  ) {
    const head = el('div', 'panel-head');
    head.appendChild(el('span', 'sign', 'Layers'));

    const act = (fn: () => void) => () => {
      this.history.push();
      fn();
      this.onChange();
    };

    this.buttons['add'] = iconButton('ly-add', 'New empty layer', ICONS.add, act(() => this.store.addPaintLayer()));
    this.buttons['duplicate'] = iconButton('ly-dup', 'Duplicate layer', ICONS.duplicate, act(() => this.store.duplicateActive()));
    this.buttons['up'] = iconButton('ly-up', 'Move up', ICONS.up, act(() => this.store.moveActive(1)));
    this.buttons['down'] = iconButton('ly-down', 'Move down', ICONS.down, act(() => this.store.moveActive(-1)));
    this.buttons['merge'] = iconButton('ly-merge', 'Merge down', ICONS.merge, act(() => this.store.mergeDown()));
    this.buttons['remove'] = iconButton('ly-del', 'Delete layer', ICONS.remove, act(() => this.store.deleteActive()));

    head.append(
      this.buttons['add']!, this.buttons['duplicate']!, this.buttons['up']!,
      this.buttons['down']!, this.buttons['merge']!, this.buttons['remove']!,
    );

    this.list = el('div', 'layer-list');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Layers');
    this.props = el('div', 'block');

    this.root = el('div', 'layer-panel');
    this.root.append(head, this.list, this.props);

    // One subscription replaces a render call in every handler.
    this.store.subscribe(() => this.render());
  }

  private thumbnail(l: Layer): string {
    const c = newCanvas(34, 26);
    const x = ctx2d(c);
    x.fillStyle = '#0c0e11';
    x.fillRect(0, 0, 34, 26);
    const r = Math.min(34 / l.canvas.width, 26 / l.canvas.height);
    const w = l.canvas.width * r;
    const h = l.canvas.height * r;
    x.drawImage(l.canvas, (34 - w) / 2, (26 - h) / 2, w, h);
    return c.toDataURL();
  }

  /**
   * The mask drawn the way people read masks: white where the layer shows,
   * black where it is hidden. Internally it is an alpha channel, so this
   * flattens it onto black to make the alpha visible.
   */
  private maskThumbnail(mask: HTMLCanvasElement): string {
    const c = newCanvas(34, 26);
    const x = ctx2d(c);
    x.fillStyle = '#000000';
    x.fillRect(0, 0, 34, 26);
    const r = Math.min(34 / mask.width, 26 / mask.height);
    const w = mask.width * r;
    const h = mask.height * r;
    x.drawImage(mask, (34 - w) / 2, (26 - h) / 2, w, h);
    return c.toDataURL();
  }

  render(): void {
    this.list.textContent = '';
    const layers = this.store.layers;

    if (!layers.length) {
      this.list.appendChild(
        el('div', 'empty', 'No layers yet. Add an image, or drop one anywhere on the page.'),
      );
    }

    // Top of the stack reads first, the way every layer panel does it.
    for (let i = layers.length - 1; i >= 0; i--) {
      this.list.appendChild(this.buildRow(layers[i]!));
    }

    this.renderProps();
    this.syncButtons();
  }

  private buildRow(l: Layer): HTMLElement {
    const rowEl = el('div', 'layer');
    rowEl.dataset['layerId'] = String(l.id);
    rowEl.setAttribute('role', 'option');
    rowEl.tabIndex = 0;
    const selected = l.id === this.store.doc.activeId;
    rowEl.setAttribute('aria-selected', selected ? 'true' : 'false');
    rowEl.dataset['hidden'] = l.visible ? 'false' : 'true';
    if (this.drag?.id === l.id && this.drag.moved) rowEl.classList.add('dragging');

    const eye = el('button', 'eye');
    eye.type = 'button';
    eye.title = l.visible ? 'Hide layer' : 'Show layer';
    eye.setAttribute('aria-label', eye.title);
    eye.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${l.visible ? EYE_ON : EYE_OFF}</svg>`;
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.history.push();
      l.visible = !l.visible;
      this.store.emit();
      this.onChange();
    });

    const isActive = l.id === this.store.doc.activeId;
    const target = this.getTarget();

    const thumb = el('img', 'thumb');
    thumb.src = this.thumbnail(l);
    thumb.alt = 'Layer pixels';
    thumb.draggable = false;
    thumb.title = 'Edit the layer';
    if (isActive && l.mask && target === 'pixels') thumb.classList.add('targeted');
    thumb.addEventListener('pointerdown', (ev) => {
      if (!l.mask) return;
      ev.stopPropagation();
      this.store.select(l.id);
      this.setTarget('pixels');
      this.onChange();
    });

    const thumbs = el('div', 'thumb-pair');
    thumbs.appendChild(thumb);

    if (l.mask) {
      const mthumb = el('img', 'thumb mask-thumb');
      mthumb.src = this.maskThumbnail(l.mask);
      mthumb.alt = 'Layer mask';
      mthumb.draggable = false;
      mthumb.title = l.maskEnabled ? 'Edit the mask' : 'Mask is switched off';
      if (!l.maskEnabled) mthumb.classList.add('off');
      if (isActive && target === 'mask') mthumb.classList.add('targeted');
      mthumb.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.store.select(l.id);
        this.setTarget('mask');
        this.onChange();
      });
      thumbs.appendChild(mthumb);
    }

    const meta = el('div', 'layer-meta');
    meta.appendChild(el('span', 'layer-name', l.name));
    const bits = [BLEND_LABELS[l.blend]];
    if (l.opacity < 1) bits.push(`${Math.round(l.opacity * 100)}%`);
    if (l.scale !== 1) bits.push(`${Math.round(l.scale * 100)}% scale`);
    if (l.mask && !l.maskEnabled) bits.push('mask off');
    meta.appendChild(el('span', 'layer-sub', bits.join(' · ')));

    rowEl.append(eye, thumbs, meta);

    rowEl.addEventListener('pointerdown', (ev) => {
      if ((ev.target as HTMLElement).closest('.eye')) return;
      if (ev.button !== 0) return;
      this.beginDrag(l.id, ev.clientY);
    });
    rowEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.store.select(l.id);
        this.onChange();
      }
    });

    return rowEl;
  }

  // ------------------------------------------------------------ reordering

  /**
   * Drag tracking lives on the window, not the row, because reordering
   * re-renders the list and destroys the element the gesture started on.
   */
  private beginDrag(id: number, startY: number): void {
    this.drag = { id, startY, moved: false, pushed: false };

    const move = (ev: PointerEvent): void => this.dragMove(ev);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private dragMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD) return;

    if (!d.moved) {
      d.moved = true;
      this.list.classList.add('reordering');
    }
    const target = this.dropIndex(ev.clientY);
    if (target === null) return;

    const from = this.store.layers.findIndex((l) => l.id === d.id);
    if (from === target) return;

    if (!d.pushed) {
      this.history.push();
      d.pushed = true;
    }
    if (this.store.moveLayerTo(d.id, target)) this.onChange();
  }

  /** Model index the dragged layer would land on, given a pointer position. */
  private dropIndex(clientY: number): number | null {
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.layer'));
    if (!rows.length) return null;
    const n = this.store.layers.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      // Rows read top-first, so DOM position i is model index n-1-i.
      if (clientY < r.top + r.height / 2) return n - 1 - i;
    }
    return 0;
  }

  private endDrag(): void {
    const d = this.drag;
    this.drag = null;
    this.list.classList.remove('reordering');
    if (!d) return;
    if (d.moved) {
      this.render();
      this.onChange();
    } else {
      this.store.select(d.id);
      this.onChange();
    }
  }

  // ----------------------------------------------------------------- props

  private renderProps(): void {
    this.props.textContent = '';
    const l = this.store.activeLayer();
    if (!l) return;

    // Captured before any drag, so the commit can record the pre-drag value.
    const opacityBefore = l.opacity;

    this.props.appendChild(sign('Selected layer'));
    this.props.appendChild(
      slider({
        label: 'Opacity', min: 0, max: 100, value: Math.round(l.opacity * 100), unit: '%',
        onInput: (n) => {
          const cur = this.store.activeLayer();
          if (!cur) return;
          cur.opacity = n / 100;
          this.onChange();
        },
        onCommit: (n) => {
          const cur = this.store.activeLayer();
          if (!cur) return;
          const applied = n / 100;
          if (applied === opacityBefore) return;
          // Snapshot the value the drag started from, then re-apply.
          cur.opacity = opacityBefore;
          this.history.push();
          cur.opacity = applied;
          this.store.emit();
          this.onChange();
        },
      }),
    );
    this.props.appendChild(
      selectField<BlendMode>(
        'Blend',
        BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABELS[b] })),
        l.blend,
        (v) => {
          const cur = this.store.activeLayer();
          if (!cur) return;
          this.history.push();
          this.store.setBlend(cur, v);
          this.onChange();
        },
      ),
    );

    this.props.appendChild(this.maskControls(l));
  }

  /**
   * Mask lifecycle. Adding one is the non-destructive way to blend a collage:
   * erase on the mask and the pixels underneath are still there to paint back.
   */
  private maskControls(l: Layer): HTMLElement {
    const wrap = el('div', 'field');
    wrap.appendChild(el('span', 'sign', 'Mask'));

    const act = (fn: () => void) => () => {
      this.history.push();
      fn();
      this.onChange();
    };

    if (!l.mask) {
      wrap.appendChild(
        row(
          button('Add mask', act(() => {
            this.store.addMask(l);
            this.setTarget('mask');
          }), 'chip accent', 'Erase without deleting anything'),
        ),
      );
      wrap.appendChild(
        el('p', 'hint', 'A mask hides parts of this layer instead of deleting them, so a blend can always be painted back.'),
      );
      return wrap;
    }

    wrap.appendChild(
      row(
        button(l.maskEnabled ? 'Switch off' : 'Switch on', act(() => this.store.toggleMask(l)), 'chip',
          'Compare the layer with and without its mask'),
        button('Invert', act(() => this.store.invertMask(l)), 'chip', 'Swap what is hidden for what is shown'),
        button('Show all', act(() => this.store.fillMask(l, true)), 'chip', 'Reset the mask to fully visible'),
        button('Hide all', act(() => this.store.fillMask(l, false)), 'chip', 'Hide the layer, then brush it back in'),
      ),
    );
    wrap.appendChild(
      row(
        button('Apply', act(() => {
          this.store.applyMask(l);
          this.setTarget('pixels');
        }), 'chip', 'Bake the mask into the pixels and drop it'),
        button('Delete', act(() => {
          this.store.removeMask(l);
          this.setTarget('pixels');
        }), 'chip', 'Discard the mask and show the whole layer'),
      ),
    );
    wrap.appendChild(
      el('p', 'hint',
        this.getTarget() === 'mask'
          ? 'Editing the mask. The brush reveals, the eraser hides.'
          : 'Editing the layer. Click its mask thumbnail to paint the blend instead.'),
    );
    return wrap;
  }

  private syncButtons(): void {
    const i = this.store.activeIndex();
    const n = this.store.layers.length;
    this.buttons['duplicate']!.disabled = i < 0;
    this.buttons['remove']!.disabled = i < 0;
    this.buttons['up']!.disabled = i < 0 || i >= n - 1;
    this.buttons['down']!.disabled = i <= 0;
    this.buttons['merge']!.disabled = i <= 0;
  }
}
