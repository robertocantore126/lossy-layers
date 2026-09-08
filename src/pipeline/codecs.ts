import type { ParamSpec, ParamValues } from '../core/types';

/** One round trip through a compression method. */
export interface CodecPass {
  /** A real, saveable file holding the result. */
  blob: Blob;
  /** The image as it comes back out. */
  canvas: HTMLCanvasElement;
  /**
   * The format's true payload size, when it differs from the saveable file.
   *
   * Indexed colour needs this: the canvas PNG encoder always writes
   * truecolour, so its file size describes the wrapper rather than the
   * method, and would overstate an indexed image several times over.
   */
  reportedBytes?: number;
}

/** Where in the chain a pass sits, for methods that vary as they repeat. */
export interface PassContext {
  /** 0-based index of this pass. */
  index: number;
  /** How many passes are being run in total. */
  total: number;
}

/**
 * A compression method.
 *
 * `run` is one pass: degrade the pixels the way this method does, and report
 * the byte count honestly. Feeding its own output back in is what produces
 * generation loss, so a codec must be able to consume what it produces.
 *
 * Most codecs ignore `pass` and behave identically every time. A method that
 * models something happening repeatedly over time, rather than one encoder
 * applied again, uses it to change what each round does.
 */
export interface Codec {
  readonly id: string;
  readonly label: string;
  /** One line on what the damage looks like. Shown under the picker. */
  readonly character: string;
  readonly params: readonly ParamSpec[];
  run(source: HTMLCanvasElement, values: ParamValues, pass: PassContext): Promise<CodecPass>;
}

const codecs: Codec[] = [];

export function registerCodec(c: Codec): void {
  if (codecs.some((x) => x.id === c.id)) throw new Error(`duplicate codec id: ${c.id}`);
  codecs.push(c);
}

export function allCodecs(): readonly Codec[] {
  return codecs;
}

export function getCodec(id: string): Codec | null {
  return codecs.find((c) => c.id === id) ?? null;
}

/**
 * Decode a data URL into the bytes it stands for.
 *
 * Every codec encodes through `toDataURL` rather than `toBlob`, because the
 * callback-based APIs are throttled to roughly one call per second in some
 * embedders while the synchronous encoder does the same work in a couple of
 * milliseconds. See the note in the README.
 */
export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data URL from the canvas encoder');
  const mime = /:(.*?);/.exec(url.slice(0, comma))?.[1] ?? 'application/octet-stream';
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Encode, and refuse to lie about the format.
 *
 * A canvas asked for a type it cannot encode quietly hands back a PNG, which
 * would show up as a codec that mysteriously never damages anything. Checking
 * the returned MIME is the only way to tell.
 */
export function encodeAs(canvas: HTMLCanvasElement, mime: string, quality: number): Blob | null {
  const url = canvas.toDataURL(mime, quality);
  if (!url.startsWith(`data:${mime}`)) return null;
  return dataUrlToBlob(url);
}

/** Whether this browser can really encode a format, tested once. */
const supportCache = new Map<string, boolean>();

export function canEncode(mime: string): boolean {
  const cached = supportCache.get(mime);
  if (cached !== undefined) return cached;
  const probe = document.createElement('canvas');
  probe.width = 4;
  probe.height = 4;
  const ok = probe.toDataURL(mime, 0.5).startsWith(`data:${mime}`);
  supportCache.set(mime, ok);
  return ok;
}
