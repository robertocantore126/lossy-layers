import type { CrunchSettings } from '../pipeline/crunch';
import { button, checkbox, chipRow, el, hint, sign, slider } from './controls';

const BORDER_CHANNELS = [0, 128, 255];

/** The compression stage, in the order it actually runs. */
export class CrunchPanel {
  readonly root: HTMLElement;

  constructor(
    private settings: CrunchSettings,
    private getMatte: () => string,
    private setMatte: (v: string) => void,
    private onChange: (fast: boolean) => void,
  ) {
    this.root = el('div', 'block');
    this.render();
  }

  render(): void {
    const s = this.settings;
    this.root.textContent = '';
    this.root.appendChild(sign('The crunch'));

    this.root.appendChild(
      slider({
        label: 'Quality', min: 1, max: 100, value: s.quality,
        onInput: (n) => { s.quality = n; this.onChange(true); },
        onCommit: () => this.onChange(false),
      }),
    );
    this.root.appendChild(
      slider({
        label: 'Passes', min: 1, max: 30, value: s.passes, unit: '×',
        onInput: (n) => { s.passes = n; this.onChange(true); },
        onCommit: () => this.onChange(false),
      }),
    );
    this.root.appendChild(
      hint("Each pass re-encodes the last one's artifacts. Past about twenty the image settles, so drop the quality instead of adding passes."),
    );

    const quick = el('div', 'chips');
    quick.append(
      button('Random 15–30', () => {
        s.quality = Math.floor(Math.random() * 16) + 15;
        s.passes = 1;
        this.render();
        this.onChange(false);
      }, 'chip', "The bot's compressrand"),
      button(`Matte: ${this.getMatte() === '#000000' ? 'black' : 'white'}`, () => {
        this.setMatte(this.getMatte() === '#000000' ? '#ffffff' : '#000000');
        this.render();
        this.onChange(false);
      }, 'chip', 'JPEG has no transparency, so erased areas fall through to this'),
    );
    this.root.appendChild(quick);

    this.root.appendChild(
      chipRow<number>(
        'Downscale before encoding',
        [
          { label: 'Keep size', value: 0 },
          { label: '600', value: 600 },
          { label: '400', value: 400 },
          { label: '256', value: 256 },
          { label: '128', value: 128 },
        ],
        (v) => v === s.maxDimension,
        (v) => { s.maxDimension = v; this.render(); this.onChange(false); },
      ),
    );

    this.root.appendChild(
      slider({
        label: 'Squish width', min: 30, max: 200, value: Math.round(s.squishX * 100), unit: '%',
        onInput: (n) => { s.squishX = n / 100; this.onChange(true); },
        onCommit: () => this.onChange(false),
      }),
    );
    this.root.appendChild(
      slider({
        label: 'Squish height', min: 30, max: 200, value: Math.round(s.squishY * 100), unit: '%',
        onInput: (n) => { s.squishY = n / 100; this.onChange(true); },
        onCommit: () => this.onChange(false),
      }),
    );

    this.root.appendChild(
      checkbox('Draw a frame', s.border.enabled, (v) => {
        s.border.enabled = v;
        this.render();
        this.onChange(false);
      }),
    );

    if (s.border.enabled) {
      this.root.appendChild(
        slider({
          label: 'Frame width', min: 1, max: 60, value: s.border.width, unit: ' px',
          onInput: (n) => { s.border.width = n; this.onChange(true); },
          onCommit: () => this.onChange(false),
        }),
      );
      const swatches = el('div', 'swatches');
      for (const r of BORDER_CHANNELS) {
        for (const g of BORDER_CHANNELS) {
          for (const b of BORDER_CHANNELS) {
            const color = `rgb(${r},${g},${b})`;
            const sw = el('button', 'swatch');
            sw.type = 'button';
            sw.style.background = color;
            sw.title = color;
            sw.setAttribute('aria-label', color);
            sw.setAttribute('aria-pressed', s.border.color === color ? 'true' : 'false');
            sw.addEventListener('click', () => {
              s.border.color = color;
              this.render();
              this.onChange(false);
            });
            swatches.appendChild(sw);
          }
        }
      }
      const field = el('div', 'field');
      field.append(el('span', 'sign', 'Frame colour'), swatches);
      this.root.appendChild(field);
    }
  }
}
