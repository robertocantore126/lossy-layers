/**
 * Saving a file to the viewer's machine.
 *
 * Published as an Artifact the page is sandboxed, and a plain `<a download>`
 * is inert there, so we ask the host for a save through its downloads
 * capability. Opened as a local file there is no host, and the anchor works
 * normally. Both paths are live, and which one runs is decided at call time.
 */

interface DownloadsApi {
  save(req: { filename: string; data: Blob }): Promise<{ status: string }>;
}

interface ClaudeHost {
  use(name: 'downloads'): Promise<DownloadsApi | null>;
}

function host(): ClaudeHost | null {
  const w = window as unknown as { claude?: ClaudeHost };
  return w.claude && typeof w.claude.use === 'function' ? w.claude : null;
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

function anchorSave(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const h = host();
  if (!h) {
    anchorSave(blob, filename);
    return 'saved';
  }
  try {
    const downloads = await h.use('downloads');
    if (!downloads) {
      anchorSave(blob, filename);
      return 'saved';
    }
    await downloads.save({ filename, data: blob });
    return 'saved';
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'declined') return 'declined';
    return 'unavailable';
  }
}
