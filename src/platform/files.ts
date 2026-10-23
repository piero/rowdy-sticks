/**
 * File I/O that works both in a plain browser (downloads / <input type=file>)
 * and inside the TinyJS desktop shell (native dialogs + backend writes).
 */

export const inTiny = typeof (globalThis as { tiny?: { api?: { call?: unknown } } }).tiny?.api?.call === 'function';

const CHUNK = 3 * 1024 * 1024; // raw bytes per bridge call (~4 MB of base64)

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save data under a user-chosen name. Returns the saved path/name, or null if cancelled. */
export async function saveFile(name: string, ext: string, mime: string, data: Uint8Array | string): Promise<string | null> {
  const fileName = name.toLowerCase().endsWith('.' + ext) ? name : `${name}.${ext}`;
  if (!inTiny) {
    const part: BlobPart = typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>);
    downloadBlob(new Blob([part], { type: mime }), fileName);
    return fileName;
  }
  // `name` pre-fills the file name (documented, not yet in the bundled typings).
  const path = await tiny.dialog.saveFile({ types: [ext], name: fileName } as { types: string[] });
  if (!path) return null;
  if (typeof data === 'string') {
    await tiny.api.call('writeText', { path, text: data });
    return path;
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < data.length || i === 0; i += CHUNK) {
    await tiny.api.call('writeChunk', { id, data: toBase64(data.subarray(i, i + CHUNK)) });
  }
  await tiny.api.call('finishWrite', { id, path });
  return path;
}

/** Ask the user for a text file. */
export async function openTextFile(exts: string[]): Promise<{ name: string; text: string } | null> {
  if (inTiny) {
    const path = await tiny.dialog.openFile({ types: exts });
    if (!path) return null;
    const text = (await tiny.api.call('readText', { path })) as string;
    return { name: path.split(/[\\/]/).pop() ?? path, text };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function alertUser(message: string, detail?: string) {
  if (inTiny) await tiny.dialog.alert(message, detail);
  else window.alert(detail ? `${message}\n\n${detail}` : message);
}

export async function confirmUser(message: string, detail?: string): Promise<boolean> {
  if (inTiny) return tiny.dialog.confirm(message, { detail });
  return window.confirm(detail ? `${message}\n\n${detail}` : message);
}
