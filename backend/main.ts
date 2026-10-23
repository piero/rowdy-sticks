// tinyjs backend — runs in txiki.js. The page does all rendering/encoding;
// the backend only touches the filesystem on the page's behalf.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)], b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)], d = LOOKUP[clean.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** Binary exports arrive in base64 chunks and are written once complete. */
const pending = new Map<string, Uint8Array[]>();

export const api: Record<string, TinyApiHandler> = {
  writeText: async ({ path, text }: { path: string; text: string }) => {
    await tjs.writeFile(path, new TextEncoder().encode(text));
    return true;
  },
  readText: async ({ path }: { path: string }) => {
    const bytes = await tjs.readFile(path);
    return new TextDecoder().decode(bytes);
  },
  writeChunk: async ({ id, data }: { id: string; data: string }) => {
    let list = pending.get(id);
    if (!list) { list = []; pending.set(id, list); }
    list.push(fromBase64(data));
    return true;
  },
  finishWrite: async ({ id, path }: { id: string; path: string }) => {
    const list = pending.get(id) ?? [];
    pending.delete(id);
    const total = list.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of list) { all.set(c, off); off += c.length; }
    await tjs.writeFile(path, all);
    return total;
  },
};

export function init(_app: TinyApp) {}
