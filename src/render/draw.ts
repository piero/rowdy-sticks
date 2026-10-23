import type { Figure, Pose, Project, Solved, SolvedBone } from '../model/types';
import { itemState, itemLocal } from '../model/pose';
import { solve } from '../model/skeleton';
import { drawHeadFeatures } from './headFeatures';
import { drawExtras } from './extras';
import { drawWeapon } from './weapons';
import { figWorld, type FigWorld } from '../sim/world';
import { getContacts, type HitEvent } from '../sim/contacts';
import { rng } from '../sim/geom';

type Ctx = CanvasRenderingContext2D;

export interface DrawOpts {
  /** Frame number, drives flutter of scarves/hair. */
  t: number;
  background: string;
}

function strokeLimb(ctx: Ctx, bones: SolvedBone[], lw: number, color: string) {
  if (bones.length === 0) return;
  ctx.strokeStyle = color;
  if (bones[0].bone.shape === 'tentacle') {
    // Taper by stroking segment by segment.
    for (const b of bones) {
      ctx.lineWidth = lw * b.bone.width;
      ctx.beginPath();
      ctx.moveTo(b.sx, b.sy);
      ctx.lineTo(b.ex, b.ey);
      ctx.stroke();
    }
    return;
  }
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(bones[0].sx, bones[0].sy);
  for (const b of bones) ctx.lineTo(b.ex, b.ey);
  ctx.stroke();
}

function limbsBySide(solved: Solved) {
  const limbs = new Map<string, SolvedBone[]>();
  for (const sb of solved.values()) {
    const r = sb.bone.role;
    if (r !== 'arm' && r !== 'leg' && r !== 'tentacle') continue;
    let l = limbs.get(sb.bone.limb);
    if (!l) { l = []; limbs.set(sb.bone.limb, l); }
    l.push(sb);
  }
  for (const l of limbs.values()) l.sort((a, b) => a.bone.seg - b.bone.seg);
  const back: SolvedBone[][] = [], front: SolvedBone[][] = [];
  for (const l of limbs.values()) (l[0].bone.side === 'B' ? back : front).push(l);
  // Legs behind arms on each side.
  const order = (l: SolvedBone[]) => (l[0].bone.role === 'arm' ? 1 : 0);
  back.sort((a, b) => order(a) - order(b));
  front.sort((a, b) => order(a) - order(b));
  return { back, front };
}

/** Draw a figure (body + attached items) at a pose. Free items are drawn by drawFreeItems. */
export function drawFigure(ctx: Ctx, fig: Figure, pose: Pose, opts: DrawOpts, solvedIn?: Solved) {
  const solved = solvedIn ?? solve(fig, pose);
  const lw = fig.lineWidth;
  const color = fig.color;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale((pose.flip ? -1 : 1) * fig.scale, fig.scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const torso = solved.get('torso')!;
  const head = solved.get('head');
  const torsoFrame = (fn: () => void) => {
    ctx.save();
    ctx.translate(torso.sx, torso.sy);
    ctx.rotate(torso.ang + Math.PI / 2);
    fn();
    ctx.restore();
  };
  const headFrame = (fn: (r: number) => void) => {
    if (!head) return;
    ctx.save();
    ctx.translate((head.sx + head.ex) / 2, (head.sy + head.ey) / 2);
    ctx.rotate(head.ang + Math.PI / 2);
    fn(head.bone.length / 2);
    ctx.restore();
  };

  // Items attached to back-side bones are drawn behind the body.
  const itemsOn = (side: 'B' | 'F' | 'C') => fig.items.filter((it) => {
    const st = itemState(fig, pose, it);
    if (!st.attached || !st.visible) return false;
    const b = solved.get(st.bone)?.bone;
    return (b?.side ?? 'F') === side || (side === 'F' && b?.side === 'C');
  });
  const drawItems = (side: 'B' | 'F') => {
    for (const it of itemsOn(side)) {
      const st = itemState(fig, pose, it);
      const l = itemLocal(fig, solved, st);
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.ang);
      ctx.scale(it.scale, it.scale);
      drawWeapon(ctx, it, st);
      ctx.restore();
    }
  };

  torsoFrame(() => drawExtras(ctx, fig.extras, 'back', torso.bone.length, lw, opts.t));
  headFrame((r) => drawHeadFeatures(ctx, fig.headFeatures, r, 'back', opts.t));

  const { back, front } = limbsBySide(solved);
  const backColor = color;
  for (const l of back) strokeLimb(ctx, l, lw, backColor);
  drawItems('B');

  // Torso and neck.
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(torso.sx, torso.sy);
  ctx.lineTo(torso.ex, torso.ey);
  const neck = solved.get('neck');
  if (neck) ctx.lineTo(neck.ex, neck.ey);
  ctx.stroke();

  // Head.
  headFrame((r) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    if (fig.headStyle === 'filled') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = opts.background;
      ctx.fill();
      ctx.lineWidth = lw * 0.8;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r - lw * 0.4, 0, 2 * Math.PI);
      ctx.stroke();
    }
    drawHeadFeatures(ctx, fig.headFeatures, r, 'front', opts.t);
  });

  for (const l of front) strokeLimb(ctx, l, lw, color);
  torsoFrame(() => drawExtras(ctx, fig.extras, 'front', torso.bone.length, lw, opts.t));
  drawItems('F');
  ctx.restore();
}

export function drawFreeItems(ctx: Ctx, w: FigWorld) {
  for (const { item, xf, visible } of w.items) {
    const st = itemState(w.fig, w.pose, item);
    if (st.attached || !visible) continue;
    ctx.save();
    ctx.translate(xf.x, xf.y);
    ctx.rotate(xf.ang);
    ctx.scale(xf.scale, xf.mirror ? -xf.scale : xf.scale);
    drawWeapon(ctx, item, st);
    ctx.restore();
  }
}

/** Motion smear behind fast-moving blades. */
function drawTrails(ctx: Ctx, fig: Figure, frame: number) {
  const cur = new Set(figWorld(fig, frame).blades.map((b) => b.id));
  for (let d = 1; d <= 3; d++) {
    if (frame - d < 0) break;
    const a = figWorld(fig, frame - d + 1), b = figWorld(fig, frame - d);
    const prevById = new Map(b.blades.map((x) => [x.id, x]));
    for (const bl of a.blades) {
      if (!cur.has(bl.id)) continue;
      const pb = prevById.get(bl.id);
      if (!pb) continue;
      const moved = Math.hypot(bl.b.x - pb.b.x, bl.b.y - pb.b.y);
      if (moved < 6) continue;
      ctx.fillStyle = `rgba(150, 175, 210, ${0.22 * (1 - (d - 1) / 3)})`;
      ctx.beginPath();
      ctx.moveTo(bl.a.x, bl.a.y);
      ctx.lineTo(bl.b.x, bl.b.y);
      ctx.lineTo(pb.b.x, pb.b.y);
      ctx.lineTo(pb.a.x, pb.a.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

const EFFECT_FRAMES = 12;

function drawEffect(ctx: Ctx, ev: HitEvent, age: number, blood: boolean, scale: number) {
  const R = rng(ev.seed);
  const k = age / EFFECT_FRAMES;
  ctx.save();
  if (ev.kind === 'shot') {
    if (age <= 1 && ev.from) {
      ctx.strokeStyle = `rgba(255, 214, 90, ${1 - age * 0.5})`;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(ev.from.x, ev.from.y);
      ctx.lineTo(ev.x, ev.y);
      ctx.stroke();
      // Muzzle flash.
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      const fx = ev.from.x, fy = ev.from.y, a = Math.atan2(ev.dy, ev.dx);
      for (let i = 0; i < 10; i++) {
        const aa = a + (i / 10) * Math.PI * 2;
        const rr = (i % 2 ? 4 : 12) * scale * (1 - age * 0.4) * (i === 0 ? 1.6 : 1);
        ctx.lineTo(fx + Math.cos(aa) * rr, fy + Math.sin(aa) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (!ev.target) { ctx.restore(); return; }
  }
  const alpha = 1 - k;
  if (ev.kind === 'impact' || ev.kind === 'shot') {
    if (age < 5) {
      const rad = (10 + age * 5) * scale * (ev.kind === 'shot' ? 0.6 : 1);
      ctx.fillStyle = `rgba(255, 236, 140, ${0.9 * (1 - age / 5)})`;
      ctx.strokeStyle = `rgba(240, 120, 30, ${1 - age / 5})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const aa = (i / 16) * Math.PI * 2 + ev.seed;
        const rr = i % 2 ? rad * 0.45 : rad * (0.8 + R() * 0.5);
        ctx.lineTo(ev.x + Math.cos(aa) * rr, ev.y + Math.sin(aa) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Speed lines.
    ctx.strokeStyle = `rgba(30, 30, 30, ${0.6 * alpha})`;
    ctx.lineWidth = 1.2 * scale;
    for (let i = 0; i < 6; i++) {
      const aa = Math.atan2(ev.dy, ev.dx) + (R() - 0.5) * 2.2;
      const r0 = (14 + age * 4) * scale, r1 = r0 + (10 + R() * 12) * scale;
      ctx.beginPath();
      ctx.moveTo(ev.x + Math.cos(aa) * r0, ev.y + Math.sin(aa) * r0);
      ctx.lineTo(ev.x + Math.cos(aa) * r1, ev.y + Math.sin(aa) * r1);
      ctx.stroke();
    }
  }
  if (ev.kind === 'slash' && age < 7) {
    // Anime-style slash: a thin crescent along the cut, white core with a dark rim.
    const a = Math.atan2(ev.dy, ev.dx) + 0.6;
    const L = 58 * scale * (0.7 + age * 0.08);
    const w = 7 * scale * (1 - age / 7);
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    ctx.beginPath();
    ctx.moveTo(ev.x - ux * L, ev.y - uy * L);
    ctx.quadraticCurveTo(ev.x + nx * w * 2, ev.y + ny * w * 2, ev.x + ux * L, ev.y + uy * L);
    ctx.quadraticCurveTo(ev.x - nx * w * 0.5, ev.y - ny * w * 0.5, ev.x - ux * L, ev.y - uy * L);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${1 - age / 7})`;
    ctx.strokeStyle = `rgba(20, 20, 30, ${0.85 * (1 - age / 7)})`;
    ctx.lineWidth = 1.4 * scale;
    ctx.fill();
    ctx.stroke();
    if (age < 3) {
      const g = ctx.createRadialGradient(ev.x, ev.y, 0, ev.x, ev.y, 26 * scale);
      g.addColorStop(0, `rgba(255, 250, 220, ${0.9 - age * 0.3})`);
      g.addColorStop(1, 'rgba(255, 250, 220, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ev.x, ev.y, 26 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const particles = (n: number, color: string, speed: number, gravity: number, size: number, cone: number) => {
    const base = Math.atan2(ev.dy, ev.dx);
    for (let i = 0; i < n; i++) {
      const aa = base + (R() - 0.5) * cone;
      const v = speed * (0.4 + R() * 0.8) * scale;
      const px = ev.x + Math.cos(aa) * v * age;
      const py = ev.y + Math.sin(aa) * v * age + 0.5 * gravity * scale * age * age;
      const sz = size * scale * (0.6 + R() * 0.8) * (1 - k * 0.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  if (ev.kind === 'clash') particles(14, '#ffd43b', 5, 0.6, 1.6, Math.PI * 2);
  if (ev.kind === 'slash') {
    particles(8, '#fff3bf', 5, 0.3, 1.3, 1.4);
    if (blood) {
      particles(22, '#e03131', 5.5, 1.0, 2.6, 1.8);
      particles(10, '#8f0d0d', 3.5, 1.1, 3.2, 1.2);
    }
  }
  if (ev.kind === 'shot' && blood) particles(16, '#e03131', 4, 0.9, 2.4, 1.2);
  if (ev.kind === 'impact') particles(5, 'rgba(60,60,60,0.8)', 2.5, 0.2, 1.2, 2.4);
  ctx.restore();
}

export interface SceneOpts {
  effects?: boolean;
  /** Extra drawing inside the stage transform, after figures (editor overlays). */
  overlay?: (ctx: Ctx) => void;
  /** Draw these before the real figures (onion skin). */
  underlay?: (ctx: Ctx) => void;
}

export function shakeOffset(events: HitEvent[], frame: number): { x: number; y: number } {
  let x = 0, y = 0;
  for (const ev of events) {
    const age = frame - ev.frame;
    if (age < 0 || age > 5 || (ev.kind === 'shot' && !ev.target)) continue;
    const amp = (ev.kind === 'impact' ? 5 : ev.kind === 'slash' ? 4 : 2.5) * (1 - age / 6);
    const R = rng(ev.seed + age * 7919);
    x += (R() - 0.5) * 2 * amp;
    y += (R() - 0.5) * 2 * amp;
  }
  return { x, y };
}

/** Render a full frame of the project into ctx (in stage units). */
export function drawScene(ctx: Ctx, project: Project, frame: number, opts: SceneOpts = {}) {
  const showFx = opts.effects ?? true;
  const events = showFx && project.effects.hits ? getContacts(project) : [];
  ctx.save();
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, project.width, project.height);
  if (showFx && project.effects.shake) {
    const s = shakeOffset(events, frame);
    ctx.translate(s.x, s.y);
  }
  if (project.showGround) {
    ctx.fillStyle = project.groundColor;
    ctx.fillRect(-50, project.groundY, project.width + 100, project.height - project.groundY + 50);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-50, project.groundY);
    ctx.lineTo(project.width + 50, project.groundY);
    ctx.stroke();
  }
  opts.underlay?.(ctx);
  const draw = { t: frame, background: project.background };
  for (const fig of project.figures) {
    if (!fig.visible) continue;
    if (showFx && project.effects.trails) drawTrails(ctx, fig, frame);
    const w = figWorld(fig, frame);
    drawFigure(ctx, fig, w.pose, draw, w.solved);
  }
  for (const fig of project.figures) if (fig.visible) drawFreeItems(ctx, figWorld(fig, frame));
  if (showFx) {
    for (const ev of events) {
      const age = frame - ev.frame;
      if (age < 0 || age > EFFECT_FRAMES) continue;
      const fig = project.figures.find((f) => f.id === ev.attacker);
      drawEffect(ctx, ev, age, project.effects.blood, fig?.scale ?? 1);
    }
  }
  opts.overlay?.(ctx);
  ctx.restore();
}
