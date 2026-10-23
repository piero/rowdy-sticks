import type { Bone, Figure, Item, Pose, Vec } from '../model/types';
import type { Editor } from './state';
import { drawFigure, drawScene } from '../render/draw';
import { figWorld, type FigWorld } from '../sim/world';
import { ensureKey, fillItems, itemPointWorld, itemState, itemWorld, unwrapNear, type WorldXf } from '../model/pose';
import { angleToLocal, getBone, getBones, limbBonesOf, parentAngle, solve, toLocal, toWorld } from '../model/skeleton';
import { WEAPONS } from '../model/weapons';
import { distPointSeg } from '../sim/geom';

type HandleKind = 'root' | 'bone' | 'itemTip' | 'itemGrip';
interface Handle {
  kind: HandleKind;
  fig: Figure;
  p: Vec; // world (stage) position
  bone?: Bone;
  item?: Item;
  color: string;
  size: number;
}

interface Drag {
  handle: Handle;
  start: Vec;
  origin: Pose;
  ik: boolean;
  /** Alt-drag on a flexible weapon rotates the whole item instead of bending it. */
  rotateFlexible: boolean;
}

const ROLE_COLOR: Record<string, string> = {
  torso: '#f59f00', neck: '#f59f00', head: '#f59f00', arm: '#1c7ed6', leg: '#2f9e44', tentacle: '#9c36b5',
};

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoom = 1;
  private ox = 0;
  private oy = 0;
  private fitted = false;
  private drag: Drag | null = null;
  private pan: { x: number; y: number; ox: number; oy: number } | null = null;
  private hover: Handle | null = null;
  private spaceDown = false;
  private raf = 0;

  constructor(private ed: Editor, private host: HTMLElement, private status: (msg: string) => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.fit());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
    for (const ev of ['project', 'frame', 'selection', 'view', 'structure'] as const) ed.on(ev, () => this.requestDraw());
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  fit() {
    const r = this.host.getBoundingClientRect();
    const p = this.ed.project;
    const pad = 28;
    this.zoom = Math.max(0.05, Math.min((r.width - pad * 2) / p.width, (r.height - pad * 2) / p.height));
    this.ox = (r.width - p.width * this.zoom) / 2;
    this.oy = (r.height - p.height * this.zoom) / 2;
    this.fitted = true;
    this.requestDraw();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    if (!this.fitted || !this.drag) this.fit();
    this.draw();
  }

  private toStage(e: { clientX: number; clientY: number }): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.ox) / this.zoom, y: (e.clientY - r.top - this.oy) / this.zoom };
  }

  private toScreen(p: Vec): Vec {
    return { x: this.ox + p.x * this.zoom, y: this.oy + p.y * this.zoom };
  }

  // ---------------------------------------------------------------- drawing

  draw() {
    const { ctx, ed } = this;
    const p = ed.project;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.host);
    ctx.fillStyle = css.getPropertyValue('--stage-bg').trim() || '#2b2d31';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.zoom, this.zoom);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.rect(0, 0, p.width, p.height);
    ctx.clip();
    drawScene(ctx, p, ed.frame, {
      effects: ed.showFx,
      underlay: ed.onion && !ed.playing ? (c) => this.drawOnion(c) : undefined,
    });
    ctx.restore();

    if (!ed.playing) this.drawHandles();
  }

  private drawOnion(ctx: CanvasRenderingContext2D) {
    const f = this.ed.frame;
    for (const fig of this.ed.project.figures) {
      if (!fig.visible) continue;
      const prev = [...fig.keys].reverse().find((k) => k.frame < f);
      const next = fig.keys.find((k) => k.frame > f);
      // Previous key in orange, next key in green.
      for (const [k, tint] of [[prev, '#d9480f'], [next, '#2b8a3e']] as const) {
        if (!k) continue;
        ctx.save();
        ctx.globalAlpha = 0.28;
        drawFigure(ctx, { ...fig, color: tint }, k.pose, { t: k.frame, background: this.ed.project.background });
        ctx.restore();
      }
    }
  }

  private handles(): Handle[] {
    const fig = this.ed.fig;
    if (!fig || !fig.visible) return [];
    const w = figWorld(fig, this.ed.frame);
    const out: Handle[] = [];
    out.push({ kind: 'root', fig, p: toWorld(fig, w.pose, { x: 0, y: 0 }), color: '#e8590c', size: 7 });
    for (const sb of w.solved.values()) {
      if (sb.bone.role === 'neck') continue;
      const isEnd = !getBones(fig).some((b) => b.parent === sb.bone.id && b.limb === sb.bone.limb);
      out.push({
        kind: 'bone', fig, bone: sb.bone, p: toWorld(fig, w.pose, { x: sb.ex, y: sb.ey }),
        color: ROLE_COLOR[sb.bone.role] ?? '#888', size: isEnd && sb.bone.role !== 'torso' ? 6 : 5,
      });
    }
    for (const { item, xf, visible } of w.items) {
      if (!visible) continue;
      const st = itemState(fig, w.pose, item);
      const [tx, ty] = WEAPONS[item.type].tip(st.bend);
      out.push({ kind: 'itemTip', fig, item, p: itemPointWorld(xf, tx, ty), color: '#e03131', size: 5 });
      if (!st.attached) out.push({ kind: 'itemGrip', fig, item, p: { x: xf.x, y: xf.y }, color: '#e03131', size: 6 });
    }
    return out;
  }

  private drawHandles() {
    const { ctx } = this;
    const fig = this.ed.fig;
    if (!fig) return;
    const w = figWorld(fig, this.ed.frame);
    // Selection outline: faint bones in screen space.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(28, 126, 214, 0.55)';
    for (const s of w.segs) {
      const a = this.toScreen(s.a), b = this.toScreen(s.b);
      ctx.beginPath();
      if (s.circle) ctx.arc(a.x, a.y, s.r * this.zoom + 3, 0, Math.PI * 2);
      else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    const keyed = fig.keys.some((k) => k.frame === this.ed.frame);
    for (const hd of this.handles()) {
      const s = this.toScreen(hd.p);
      const hot = this.hover && this.hover.kind === hd.kind && this.hover.bone === hd.bone && this.hover.item === hd.item;
      const r = hd.size + (hot ? 2 : 0);
      ctx.fillStyle = hd.color;
      ctx.strokeStyle = keyed ? '#fff' : '#ffe066';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (hd.kind === 'root' || hd.kind === 'itemGrip') ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
      else if (hd.kind === 'itemTip') { ctx.moveTo(s.x, s.y - r - 1); ctx.lineTo(s.x + r + 1, s.y); ctx.lineTo(s.x, s.y + r + 1); ctx.lineTo(s.x - r - 1, s.y); ctx.closePath(); }
      else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- picking

  private pickHandle(e: PointerEvent): Handle | null {
    const m = this.toScreen(this.toStage(e));
    let best: Handle | null = null, bestD = 11;
    for (const hd of this.handles()) {
      const s = this.toScreen(hd.p);
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      // Prefer item and limb-end handles when overlapping a joint.
      const bias = hd.kind === 'itemTip' || hd.kind === 'itemGrip' ? -2 : 0;
      if (d + bias < bestD) { best = hd; bestD = d + bias; }
    }
    return best;
  }

  private pickFigure(e: PointerEvent): Figure | null {
    const p = this.toStage(e);
    const tol = 7 / this.zoom;
    const figs = this.ed.project.figures.filter((f) => f.visible);
    for (let i = figs.length - 1; i >= 0; i--) {
      const w: FigWorld = figWorld(figs[i], this.ed.frame);
      for (const s of w.segs) {
        const d = s.circle ? Math.hypot(p.x - s.a.x, p.y - s.a.y) - s.r : distPointSeg(p, s.a, s.b) - s.r;
        if (d < tol) return figs[i];
      }
      for (const b of w.blades) if (distPointSeg(p, b.a, b.b) < tol) return figs[i];
    }
    return null;
  }

  // ---------------------------------------------------------------- input

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
      return;
    }
    if (this.ed.playing) { this.ed.playing = false; this.ed.emit('view'); }
    const hd = this.pickHandle(e);
    if (hd) {
      this.ed.checkpoint();
      const key = ensureKey(hd.fig, this.ed.frame);
      fillItems(hd.fig, key.pose);
      this.ed.selKey = key.frame;
      this.drag = {
        handle: hd, start: this.toStage(e), origin: JSON.parse(JSON.stringify(key.pose)),
        ik: (this.ed.tool === 'ik') !== e.shiftKey, rotateFlexible: e.altKey,
      };
      this.ed.changed();
      this.ed.emit('selection');
      return;
    }
    const fig = this.pickFigure(e);
    if (fig) {
      const changed = fig.id !== this.ed.selFig;
      this.ed.select(fig.id, fig.keys.some((k) => k.frame === this.ed.frame) ? this.ed.frame : null);
      if (!changed) {
        // Dragging the body of the selected figure moves it.
        this.ed.checkpoint();
        const key = ensureKey(fig, this.ed.frame);
        const root = toWorld(fig, key.pose, { x: 0, y: 0 });
        this.drag = { handle: { kind: 'root', fig, p: root, color: '', size: 0 }, start: this.toStage(e), origin: JSON.parse(JSON.stringify(key.pose)), ik: false, rotateFlexible: false };
        this.ed.changed();
      }
    } else {
      this.ed.select(null);
    }
  }

  private onMove(e: PointerEvent) {
    if (this.pan) {
      this.ox = this.pan.ox + e.clientX - this.pan.x;
      this.oy = this.pan.oy + e.clientY - this.pan.y;
      this.requestDraw();
      return;
    }
    if (this.drag) {
      this.applyDrag(this.toStage(e), e);
      return;
    }
    const hd = this.pickHandle(e);
    if (hd !== this.hover && (hd?.bone !== this.hover?.bone || hd?.kind !== this.hover?.kind || hd?.item !== this.hover?.item)) {
      this.hover = hd;
      this.canvas.style.cursor = hd ? (hd.kind === 'root' || hd.kind === 'itemGrip' ? 'move' : 'grab') : this.pickFigure(e) ? 'pointer' : 'default';
      this.status(hd ? describe(hd, this.ed.tool) : '');
      this.requestDraw();
    }
  }

  private onUp(e: PointerEvent) {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.pan = null;
    if (this.drag) {
      this.drag = null;
      this.ed.endEdit();
      this.ed.changed();
      this.ed.emit('selection');
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const z = Math.max(0.05, Math.min(20, this.zoom * k));
      this.ox = mx - ((mx - this.ox) * z) / this.zoom;
      this.oy = my - ((my - this.oy) * z) / this.zoom;
      this.zoom = z;
    } else {
      this.ox -= e.deltaX;
    }
    this.requestDraw();
  }

  private applyDrag(p: Vec, e: PointerEvent) {
    const d = this.drag!;
    const fig = d.handle.fig;
    const key = ensureKey(fig, this.ed.frame);
    const pose = key.pose;
    const hd = d.handle;
    if (hd.kind === 'root') {
      pose.x = d.origin.x + (p.x - d.start.x);
      pose.y = d.origin.y + (p.y - d.start.y);
      // Free items aren't carried along by the body.
    } else if (hd.kind === 'bone' && hd.bone) {
      const ikChain = d.ik ? this.ikChain(fig, hd.bone) : [];
      if (ikChain.length > 1) solveCCD(fig, pose, ikChain, toLocal(fig, pose, p));
      else aimBone(fig, pose, hd.bone, toLocal(fig, pose, p));
    } else if (hd.item) {
      const st = pose.items[hd.item.id];
      const def = WEAPONS[hd.item.type];
      const solved = solve(fig, pose);
      const xf = itemWorld(fig, pose, solved, hd.item, st);
      if (hd.kind === 'itemGrip') {
        const o = d.origin.items[hd.item.id];
        st.x = o.x + (p.x - d.start.x);
        st.y = o.y + (p.y - d.start.y);
      } else if (def.flexible && !d.rotateFlexible && !e.altKey) {
        const l = worldToItem(xf, p);
        st.bend = hd.item.type === 'nunchaku'
          ? unwrapNear(Math.atan2(l.y, l.x - 20), st.bend)
          : unwrapNear(Math.atan2(l.y, l.x + 4) - Math.PI, st.bend);
      } else {
        const [tx, ty] = def.tip(st.bend);
        const tipOff = Math.atan2(xf.mirror ? -ty : ty, tx);
        const worldAng = Math.atan2(p.y - xf.y, p.x - xf.x) - tipOff;
        if (st.attached) {
          const sb = solved.get(st.bone) ?? solved.get('torso')!;
          st.angle = unwrapNear(angleToLocal(pose, worldAng) - sb.ang, st.angle);
        } else {
          st.angle = unwrapNear(worldAng, st.angle);
        }
      }
    }
    this.ed.changed();
  }

  /** IK chain ending at `bone`: up to two bones for normal limbs, the whole limb for tentacles. */
  private ikChain(fig: Figure, bone: Bone): Bone[] {
    if (bone.role === 'torso' || bone.role === 'head' || bone.role === 'neck') return [bone];
    const limb = limbBonesOf(fig, bone.limb).filter((b) => b.seg <= bone.seg);
    return bone.shape === 'tentacle' ? limb.reverse() : limb.slice(-2).reverse();
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function describe(hd: Handle, tool: string): string {
  switch (hd.kind) {
    case 'root': return 'Drag to move the whole stickman';
    case 'itemTip': return WEAPONS[hd.item!.type].flexible ? 'Drag to swing the chain · Alt+drag rotates the weapon' : 'Drag to rotate the weapon';
    case 'itemGrip': return 'Drag to move the free weapon';
    default: return `Drag to pose ${hd.bone!.id} (${tool === 'ik' ? 'IK' : 'FK'}) · hold Shift for ${tool === 'ik' ? 'FK' : 'IK'}`;
  }
}

function worldToItem(xf: WorldXf, p: Vec): Vec {
  const dx = (p.x - xf.x) / xf.scale, dy = (p.y - xf.y) / xf.scale;
  const c = Math.cos(-xf.ang), s = Math.sin(-xf.ang);
  const x = dx * c - dy * s, y = dx * s + dy * c;
  return { x, y: xf.mirror ? -y : y };
}

/** FK: rotate a single bone so its end points at the target (figure-local). */
function aimBone(fig: Figure, pose: Pose, bone: Bone, target: Vec) {
  const solved = solve(fig, pose);
  const sb = solved.get(bone.id)!;
  const ang = Math.atan2(target.y - sb.sy, target.x - sb.sx);
  const rel = ang - parentAngle(solved, bone);
  pose.angles[bone.id] = unwrapNear(rel, pose.angles[bone.id] ?? bone.rest);
}

/** Cyclic coordinate descent; chain[0] is the end effector bone. */
function solveCCD(fig: Figure, pose: Pose, chain: Bone[], target: Vec) {
  const effector = chain[0];
  for (let iter = 0; iter < 12; iter++) {
    for (const b of chain) {
      const solved = solve(fig, pose);
      const end = solved.get(effector.id)!;
      const sb = solved.get(b.id)!;
      const a1 = Math.atan2(end.ey - sb.sy, end.ex - sb.sx);
      const a2 = Math.atan2(target.y - sb.sy, target.x - sb.sx);
      const cur = pose.angles[b.id] ?? getBone(fig, b.id)?.rest ?? 0;
      pose.angles[b.id] = cur + unwrapNear(a2 - a1, 0) * (b === effector ? 1 : 0.8);
    }
    const s = solve(fig, pose).get(effector.id)!;
    if (Math.hypot(s.ex - target.x, s.ey - target.y) < 0.3) break;
  }
}
