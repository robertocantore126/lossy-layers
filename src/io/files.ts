import type { Store } from '../core/store';
import { deserialize, ProjectError } from './project';

export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';

function isImage(f: File): boolean {
  return /^image\//.test(f.type);
}

function isProject(f: File): boolean {
  return f.name.endsWith('.lossy.json') || f.type === 'application/json';
}

/** Adds one image file as a new layer. */
export async function importImage(store: Store, file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`${file.name} could not be decoded`));
      i.src = url;
    });
    const name = file.name.replace(/\.[^.]+$/, '') || 'Image';
    store.addImageLayer(img, img.naturalWidth, img.naturalHeight, name);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface DropResult {
  imagesAdded: number;
  projectLoaded: boolean;
  errors: string[];
}

/**
 * Handles a set of dropped or picked files. A project file replaces the
 * document; images are appended as layers. Mixing both in one drop is
 * accepted, project first, so the images land on top of it.
 */
export async function acceptFiles(
  store: Store,
  files: readonly File[],
  onBeforeMutate: () => void,
): Promise<DropResult> {
  const result: DropResult = { imagesAdded: 0, projectLoaded: false, errors: [] };
  const projects = files.filter(isProject);
  const images = files.filter(isImage);

  for (const p of projects.slice(0, 1)) {
    try {
      const text = await p.text();
      const doc = await deserialize(text);
      onBeforeMutate();
      store.load(doc);
      result.projectLoaded = true;
    } catch (e) {
      result.errors.push(e instanceof ProjectError ? e.message : `${p.name} could not be opened.`);
    }
  }

  for (const f of images) {
    try {
      if (result.imagesAdded === 0 && !result.projectLoaded) onBeforeMutate();
      await importImage(store, f);
      result.imagesAdded++;
    } catch {
      result.errors.push(`${f.name} could not be decoded.`);
    }
  }

  if (!projects.length && !images.length && files.length) {
    result.errors.push('No images or projects in that drop.');
  }
  return result;
}
