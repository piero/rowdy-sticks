import type { Editor } from './state';
import type { Figure } from '../model/types';
import { getContacts } from '../sim/contacts';
import { ensureKey, sortKeys } from '../model/pose';

const LABEL_W = 150;
const RULER_H = 22;
const ROW_H = 26;

interface KeyDrag { fig: Figure; from: number; current: number; moved: boolean }

export class Timeline {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scrollX = 0;
  private scrollY = 0;
  private ppf = 10; // pixels per frame
  private autoFit = true;
  private scrub = false;
  private keyDrag: KeyDrag | null = null;
  private raf = 0;

  constructor(private ed: Editor, private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'timeline-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    for (const ev of ['project', 'frame', 'selection', 'structure'] as const) ed.on(ev, () => this.requestDraw());
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private get width() { return this.canvas.width / (window.devicePixelRatio || 1); }
  private get height() { return this.canvas.height / (window.devicePixelRatio || 1); }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.draw();
  }

  private layout() {
    const avail = this.width - LABEL_W - 16;
    if (this.autoFit) this.ppf = Math.max(3, avail / Math.max(1, this.ed.project.frames));
    const maxScroll = Math.max(0, this.ed.project.frames * this.ppf - avail);
    this.scrollX = Math.max(0, Math.min(maxScroll, this.scrollX));
    const rowsH = this.ed.project.figures.length * ROW_H;
    this.scrollY = Math.max(0, Math.min(Math.max(0, rowsH - (this.height - RULER_H)), this.scrollY));
  }

  private frameX(f: number) { return LABEL_W + 8 + f * this.ppf - this.scrollX + this.ppf / 2; }
  private xFrame(x: number) { return Math.floor((x - LABEL_W - 8 + this.scrollX) / this.ppf); }

  draw() {
    this.layout();
    const { ctx, ed } = this;
    const p = ed.project;
    const W = this.width, H = this.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.host);
    const col = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const bg = col('--tl-bg', '#1e1f22'), rowA = col('--tl-row', '#26272b'), rowB = col('--tl-row-alt', '#2b2c31');
    const fg = col('--tl-fg', '#c9cbd1'), dim = col('--tl-dim', '#6d7079'), accent = col('--accent', '#4dabf7');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';

    // Rows.
    const events = p.effects.hits ? getContacts(p) : [];
    p.figures.forEach((fig, i) => {
      const y = RULER_H + i * ROW_H - this.scrollY;
      if (y + ROW_H < RULER_H || y > H) return;
      const sel = fig.id === ed.selFig;
      ctx.fillStyle = sel ? col('--tl-sel', '#30405a') : i % 2 ? rowB : rowA;
      ctx.fillRect(0, y, W, ROW_H);
      ctx.fillStyle = fig.color;
      ctx.fillRect(8, y + 8, 10, 10);
      ctx.fillStyle = fig.visible ? fg : dim;
      ctx.fillText(ellipsize(ctx, fig.name, LABEL_W - 30), 24, y + ROW_H / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(LABEL_W, y, W - LABEL_W, ROW_H);
      ctx.clip();
      // Spans between keys.
      if (fig.keys.length > 1) {
        ctx.fillStyle = sel ? 'rgba(77,171,247,0.18)' : 'rgba(255,255,255,0.05)';
        const x0 = this.frameX(fig.keys[0].frame), x1 = this.frameX(fig.keys[fig.keys.length - 1].frame);
        ctx.fillRect(x0, y + 9, x1 - x0, ROW_H - 18);
      }
      for (const k of fig.keys) {
        const frame = this.keyDrag && this.keyDrag.fig === fig && this.keyDrag.from === k.frame ? this.keyDrag.current : k.frame;
        const x = this.frameX(frame), cy = y + ROW_H / 2;
        const isSel = sel && ed.selKey === k.frame;
        const r = Math.min(6, Math.max(3, this.ppf * 0.45));
        ctx.fillStyle = isSel ? '#ffd43b' : k.ease === 'step' ? '#adb5bd' : sel ? accent : '#8ea6c4';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (Object.values(k.pose.items).some((s) => s.fire)) {
          ctx.fillStyle = '#ff922b';
          ctx.beginPath(); ctx.arc(x, cy - r - 3, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const ev of events) {
        if (ev.target !== fig.id) continue;
        const x = this.frameX(ev.frame);
        ctx.fillStyle = ev.kind === 'clash' ? '#fcc419' : '#fa5252';
        ctx.beginPath();
        ctx.moveTo(x - 4, y + ROW_H - 2); ctx.lineTo(x + 4, y + ROW_H - 2); ctx.lineTo(x, y + ROW_H - 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });

    // Ruler.
    ctx.fillStyle = col('--tl-ruler', '#18191c');
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, 0, W - LABEL_W, H);
    ctx.clip();
    const every = this.ppf >= 14 ? 5 : this.ppf >= 6 ? 10 : this.ppf >= 3 ? 20 : 50;
    for (let f = 0; f < p.frames; f++) {
      const x = this.frameX(f);
      if (x < LABEL_W - 10 || x > W + 10) continue;
      const major = f % every === 0;
      if (!major && this.ppf < 4) continue;
      ctx.strokeStyle = major ? dim : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, major ? 8 : 15);
      ctx.lineTo(x + 0.5, RULER_H);
      ctx.stroke();
      if (major) { ctx.fillStyle = fg; ctx.fillText(String(f), x + 3, 8); }
    }
    // End-of-animation shade.
    const endX = this.frameX(p.frames) - this.ppf / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(endX, 0, W - endX, H);
    // Playhead.
    const px = this.frameX(ed.frame);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, 0);
    ctx.lineTo(px + 0.5, H);
    ctx.stroke();
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = dim;
    ctx.fillText(`${p.fps} fps · ${(p.frames / p.fps).toFixed(1)} s`, 8, RULER_H / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(LABEL_W + 0.5, 0);
    ctx.lineTo(LABEL_W + 0.5, H);
    ctx.stroke();
  }

  private hit(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const rowIdx = Math.floor((y - RULER_H + this.scrollY) / ROW_H);
    const fig = y > RULER_H ? this.ed.project.figures[rowIdx] ?? null : null;
    return { x, y, fig, ruler: y <= RULER_H, label: x < LABEL_W };
  }

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const h = this.hit(e);
    if (h.ruler && !h.label) { this.scrub = true; this.ed.setFrame(this.xFrame(h.x)); return; }
    if (!h.fig) return;
    if (h.label) { this.ed.select(h.fig.id, null); return; }
    const key = h.fig.keys.find((k) => Math.abs(this.frameX(k.frame) - h.x) <= Math.max(5, this.ppf / 2));
    if (key) {
      this.ed.select(h.fig.id, key.frame);
      this.ed.setFrame(key.frame);
      this.ed.selKey = key.frame;
      this.keyDrag = { fig: h.fig, from: key.frame, current: key.frame, moved: false };
      this.ed.emit('selection');
    } else {
      this.ed.select(h.fig.id, null);
      this.scrub = true;
      this.ed.setFrame(this.xFrame(h.x));
    }
  }

  private onMove(e: PointerEvent) {
    const h = this.hit(e);
    if (this.scrub) { this.ed.setFrame(this.xFrame(h.x)); return; }
    if (this.keyDrag) {
      const f = Math.max(0, Math.min(this.ed.project.frames - 1, this.xFrame(h.x)));
      if (f !== this.keyDrag.current && !this.keyDrag.fig.keys.some((k) => k.frame === f && k.frame !== this.keyDrag!.from)) {
        this.keyDrag.current = f;
        this.keyDrag.moved = true;
        this.requestDraw();
      }
      return;
    }
    this.canvas.style.cursor = h.ruler ? 'ew-resize' : h.fig && h.fig.keys.some((k) => Math.abs(this.frameX(k.frame) - h.x) <= Math.max(5, this.ppf / 2)) ? 'grab' : 'default';
  }

  private onUp(e: PointerEvent) {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.scrub = false;
    const d = this.keyDrag;
    this.keyDrag = null;
    if (d && d.moved && d.current !== d.from) {
      this.ed.checkpoint();
      const k = d.fig.keys.find((kk) => kk.frame === d.from);
      if (k) {
        k.frame = d.current;
        sortKeys(d.fig);
        this.ed.selKey = d.current;
        this.ed.setFrame(d.current);
        this.ed.changed();
        this.ed.emit('selection');
      }
    }
    this.requestDraw();
  }

  private onDouble(e: MouseEvent) {
    const h = this.hit(e);
    if (!h.fig || h.label || h.ruler) return;
    const f = this.xFrame(h.x);
    this.ed.checkpoint();
    ensureKey(h.fig, f);
    this.ed.select(h.fig.id, f);
    this.ed.setFrame(f);
    this.ed.changed();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const frameAtMouse = (mx - LABEL_W - 8 + this.scrollX) / this.ppf;
      this.autoFit = false;
      this.ppf = Math.max(2, Math.min(60, this.ppf * Math.exp(-e.deltaY * 0.01)));
      this.scrollX = frameAtMouse * this.ppf - (mx - LABEL_W - 8);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.scrollX += e.deltaX || e.deltaY;
    } else {
      this.scrollY += e.deltaY;
    }
    this.requestDraw();
  }

  zoomToFit() { this.autoFit = true; this.scrollX = 0; this.requestDraw(); }
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, w: number) {
  if (ctx.measureText(s).width <= w) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}
