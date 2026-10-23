import type { Easing, Figure, Item, ItemState, Keyframe, Pose, Solved } from './types';
import { angleToWorld, getBone, holdBones, restAngles, solve, toWorld } from './skeleton';
import { WEAPONS } from './weapons';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const D2R = Math.PI / 180;

export function clonePose(p: Pose): Pose {
  return {
    x: p.x, y: p.y, flip: p.flip,
    angles: { ...p.angles },
    items: Object.fromEntries(Object.entries(p.items).map(([k, v]) => [k, { ...v }])),
  };
}

export function ease(kind: Easing, t: number): number {
  switch (kind) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'step': return 0;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Wrap an angle into [-PI, PI). */
export function wrap(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** The equivalent of `a` (mod 2PI) closest to `ref`, so interpolation never takes the long way. */
export function unwrapNear(a: number, ref: number): number {
  return ref + wrap(a - ref);
}

export function defaultItemState(fig: Figure, item: Item, bone?: string): ItemState {
  const hold = holdBones(fig);
  return {
    attached: true,
    bone: bone ?? hold[0]?.id ?? 'torso',
    angle: WEAPONS[item.type].angle * D2R,
    x: 0, y: 0, mirror: false, bend: Math.PI / 2,
    visible: true, fire: false,
  };
}

export function itemState(fig: Figure, pose: Pose, item: Item): ItemState {
  return pose.items[item.id] ?? defaultItemState(fig, item);
}

/** Grip transform of an attached item in figure-local space. */
export function itemLocal(fig: Figure, solved: Solved, st: ItemState): { x: number; y: number; ang: number } {
  const sb = solved.get(st.bone) ?? solved.get(getBone(fig, st.bone)?.id ?? 'torso') ?? solved.get('torso')!;
  return { x: sb.ex, y: sb.ey, ang: sb.ang + st.angle };
}

export interface WorldXf { x: number; y: number; ang: number; mirror: boolean; scale: number }

/** Grip transform in world space, whether attached or free. */
export function itemWorld(fig: Figure, pose: Pose, solved: Solved, item: Item, st: ItemState): WorldXf {
  const scale = fig.scale * item.scale;
  if (!st.attached) return { x: st.x, y: st.y, ang: st.angle, mirror: st.mirror, scale };
  const l = itemLocal(fig, solved, st);
  const w = toWorld(fig, pose, l);
  return { x: w.x, y: w.y, ang: angleToWorld(pose, l.ang), mirror: pose.flip, scale };
}

/** Transform a point given in item-local units to world space. */
export function itemPointWorld(xf: WorldXf, px: number, py: number): { x: number; y: number } {
  const y = xf.mirror ? -py : py;
  const c = Math.cos(xf.ang), s = Math.sin(xf.ang);
  return { x: xf.x + (px * c - y * s) * xf.scale, y: xf.y + (px * s + y * c) * xf.scale };
}

export function sortKeys(fig: Figure) {
  fig.keys.sort((a, b) => a.frame - b.frame);
}

export function keyAt(fig: Figure, frame: number): Keyframe | undefined {
  return fig.keys.find((k) => k.frame === frame);
}

export function basePose(fig: Figure, x: number, y: number, flip = false): Pose {
  const items: Record<string, ItemState> = {};
  const hold = holdBones(fig);
  fig.items.forEach((it, i) => { items[it.id] = defaultItemState(fig, it, hold[i % Math.max(1, hold.length)]?.id); });
  return { x, y, flip, angles: restAngles(fig), items };
}

function lerpItem(fig: Figure, item: Item, a: ItemState, b: ItemState, t: number, pa: Pose, pb: Pose): ItemState {
  const out: ItemState = { ...a, fire: false };
  if (a.attached && b.attached) {
    if (a.bone === b.bone) {
      out.angle = lerp(a.angle, b.angle, t);
      out.bend = lerp(a.bend, b.bend, t);
    }
    return out;
  }
  // At least one side is free: interpolate in world space.
  const wa = a.attached ? itemWorld(fig, pa, solve(fig, pa), item, a) : { x: a.x, y: a.y, ang: a.angle, mirror: a.mirror };
  const wb = b.attached ? itemWorld(fig, pb, solve(fig, pb), item, b) : { x: b.x, y: b.y, ang: b.angle, mirror: b.mirror };
  const angB = a.attached || b.attached ? unwrapNear(wb.ang, wa.ang) : wb.ang;
  out.attached = false;
  out.x = lerp(wa.x, wb.x, t);
  out.y = lerp(wa.y, wb.y, t);
  out.angle = lerp(wa.ang, angB, t);
  out.mirror = a.attached ? wa.mirror : a.mirror;
  out.bend = lerp(a.bend, b.bend, t);
  return out;
}

export function interpolate(fig: Figure, k0: Keyframe, k1: Keyframe, frame: number): Pose {
  const t = ease(k0.ease, (frame - k0.frame) / (k1.frame - k0.frame));
  const a = k0.pose, b = k1.pose;
  const angles: Record<string, number> = {};
  for (const bone of Object.keys(a.angles).concat(Object.keys(b.angles))) {
    if (bone in angles) continue;
    const r = getBone(fig, bone)?.rest ?? 0;
    angles[bone] = lerp(a.angles[bone] ?? r, b.angles[bone] ?? r, t);
  }
  const items: Record<string, ItemState> = {};
  for (const item of fig.items) {
    const sa = itemState(fig, a, item), sb = itemState(fig, b, item);
    items[item.id] = lerpItem(fig, item, sa, sb, t, a, b);
  }
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), flip: a.flip, angles, items };
}

/** Pose of a figure at an integer frame. */
export function evaluate(fig: Figure, frame: number): Pose {
  const keys = fig.keys;
  if (keys.length === 0) return basePose(fig, 0, 0);
  if (frame <= keys[0].frame) return withFire(clonePose(keys[0].pose), frame === keys[0].frame);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return withFire(clonePose(last.pose), frame === last.frame);
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  if (keys[i].frame === frame) return clonePose(keys[i].pose);
  return interpolate(fig, keys[i], keys[i + 1], frame);
}

function withFire(p: Pose, exact: boolean): Pose {
  if (!exact) for (const s of Object.values(p.items)) s.fire = false;
  return p;
}

/** Get the keyframe at `frame`, creating it from the evaluated pose (auto-key). */
export function ensureKey(fig: Figure, frame: number): Keyframe {
  let k = keyAt(fig, frame);
  if (k) return k;
  const pose = evaluate(fig, frame);
  for (const s of Object.values(pose.items)) s.fire = false;
  const prev = [...fig.keys].reverse().find((kk) => kk.frame < frame);
  k = { frame, ease: prev?.ease ?? 'easeInOut', pose };
  fig.keys.push(k);
  sortKeys(fig);
  return k;
}

/** Ensure the pose has explicit item states for every item (so edits stick). */
export function fillItems(fig: Figure, pose: Pose) {
  for (const it of fig.items) if (!pose.items[it.id]) pose.items[it.id] = defaultItemState(fig, it);
}
