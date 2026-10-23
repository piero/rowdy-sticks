import type { Editor } from './state';
import { button, check, h, num, replaceChildren, row, select } from './dom';
import { ExportCancelled, exportGif, exportSpriteSheet, exportVideo } from '../export/exporters';
import { alertUser, saveFile } from '../platform/files';

type Format = 'gif' | 'mp4' | 'sprites';

const settings = {
  format: 'gif' as Format,
  from: 0,
  to: -1,
  scale: 1,
  effects: true,
  loop: true,
  gifScale: 0.6,
  mbps: 6,
  columns: 8,
  step: 1,
  padding: 0,
  json: true,
};

export function openExportDialog(ed: Editor, initial?: Format) {
  if (initial) settings.format = initial;
  const p = ed.project;
  if (settings.to < 0 || settings.to >= p.frames) settings.to = p.frames - 1;
  if (settings.from >= p.frames) settings.from = 0;

  const overlay = h('div', { class: 'modal-overlay' });
  const body = h('div', { class: 'modal-body' });
  const progress = h('progress', { max: 1, value: 0, class: 'progress' });
  const status = h('div', { class: 'modal-status' });
  let abort: AbortController | null = null;

  const close = () => { abort?.abort(); overlay.remove(); };
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && !abort) close(); });

  const sizeLabel = h('span', { class: 'unit' });

  const renderBody = () => {
    const f = settings.format;
    const scale = f === 'gif' ? settings.gifScale : settings.scale;
    sizeLabel.textContent = `${Math.round(p.width * scale)} × ${Math.round(p.height * scale)} px`;
    replaceChildren(body,
      row('Format', select(f, [['gif', 'Animated GIF'], ['mp4', 'MP4 video'], ['sprites', 'PNG sprite sheet']], (v) => { settings.format = v; renderBody(); })),
      row('Frames', h('span', { class: 'pair' },
        num(settings.from, { min: 0, max: p.frames - 1 }, (v) => { settings.from = Math.max(0, Math.min(p.frames - 1, Math.round(v))); }),
        h('span', {}, 'to'),
        num(settings.to, { min: 0, max: p.frames - 1 }, (v) => { settings.to = Math.max(0, Math.min(p.frames - 1, Math.round(v))); }),
      )),
      row('Scale', num(scale, { min: 0.1, max: 4, step: 0.05, range: true }, (v) => {
        if (settings.format === 'gif') settings.gifScale = v; else settings.scale = v;
        sizeLabel.textContent = `${Math.round(p.width * v)} × ${Math.round(p.height * v)} px`;
      })),
      row('Output', sizeLabel),
      check(settings.effects, (v) => { settings.effects = v; }, 'Include hit effects, trails and shake'),
      f === 'gif' ? check(settings.loop, (v) => { settings.loop = v; }, 'Loop forever') : null,
      f === 'mp4' ? row('Bitrate', num(settings.mbps, { min: 1, max: 40, step: 1, range: true }, (v) => { settings.mbps = v; }), h('span', { class: 'unit' }, 'Mbps')) : null,
      f === 'sprites' ? row('Columns', num(settings.columns, { min: 1, max: 64 }, (v) => { settings.columns = Math.max(1, Math.round(v)); })) : null,
      f === 'sprites' || f === 'gif' ? row('Every', num(settings.step, { min: 1, max: 12 }, (v) => { settings.step = Math.max(1, Math.round(v)); }), h('span', { class: 'unit' }, 'frame(s)')) : null,
      f === 'sprites' ? row('Padding', num(settings.padding, { min: 0, max: 64 }, (v) => { settings.padding = Math.max(0, Math.round(v)); }), h('span', { class: 'unit' }, 'px')) : null,
      f === 'sprites' ? check(settings.json, (v) => { settings.json = v; }, 'Also save frame data (.json, TexturePacker format)') : null,
    );
  };

  const go = async () => {
    abort = new AbortController();
    exportBtn.disabled = true;
    status.textContent = 'Rendering…';
    const base = {
      from: Math.min(settings.from, settings.to), to: Math.max(settings.from, settings.to),
      effects: settings.effects, signal: abort.signal,
      onProgress: (d: number, t: number) => { progress.value = d / t; status.textContent = `Frame ${d} / ${t}`; },
    };
    const name = (p.name || 'stickman').replace(/[^\w\- ]+/g, '').trim() || 'stickman';
    try {
      if (settings.format === 'gif') {
        const data = await exportGif(p, { ...base, scale: settings.gifScale, step: settings.step, loop: settings.loop });
        status.textContent = 'Saving…';
        await saveFile(name, 'gif', 'image/gif', data);
      } else if (settings.format === 'mp4') {
        const res = await exportVideo(p, { ...base, scale: settings.scale, bitrate: settings.mbps * 1e6 });
        status.textContent = 'Saving…';
        await saveFile(name, res.ext, res.mime, res.data);
        if (res.note) await alertUser('Video saved as WebM', res.note);
      } else {
        const sheet = await exportSpriteSheet(p, { ...base, scale: settings.scale, step: settings.step, columns: settings.columns, padding: settings.padding });
        status.textContent = 'Saving…';
        const saved = await saveFile(`${name}-sheet`, 'png', 'image/png', sheet.png);
        if (saved && settings.json) {
          const imageName = saved.split(/[\\/]/).pop() ?? `${name}-sheet.png`;
          await saveFile(`${name}-sheet`, 'json', 'application/json', sheet.json.replace('"image": ""', `"image": ${JSON.stringify(imageName)}`));
        }
      }
      close();
    } catch (err) {
      if (err instanceof ExportCancelled) { status.textContent = 'Cancelled.'; }
      else {
        console.error(err);
        status.textContent = '';
        await alertUser('Export failed', err instanceof Error ? err.message : String(err));
      }
      abort = null;
      exportBtn.disabled = false;
      progress.value = 0;
    }
  };

  const exportBtn = button('Export', go, { class: 'primary' });
  overlay.append(h('div', { class: 'modal', role: 'dialog' },
    h('h2', {}, 'Export animation'),
    body,
    progress,
    status,
    h('div', { class: 'modal-actions' }, button('Cancel', close), exportBtn),
  ));
  renderBody();
  document.body.append(overlay);
}
