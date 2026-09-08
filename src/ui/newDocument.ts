import { MAX_DOC } from '../core/store';
import { button, el, sign } from './controls';

export interface NewDocumentChoice {
  width: number;
  height: number;
  /** What the compressed output falls back to where nothing is painted. */
  matte: string;
  /** Colour for the background layer, or null to leave it empty. */
  fill: string | null;
}

interface Preset {
  label: string;
  width: number;
  height: number;
  note?: string;
}

const PRESETS: readonly Preset[] = [
  { label: '1000 square', width: 1000, height: 1000 },
  { label: '2000 square', width: 2000, height: 2000 },
  { label: '3000 square', width: 3000, height: 3000 },
  { label: '1080 × 1350', width: 1080, height: 1350, note: 'tall post' },
  { label: '1920 × 1080', width: 1920, height: 1080, note: 'screen' },
  { label: '640 × 480', width: 640, height: 480, note: 'old web' },
];

type Background = 'black' | 'white' | 'transparent';

/**
 * The New Document dialog.
 *
 * Deliberately shows what the choice costs. A 3000 square document is 36 MB
 * per full layer, which is the number that decides whether a big collage is
 * comfortable or not, and it is invisible until someone tells you.
 */
export function openNewDocument(onCreate: (choice: NewDocumentChoice) => void): void {
  let width = 3000;
  let height = 3000;
  let background: Background = 'black';

  const overlay = el('div', 'modal-overlay');
  const card = el('div', 'modal-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'New document');

  const title = el('h2', 'modal-title', 'New document');
  const presetRow = el('div', 'chips');
  const sizeRow = el('div', 'size-row');
  const costLine = el('p', 'hint');
  const bgRow = el('div', 'chips');

  const widthInput = el('input');
  const heightInput = el('input');
  for (const [input, value] of [[widthInput, width], [heightInput, height]] as const) {
    input.type = 'number';
    input.min = '1';
    input.max = String(MAX_DOC);
    input.step = '1';
    input.value = String(value);
    input.className = 'size-input';
  }
  widthInput.setAttribute('aria-label', 'Width in pixels');
  heightInput.setAttribute('aria-label', 'Height in pixels');

  function megabytesPerLayer(): number {
    return (width * height * 4) / 1048576;
  }

  function refreshCost(): void {
    const mb = megabytesPerLayer();
    const pixels = (width * height) / 1e6;
    costLine.textContent =
      `${pixels.toFixed(1)} megapixels. A layer covering the whole canvas holds ${mb.toFixed(0)} MB, ` +
      `so empty layers stay free and only painted ones cost anything.`;
    costLine.classList.toggle('warn', mb > 120);
  }

  function syncPresets(): void {
    for (const child of Array.from(presetRow.children)) {
      const p = (child as HTMLElement).dataset['size'];
      child.setAttribute('aria-pressed', p === `${width}x${height}` ? 'true' : 'false');
    }
  }

  function setSize(w: number, h: number): void {
    width = Math.max(1, Math.min(MAX_DOC, Math.round(w)));
    height = Math.max(1, Math.min(MAX_DOC, Math.round(h)));
    widthInput.value = String(width);
    heightInput.value = String(height);
    refreshCost();
    syncPresets();
  }

  for (const p of PRESETS) {
    const b = button(p.label, () => setSize(p.width, p.height), 'chip', p.note);
    b.dataset['size'] = `${p.width}x${p.height}`;
    presetRow.appendChild(b);
  }

  const readInputs = (): void => {
    setSize(parseInt(widthInput.value, 10) || width, parseInt(heightInput.value, 10) || height);
  };
  widthInput.addEventListener('change', readInputs);
  heightInput.addEventListener('change', readInputs);

  const swap = button('Swap', () => setSize(height, width), 'chip', 'Turn the canvas on its side');
  sizeRow.append(widthInput, el('span', 'size-by', '×'), heightInput, el('span', 'size-unit', 'px'), swap);

  for (const bg of ['black', 'white', 'transparent'] as const) {
    const b = button(bg[0]!.toUpperCase() + bg.slice(1), () => {
      background = bg;
      for (const child of Array.from(bgRow.children)) {
        child.setAttribute('aria-pressed', (child as HTMLElement).dataset['bg'] === bg ? 'true' : 'false');
      }
    }, 'chip');
    b.dataset['bg'] = bg;
    b.setAttribute('aria-pressed', bg === background ? 'true' : 'false');
    bgRow.appendChild(b);
  }

  function close(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function create(): void {
    const matte = background === 'white' ? '#ffffff' : '#000000';
    const fill = background === 'transparent' ? null : matte;
    close();
    onCreate({ width, height, matte, fill });
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    } else if (ev.key === 'Enter' && !(ev.target instanceof Element && ev.target.matches('button'))) {
      // `ev.target` is the document itself when nothing holds focus, and a
      // document has no `matches`.
      ev.preventDefault();
      create();
    }
  }

  const actions = el('div', 'modal-actions');
  actions.append(
    button('Cancel', close, 'chip'),
    button('Create', create, 'chip accent'),
  );

  card.append(
    title,
    sign('Size'),
    sizeRow,
    presetRow,
    costLine,
    sign('Background'),
    bgRow,
    el('p', 'hint', 'Transparent leaves the background empty. The compressed view still needs something behind it, so erased areas fall through to the matte colour.'),
    actions,
  );

  overlay.appendChild(card);
  // Clicking the backdrop cancels; clicking the card must not.
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  refreshCost();
  syncPresets();
  widthInput.focus();
  widthInput.select();
}
