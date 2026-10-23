import type { Figure, Item, Pose, Solved, Vec } from '../model/types';
import { evaluate, itemPointWorld, itemState, itemWorld, type WorldXf } from '../model/pose';
import { solve, toWorld } from '../model/skeleton';
import { WEAPONS, type StrikeKind } from '../model/weapons';

/** A body part in world space, used as a hit target. */
export interface BodySeg {
  part: string;
  a: Vec;
  b: Vec;
  /** Half thickness (or radius for the head). */
  r: number;
  circle: boolean;
}

export interface Striker { id: string; p: Vec }
export interface BladeSeg { id: string; itemId: string; a: Vec; b: Vec; kind: StrikeKind }
export interface Muzzle { itemId: string; p: Vec; dir: Vec; fire: boolean }

export interface FigWorld {
  fig: Figure;
  pose: Pose;
  solved: Solved;
  segs: BodySeg[];
  strikers: Striker[];
  blades: BladeSeg[];
  muzzles: Muzzle[];
  items: { item: Item; xf: WorldXf; visible: boolean }[];
}

let revision = 0;
const cache = new Map<string, FigWorld>();

/** Call whenever the project changes; cached poses are dropped. */
export function invalidateWorld() {
  revision++;
  cache.clear();
}

export function worldRevision() { return revision; }

export function figWorld(fig: Figure, frame: number): FigWorld {
  const key = `${fig.id}@${frame}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = computeFigWorld(fig, evaluate(fig, frame));
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
}

export function computeFigWorld(fig: Figure, pose: Pose): FigWorld {
  const solved = solve(fig, pose);
  const s = fig.scale;
  const lw = fig.lineWidth * s;
  const segs: BodySeg[] = [];
  const lastOfLimb = new Map<string, { seg: number; p: Vec }>();
  for (const sb of solved.values()) {
    const a = toWorld(fig, pose, { x: sb.sx, y: sb.sy });
    const b = toWorld(fig, pose, { x: sb.ex, y: sb.ey });
    if (sb.bone.shape === 'head') {
      segs.push({ part: sb.bone.id, a: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b, r: (sb.bone.length * s) / 2, circle: true });
    } else {
      segs.push({ part: sb.bone.id, a, b, r: (lw * sb.bone.width) / 2, circle: false });
    }
    const role = sb.bone.role;
    if (role === 'arm' || role === 'leg' || role === 'tentacle') {
      const cur = lastOfLimb.get(sb.bone.limb);
      if (!cur || sb.bone.seg > cur.seg) lastOfLimb.set(sb.bone.limb, { seg: sb.bone.seg, p: b });
    }
  }
  const strikers: Striker[] = [...lastOfLimb.entries()].map(([id, v]) => ({ id, p: v.p }));
  const blades: BladeSeg[] = [];
  const muzzles: Muzzle[] = [];
  const items: FigWorld['items'] = [];
  for (const item of fig.items) {
    const st = itemState(fig, pose, item);
    const xf = itemWorld(fig, pose, solved, item, st);
    items.push({ item, xf, visible: st.visible });
    if (!st.visible) continue;
    const def = WEAPONS[item.type];
    def.strikes(st.bend).forEach((sk, i) => {
      const [x1, y1, x2, y2] = sk.seg;
      blades.push({ id: `${item.id}#${i}`, itemId: item.id, a: itemPointWorld(xf, x1, y1), b: itemPointWorld(xf, x2, y2), kind: sk.kind });
    });
    if (def.muzzle) {
      const p = itemPointWorld(xf, def.muzzle[0], def.muzzle[1]);
      muzzles.push({ itemId: item.id, p, dir: { x: Math.cos(xf.ang), y: Math.sin(xf.ang) }, fire: st.fire });
    }
  }
  return { fig, pose, solved, segs, strikers, blades, muzzles, items };
}
