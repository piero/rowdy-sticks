import type { Figure, ItemState, Keyframe, Pose, Project, Vec } from '../model/types';
import { clonePose, evaluate, itemPointWorld, itemState, itemWorld, sortKeys, unwrapNear } from '../model/pose';
import { getBones, solve, toLocal, toWorld } from '../model/skeleton';

export interface RagdollOptions {
  startFrame: number;
  duration: number;
  /** World units per second squared. */
  gravity: number;
  /** 0 = completely limp, 1 = tries hard to hold the starting pose. */
  stiffness: number;
  bounce: number;
  friction: number;
  /** Extra velocity applied at `impulsePoint` (world units per second). */
  impulse?: { x: number; y: number; vx: number; vy: number; radius: number };
  dropItems: boolean;
  /** Bake a key every N frames. */
  keyEvery: number;
  /** Remove existing keys after the simulated range. */
  clearAfter: boolean;
}

export const DEFAULT_RAGDOLL: RagdollOptions = {
  startFrame: 0, duration: 48, gravity: 1400, stiffness: 0.08, bounce: 0.25, friction: 0.6,
  dropItems: true, keyEvery: 1, clearAfter: true,
};

interface P { x: number; y: number; px: number; py: number; r: number }
interface Link { a: number; b: number; len: number; /** for mid-bone anchors */ a2?: number; t?: number }

const SUBSTEPS = 4;
const ITER = 8;

/**
 * Simulate the figure as a Verlet ragdoll from `startFrame` and bake the result into
 * keyframes. Velocities come from the difference between startFrame-1 and startFrame.
 */
export function bakeRagdoll(project: Project, fig: Figure, opt: RagdollOptions): number {
  const f0 = Math.max(0, Math.round(opt.startFrame));
  const pose0 = evaluate(fig, f0);
  const posePrev = evaluate(fig, Math.max(0, f0 - 1));
  for (const s of Object.values(pose0.items)) s.fire = false;

  const bones = getBones(fig);
  const s = fig.scale;
  const lw = fig.lineWidth * s;
  const pts: P[] = [];
  const index = new Map<string, number>(); // bone id -> end point index
  const solvedNow = solve(fig, pose0);
  const solvedPrev = solve(fig, posePrev);

  const addPoint = (now: Vec, before: Vec, r: number) => {
    pts.push({ x: now.x, y: now.y, px: before.x, py: before.y, r });
    return pts.length - 1;
  };
  const root = addPoint(
    toWorld(fig, pose0, { x: 0, y: 0 }),
    toWorld(fig, posePrev, { x: 0, y: 0 }), lw / 2,
  );

  const links: Link[] = [];
  for (const b of bones) {
    const sn = solvedNow.get(b.id)!, sp = solvedPrev.get(b.id)!;
    // The head circle spans the neck end and the head end, so both carry its radius.
    const headBone = bones.find((x) => x.shape === 'head');
    const isHeadEnd = b.shape === 'head' || (headBone && headBone.parent === b.id);
    const r = isHeadEnd ? ((headBone?.length ?? b.length) * s) / 2 : (lw * b.width) / 2;
    const i = addPoint(toWorld(fig, pose0, { x: sn.ex, y: sn.ey }), toWorld(fig, posePrev, { x: sp.ex, y: sp.ey }), r);
    index.set(b.id, i);
    const startA = b.parent ? (index.get(b.parent) ?? root) : root;
    if (b.parent && b.at < 0.999) {
      const parent = bones.find((x) => x.id === b.parent)!;
      const pStart = parent.parent ? (index.get(parent.parent) ?? root) : root;
      links.push({ a: pStart, a2: startA, t: b.at, b: i, len: b.length * s });
    } else {
      links.push({ a: startA, b: i, len: b.length * s });
    }
  }

  // Rotational springs toward the starting relative angles.
  const startOf = (id: string): [number, number?, number?] => {
    const b = bones.find((x) => x.id === id)!;
    if (!b.parent) return [root];
    const parent = bones.find((x) => x.id === b.parent)!;
    const pEnd = index.get(parent.id)!;
    if (b.at >= 0.999) return [pEnd];
    const pStart = parent.parent ? index.get(parent.parent)! : root;
    return [pStart, pEnd, b.at];
  };
  const pointOf = (spec: [number, number?, number?]): Vec => {
    const [a, a2, t] = spec;
    if (a2 === undefined || t === undefined) return pts[a];
    return { x: pts[a].x + (pts[a2].x - pts[a].x) * t, y: pts[a].y + (pts[a2].y - pts[a].y) * t };
  };
  const angleOf = (id: string) => {
    const st = pointOf(startOf(id));
    const e = pts[index.get(id)!];
    return Math.atan2(e.y - st.y, e.x - st.x);
  };
  const refOf = (id: string): string | null => {
    const b = bones.find((x) => x.id === id)!;
    if (b.parent) return b.parent;
    return b.id === 'torso' ? null : 'torso';
  };
  const springs = bones
    .map((b) => ({ id: b.id, ref: refOf(b.id) }))
    .filter((x): x is { id: string; ref: string } => x.ref !== null && index.has(x.ref))
    .map((x) => ({ ...x, rest: angleOf(x.id) - angleOf(x.ref) }));

  // Items dropped from the hands become free two-point sticks.
  const dropped: { id: string; g: number; t: number; mirror: boolean; tipLocal: number }[] = [];
  if (opt.dropItems) {
    for (const item of fig.items) {
      const st = itemState(fig, pose0, item);
      if (!st.visible) continue;
      const xf = itemWorld(fig, pose0, solvedNow, item, st);
      const xfp = itemWorld(fig, posePrev, solvedPrev, item, itemState(fig, posePrev, item));
      const L = 20;
      const g = addPoint({ x: xf.x, y: xf.y }, { x: xfp.x, y: xfp.y }, 2);
      const tw = itemPointWorld(xf, L, 0), tp = itemPointWorld(xfp, L, 0);
      const t = addPoint(tw, tp, 2);
      links.push({ a: g, b: t, len: L * xf.scale });
      dropped.push({ id: item.id, g, t, mirror: xf.mirror, tipLocal: L });
    }
  }

  // Impulse: velocity is (x - px) per substep.
  const fps = project.fps;
  const dt = 1 / (fps * SUBSTEPS);
  if (opt.impulse) {
    const { x, y, vx, vy, radius } = opt.impulse;
    for (const p of pts) {
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      const w = 0.35 + 0.65 * Math.exp(-d2 / (2 * radius * radius));
      p.px -= vx * dt * w;
      p.py -= vy * dt * w;
    }
  }
  // Convert per-frame velocity to per-substep.
  for (const p of pts) {
    p.px = p.x - (p.x - p.px) / SUBSTEPS;
    p.py = p.y - (p.y - p.py) / SUBSTEPS;
  }

  const ground = project.groundY;
  const g = opt.gravity * dt * dt;
  const damping = 0.995;
  const frames: Vec[][] = [];

  for (let f = 1; f <= opt.duration; f++) {
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      for (const p of pts) {
        const vx = (p.x - p.px) * damping, vy = (p.y - p.py) * damping;
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + g;
      }
      // Muscle tone fades over the first half of the fall: the body goes limp, and the
      // springs can no longer lever a lying body back up off the floor.
      const tone = opt.stiffness * Math.max(0, 1 - f / (opt.duration * 0.5)) * 0.25;
      if (tone > 0) for (const sp of springs) applySpring(sp, tone);
      for (let it = 0; it < ITER; it++) {
        for (const l of links) satisfy(pts, l);
        for (const p of pts) collideGround(p, ground, opt.bounce, opt.friction);
      }
    }
    frames.push(pts.map((p) => ({ x: p.x, y: p.y })));
  }

  function applySpring(sp: { id: string; ref: string; rest: number }, k: number) {
    const cur = angleOf(sp.id) - angleOf(sp.ref);
    let diff = sp.rest - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)) * k;
    // Rotate the child's end around its start, the reference bone's end the other way.
    const st = pointOf(startOf(sp.id));
    rotate(pts[index.get(sp.id)!], st, diff * 0.5);
    const rs = pointOf(startOf(sp.ref));
    rotate(pts[index.get(sp.ref)!], rs, -diff * 0.5);
  }

  // Bake.
  const keys: Keyframe[] = [];
  let prevAngles = { ...pose0.angles };
  const every = Math.max(1, Math.round(opt.keyEvery));
  for (let f = 1; f <= opt.duration; f++) {
    if (f % every !== 0 && f !== opt.duration) continue;
    const P = frames[f - 1];
    const pose: Pose = clonePose(pose0);
    pose.x = P[root].x;
    pose.y = P[root].y;
    const localAng = new Map<string, number>();
    for (const b of bones) {
      const e = P[index.get(b.id)!];
      const spec = startOf(b.id);
      const [a, a2, t] = spec;
      const st = a2 === undefined || t === undefined ? P[a] : { x: P[a].x + (P[a2].x - P[a].x) * t, y: P[a].y + (P[a2].y - P[a].y) * t };
      const ls = toLocal(fig, pose, st), le = toLocal(fig, pose, e);
      const ang = Math.atan2(le.y - ls.y, le.x - ls.x);
      localAng.set(b.id, ang);
      const base = b.parent ? localAng.get(b.parent)! : 0;
      const rel = unwrapNear(ang - base, prevAngles[b.id] ?? b.rest);
      pose.angles[b.id] = rel;
    }
    prevAngles = { ...pose.angles };
    for (const d of dropped) {
      const gp = P[d.g], tp = P[d.t];
      const old = pose.items[d.id] ?? itemState(fig, pose0, fig.items.find((i) => i.id === d.id)!);
      const st: ItemState = { ...old, attached: false, x: gp.x, y: gp.y, angle: Math.atan2(tp.y - gp.y, tp.x - gp.x), mirror: d.mirror, fire: false };
      // Keep the item's own orientation consistent with its default grip angle.
      st.angle = unwrapNear(st.angle, (keys.at(-1)?.pose.items[d.id]?.angle) ?? st.angle);
      pose.items[d.id] = st;
    }
    keys.push({ frame: f0 + f, ease: 'linear', pose });
  }

  const end = f0 + opt.duration;
  fig.keys = fig.keys.filter((k) => k.frame <= f0 || (!opt.clearAfter && k.frame > end));
  // Make sure the start frame is keyed so the sim starts exactly from the current pose.
  if (!fig.keys.some((k) => k.frame === f0)) fig.keys.push({ frame: f0, ease: 'linear', pose: pose0 });
  else fig.keys.find((k) => k.frame === f0)!.ease = 'linear';
  fig.keys.push(...keys);
  sortKeys(fig);
  if (end >= project.frames) project.frames = end + 1;
  return keys.length;
}

function satisfy(pts: P[], l: Link) {
  const b = pts[l.b];
  if (l.a2 !== undefined && l.t !== undefined) {
    const a1 = pts[l.a], a2 = pts[l.a2], t = l.t;
    const ax = a1.x + (a2.x - a1.x) * t, ay = a1.y + (a2.y - a1.y) * t;
    const dx = b.x - ax, dy = b.y - ay;
    const d = Math.hypot(dx, dy) || 1e-6;
    const diff = (d - l.len) / d;
    const cx = dx * diff * 0.5, cy = dy * diff * 0.5;
    b.x -= cx; b.y -= cy;
    a1.x += cx * (1 - t); a1.y += cy * (1 - t);
    a2.x += cx * t; a2.y += cy * t;
    return;
  }
  const a = pts[l.a];
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const diff = (d - l.len) / d;
  const cx = dx * diff * 0.5, cy = dy * diff * 0.5;
  a.x += cx; a.y += cy;
  b.x -= cx; b.y -= cy;
}

function rotate(p: P, c: Vec, a: number) {
  const cs = Math.cos(a), sn = Math.sin(a);
  const x = p.x - c.x, y = p.y - c.y;
  p.x = c.x + x * cs - y * sn;
  p.y = c.y + x * sn + y * cs;
}

function collideGround(p: P, ground: number, bounce: number, friction: number) {
  const limit = ground - p.r;
  if (p.y > limit) {
    const vy = p.y - p.py;
    const vx = p.x - p.px;
    p.y = limit;
    p.py = limit + vy * bounce;
    p.px = p.x - vx * (1 - friction);
  }
}
