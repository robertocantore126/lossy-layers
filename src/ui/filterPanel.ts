import { ctx2d, resizeCanvas } from '../core/canvas';
import type { History } from '../core/history';
import type { Store } from '../core/store';
import { defaultsOf, type ParamSpec, type ParamValues } from '../core/types';
import { filterGroups, getFilter } from '../filters/registry';
import type { Filter } from '../filters/types';
import { button, checkbox, colorField, el, hint, selectField, sign, slider } from './controls';

/**
 * Applies a filter to the selected layer.
 *
 * The preview is live and non-destructive: the layer's pixels are only
 * replaced when Apply is pressed, so you can scrub parameters against the
 * compressed view before committing.
 */
export class FilterPanel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private current: Filter | null = null;
  private values: ParamValues = {};
  /** The untouched layer pixels, held while a preview is showing. */
  private original: HTMLCanvasElement | null = null;
  private previewLayerId = -1;

  constructor(
    private store: Store,
    private history: History,
    private onChange: () => void,
  ) {
    this.root = el('div', 'block');
    this.body = el('div', 'stack');

    const groups = filterGroups();
    const options = [{ value: '', label: 'No filter' }];
    for (const g of groups) {
      for (const f of g.items) options.push({ value: f.id, label: `${g.group} · ${f.label}` });
    }

    this.root.append(
      sign('Filters'),
      selectField('Effect', options, '', (id) => this.choose(id)),
      this.body,
    );
  }

  /** Drop any live preview and put the layer back. Safe to call at any time. */
  revert(): void {
    if (this.original && this.previewLayerId >= 0) {
      const l = this.store.layerById(this.previewLayerId);
      if (l) {
        resizeCanvas(l.canvas, this.original.width, this.original.height);
        const c = ctx2d(l.canvas);
        c.clearRect(0, 0, l.canvas.width, l.canvas.height);
        c.drawImage(this.original, 0, 0);
      }
    }
    this.original = null;
    this.previewLayerId = -1;
  }

  private choose(id: string): void {
    this.revert();
    this.current = id ? getFilter(id) : null;
    this.values = this.current ? defaultsOf(this.current.params) : {};
    this.build();
    this.onChange();
  }

  private build(): void {
    this.body.textContent = '';
    const f = this.current;
    if (!f) return;

    const layer = this.store.activeLayer();
    if (!layer) {
      this.body.appendChild(hint('Select a layer to filter.'));
      return;
    }

    for (const spec of f.params) this.body.appendChild(this.control(spec));

    this.body.appendChild(
      el('div', 'chips'),
    );
    const actions = this.body.lastElementChild as HTMLElement;
    actions.append(
      button('Apply', () => this.commit(), 'chip accent'),
      button('Reset', () => {
        this.values = defaultsOf(f.params);
        this.build();
        this.preview();
      }),
      button('Cancel', () => {
        this.revert();
        this.onChange();
      }),
    );
    this.body.appendChild(hint('The preview is live. Nothing changes the layer until you press Apply.'));
    this.preview();
  }

  private control(spec: ParamSpec): HTMLElement {
    switch (spec.kind) {
      case 'range':
        return slider({
          label: spec.label,
          min: spec.min,
          max: spec.max,
          step: spec.step ?? 1,
          value: Number(this.values[spec.key] ?? spec.default),
          unit: spec.unit ?? '',
          onInput: (n) => {
            this.values[spec.key] = n;
            this.preview();
          },
        });
      case 'toggle':
        return checkbox(spec.label, Boolean(this.values[spec.key] ?? spec.default), (v) => {
          this.values[spec.key] = v;
          this.preview();
        });
      case 'color':
        return colorField(spec.label, String(this.values[spec.key] ?? spec.default), (v) => {
          this.values[spec.key] = v;
          this.preview();
        });
      case 'choice':
        return selectField(
          spec.label,
          spec.options,
          String(this.values[spec.key] ?? spec.default),
          (v) => {
            this.values[spec.key] = v;
            this.preview();
          },
        );
    }
  }

  /** Draw the filtered result into the layer without recording history. */
  private preview(): void {
    const f = this.current;
    const layer = this.store.activeLayer();
    if (!f || !layer) return;

    if (!this.original || this.previewLayerId !== layer.id) {
      this.revert();
      this.store.materialize(layer);
      const keep = document.createElement('canvas');
      keep.width = layer.canvas.width;
      keep.height = layer.canvas.height;
      ctx2d(keep).drawImage(layer.canvas, 0, 0);
      this.original = keep;
      this.previewLayerId = layer.id;
    }

    const result = f.apply(this.original, this.values);
    resizeCanvas(layer.canvas, result.width, result.height);
    const c = ctx2d(layer.canvas);
    c.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    c.drawImage(result, 0, 0);
    this.store.emit();
    this.onChange();
  }

  private commit(): void {
    const layer = this.store.activeLayer();
    if (!this.current || !layer || !this.original) return;

    // Put the original back, record it in history, then re-apply for real so
    // undo returns to the unfiltered pixels rather than a preview state.
    const filtered = layer.canvas;
    const original = this.original;
    this.original = null;
    this.previewLayerId = -1;

    layer.canvas = original;
    this.history.push();
    this.store.detach(layer);
    resizeCanvas(layer.canvas, filtered.width, filtered.height);
    const c = ctx2d(layer.canvas);
    c.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    c.drawImage(filtered, 0, 0);

    this.store.emit();
    this.build();
    this.onChange();
  }
}
