import { ctx2d, loadImage, newCanvas } from '../core/canvas';
import type { Store } from '../core/store';
import type { BlendMode, DocState, Layer, LayerKind } from '../core/types';

export const PROJECT_EXTENSION = 'lossy.json';
const FORMAT = 'lossy-layers-project';
const VERSION = 2;

interface SerialLayer {
  id: number;
  name: string;
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  kind: LayerKind;
  width: number;
  height: number;
  /** PNG data URL, so alpha survives a round trip. */
  pixels: string;
  /** Added in format 2. Absent on version 1 files, which had no masks. */
  mask?: string | null;
  maskEnabled?: boolean;
}

interface SerialProject {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  width: number;
  height: number;
  matte: string;
  activeId: number | null;
  layers: SerialLayer[];
}

/**
 * Projects are JSON with each layer's pixels as a PNG data URL.
 *
 * PNG rather than JPEG because layers carry alpha, and a lossy intermediate
 * would quietly degrade the document every time it was reopened. The file is
 * larger for it, which is the right trade for a source document.
 */
export function serialize(doc: DocState): string {
  const layers: SerialLayer[] = doc.layers.map((l) => ({
    id: l.id,
    name: l.name,
    x: l.x,
    y: l.y,
    scale: l.scale,
    visible: l.visible,
    opacity: l.opacity,
    blend: l.blend,
    kind: l.kind,
    width: l.canvas.width,
    height: l.canvas.height,
    pixels: l.canvas.toDataURL('image/png'),
    mask: l.mask ? l.mask.toDataURL('image/png') : null,
    maskEnabled: l.maskEnabled,
  }));

  const project: SerialProject = {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    width: doc.width,
    height: doc.height,
    matte: doc.matte,
    activeId: doc.activeId,
    layers,
  };
  return JSON.stringify(project);
}

export class ProjectError extends Error {}

function parse(text: string): SerialProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError('That file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectError('That file is not a project.');
  }
  const p = raw as Partial<SerialProject>;
  if (p.format !== FORMAT) {
    throw new ProjectError('That file was not saved by Lossy Layers.');
  }
  if (typeof p.version !== 'number' || p.version > VERSION) {
    throw new ProjectError(`That project needs a newer version of the app (format ${String(p.version)}).`);
  }
  if (!Array.isArray(p.layers) || typeof p.width !== 'number' || typeof p.height !== 'number') {
    throw new ProjectError('That project is missing its document or layers.');
  }
  return p as SerialProject;
}

export async function deserialize(text: string): Promise<DocState> {
  const p = parse(text);

  const layers: Layer[] = [];
  for (const s of p.layers) {
    const img = await loadImage(s.pixels);
    const canvas = newCanvas(s.width || img.naturalWidth, s.height || img.naturalHeight);
    ctx2d(canvas).drawImage(img, 0, 0);

    let mask: HTMLCanvasElement | null = null;
    if (s.mask) {
      const mimg = await loadImage(s.mask);
      mask = newCanvas(canvas.width, canvas.height);
      ctx2d(mask).drawImage(mimg, 0, 0);
    }

    layers.push({
      id: s.id,
      name: s.name,
      canvas,
      mask,
      maskEnabled: s.maskEnabled ?? true,
      x: s.x,
      y: s.y,
      scale: s.scale,
      visible: s.visible,
      opacity: s.opacity,
      blend: s.blend,
      kind: s.kind,
    });
  }

  return {
    width: p.width,
    height: p.height,
    matte: p.matte ?? '#000000',
    activeId: p.activeId ?? (layers.length ? layers[layers.length - 1]!.id : null),
    layers,
  };
}

export function projectBlob(store: Store): Blob {
  return new Blob([serialize(store.doc)], { type: 'application/json' });
}
