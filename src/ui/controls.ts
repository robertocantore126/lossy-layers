/** Small DOM builders. Every panel in the app is assembled from these. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function sign(text: string): HTMLElement {
  return el('p', 'sign', text);
}

export function hint(text: string): HTMLElement {
  return el('p', 'hint', text);
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  format?: (n: number) => string;
  onInput: (n: number) => void;
  /** Fires once when the drag ends, for work too costly to do per frame. */
  onCommit?: (n: number) => void;
}

export function slider(o: SliderOptions): HTMLElement {
  const field = el('div', 'field');
  const head = el('div', 'field-head');
  head.appendChild(el('span', 'sign', o.label));
  const fmt = o.format ?? ((n: number) => `${n}${o.unit ?? ''}`);
  const readout = el('span', 'field-value mono', fmt(o.value));
  head.appendChild(readout);

  const input = el('input');
  input.type = 'range';
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step ?? 1);
  input.value = String(o.value);
  input.setAttribute('aria-label', o.label);

  input.addEventListener('input', () => {
    const n = parseFloat(input.value);
    readout.textContent = fmt(n);
    o.onInput(n);
  });
  if (o.onCommit) {
    input.addEventListener('change', () => o.onCommit!(parseFloat(input.value)));
  }

  field.append(head, input);
  return field;
}

export interface ChipOption<T> {
  label: string;
  value: T;
  title?: string;
}

export function chipRow<T>(
  label: string | null,
  options: readonly ChipOption<T>[],
  isActive: (v: T) => boolean,
  onPick: (v: T) => void,
): HTMLElement {
  const field = el('div', 'field');
  if (label) field.appendChild(el('span', 'sign', label));
  const row = el('div', 'chips');
  for (const o of options) {
    const b = el('button', 'chip', o.label);
    b.type = 'button';
    if (o.title) b.title = o.title;
    b.setAttribute('aria-pressed', isActive(o.value) ? 'true' : 'false');
    b.addEventListener('click', () => onPick(o.value));
    row.appendChild(b);
  }
  field.appendChild(row);
  return field;
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

export function colorField(label: string, value: string, onInput: (v: string) => void): HTMLElement {
  const field = el('div', 'field');
  field.appendChild(el('span', 'sign', label));
  const input = el('input');
  input.type = 'color';
  input.value = value;
  input.className = 'colorpick';
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => onInput(input.value));
  field.appendChild(input);
  return field;
}

export function selectField<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const field = el('div', 'field');
  field.appendChild(el('span', 'sign', label));
  const sel = el('select');
  for (const o of options) {
    const opt = el('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.setAttribute('aria-label', label);
  sel.addEventListener('change', () => onChange(sel.value as T));
  field.appendChild(sel);
  return field;
}

export function button(label: string, onClick: () => void, className = 'chip', title?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function row(...nodes: HTMLElement[]): HTMLElement {
  const r = el('div', 'chips');
  r.append(...nodes);
  return r;
}

export function iconButton(id: string, title: string, svgInner: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'iconbtn');
  b.type = 'button';
  b.id = id;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}
