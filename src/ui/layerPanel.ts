import { ctx2d, newCanvas } from '../core/canvas';
import type { History } from '../core/history';
import type { Store } from '../core/store';
import { BLEND_LABELS, BLEND_MODES, type BlendMode, type Layer } from '../core/types';
import { el, iconButton, selectField, sign, slider } from './controls';

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

/** The layer stack: ordering, visibility, opacity and blend. */
export class LayerPanel {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private props: HTMLElement;
  private buttons: Record<string, HTMLButtonElement> = {};

  constructor(
    private store: Store,
    private history: History,
    private onChange: () => void,
  ) {
    const head = el('div', 'panel-head');
    head.appendChild(el('span', 'sign', 'Layers'));

    this.buttons['add'] = iconButton('ly-add', 'New empty layer', ICONS.add, () => {
      this.history.push();
      this.store.addPaintLayer();
      this.onChange();
    });
    this.buttons['duplicate'] = iconButton('ly-dup', 'Duplicate layer', ICONS.duplicate, () => {
      this.history.push();
      this.store.duplicateActive();
      this.onChange();
    });
    this.buttons['up'] = iconButton('ly-up', 'Move up', ICONS.up, () => {
      this.history.push();
      this.store.moveActive(1);
      this.onChange();
    });
    this.buttons['down'] = iconButton('ly-down', 'Move down', ICONS.down, () => {
      this.history.push();
      this.store.moveActive(-1);
      this.onChange();
    });
    this.buttons['merge'] = iconButton('ly-merge', 'Merge down', ICONS.merge, () => {
      this.history.push();
      this.store.mergeDown();
      this.onChange();
    });
    this.buttons['remove'] = iconButton('ly-del', 'Delete layer', ICONS.remove, () => {
      this.history.push();
      this.store.deleteActive();
      this.onChange();
    });

    head.append(
      this.buttons['add']!, this.buttons['duplicate']!, this.buttons['up']!,
      this.buttons['down']!, this.buttons['merge']!, this.buttons['remove']!,
    );

    this.list = el('div', 'layer-list');
    this.props = el('div', 'block');

    this.root = el('div', 'layer-panel');
    this.root.append(head, this.list, this.props);
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
      const l = layers[i]!;
      const rowEl = el('div', 'layer');
      rowEl.setAttribute('aria-selected', l.id === this.store.doc.activeId ? 'true' : 'false');
      rowEl.dataset['hidden'] = l.visible ? 'false' : 'true';

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

      const thumb = el('img', 'thumb');
      thumb.src = this.thumbnail(l);
      thumb.alt = '';

      const meta = el('div', 'layer-meta');
      meta.appendChild(el('span', 'layer-name', l.name));
      const bits = [BLEND_LABELS[l.blend]];
      if (l.opacity < 1) bits.push(`${Math.round(l.opacity * 100)}%`);
      if (l.scale !== 1) bits.push(`${Math.round(l.scale * 100)}% scale`);
      meta.appendChild(el('span', 'layer-sub', bits.join(' · ')));

      rowEl.append(eye, thumb, meta);
      rowEl.addEventListener('click', () => {
        this.store.select(l.id);
        this.onChange();
      });
      this.list.appendChild(rowEl);
    }

    this.renderProps();
    this.syncButtons();
  }

  private renderProps(): void {
    this.props.textContent = '';
    const l = this.store.activeLayer();
    if (!l) return;

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
          this.render();
          this.onChange();
        },
      ),
    );
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
