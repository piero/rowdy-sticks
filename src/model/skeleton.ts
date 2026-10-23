import type { Bone, BodySpec, Figure, Pose, Solved, SolvedBone, Vec, Side } from './types';

const D = Math.PI / 180;

export const DEFAULT_SPEC: BodySpec = {
  armPairs: 1, armStyle: 'normal',
  legPairs: 1, legStyle: 'normal',
  tentacles: 0, tentacleSegments: 6,
  torso: 50, head: 26, arm: 56, leg: 68,
};

/** Where extra arm pairs attach along the torso. */
const ARM_ATTACH = [0.97, 0.72, 0.5];
const ARM_SPREAD = [0, 22, 44];
const LEG_SPREAD = [0, 25, 45];

function limbBones(
  out: Bone[], limb: string, role: 'arm' | 'leg' | 'tentacle', side: Side,
  parent: string | null, at: number, total: number, tentacle: boolean, segments: number,
  rest0: number, restBend: number,
) {
  const n = tentacle ? Math.max(3, segments) : 2;
  let prev = parent;
  for (let i = 0; i < n; i++) {
    const id = `${limb}_${i}`;
    let length: number;
    let width: number;
    if (tentacle) {
      // taper: earlier segments are longer and thicker
      const w = 1 - i / n;
      length = (total * 1.15 / n) * (0.75 + 0.5 * w);
      width = 0.45 + 0.9 * w;
    } else {
      length = total * (i === 0 ? 0.52 : 0.48);
      width = 1;
    }
    const rest = i === 0 ? rest0 : tentacle ? restBend / (n - 1) : restBend;
    out.push({
      id, parent: prev, length, at: i === 0 ? at : 1, rest,
      shape: tentacle ? 'tentacle' : 'line', role, limb, seg: i, side, width,
    });
    prev = id;
  }
}

export function buildBones(spec: BodySpec): Bone[] {
  const bones: Bone[] = [];
  // Legs and back-side limbs first; draw order is decided by the renderer.
  for (let k = 0; k < spec.legPairs; k++) {
    for (const side of ['B', 'F'] as const) {
      const spread = LEG_SPREAD[k] ?? 45;
      const rest = (side === 'F' ? 82 - spread : 98 + spread) * D;
      limbBones(bones, `leg${side}${k}`, 'leg', side, null, 1, spec.leg,
        spec.legStyle === 'tentacle', spec.tentacleSegments, rest, (spec.legStyle === 'tentacle' ? 30 : 4) * D);
    }
  }
  bones.push({ id: 'torso', parent: null, length: spec.torso, at: 1, rest: -90 * D, shape: 'line', role: 'torso', limb: 'torso', seg: 0, side: 'C', width: 1 });
  bones.push({ id: 'neck', parent: 'torso', length: Math.max(3, spec.head * 0.22), at: 1, rest: 0, shape: 'line', role: 'neck', limb: 'neck', seg: 0, side: 'C', width: 1 });
  bones.push({ id: 'head', parent: 'neck', length: spec.head, at: 1, rest: 0, shape: 'head', role: 'head', limb: 'head', seg: 0, side: 'C', width: 1 });
  for (let k = 0; k < spec.armPairs; k++) {
    for (const side of ['B', 'F'] as const) {
      const spread = ARM_SPREAD[k] ?? 44;
      const rest = (side === 'F' ? 165 - spread : 195 + spread) * D;
      limbBones(bones, `arm${side}${k}`, 'arm', side, 'torso', ARM_ATTACH[k] ?? 0.5, spec.arm,
        spec.armStyle === 'tentacle', spec.tentacleSegments, rest, (spec.armStyle === 'tentacle' ? -40 : -15) * D);
    }
  }
  for (let i = 0; i < spec.tentacles; i++) {
    const t = spec.tentacles === 1 ? 0.5 : i / (spec.tentacles - 1);
    const rest = (35 + t * 110) * D;
    limbBones(bones, `tent${i}`, 'tentacle', i % 2 ? 'B' : 'F', null, 1, spec.leg * 1.1, true,
      spec.tentacleSegments, rest, (i % 2 ? 50 : -50) * D);
  }
  // Parents must precede children for the solver.
  const order: Bone[] = [];
  const placed = new Set<string>();
  while (order.length < bones.length) {
    for (const b of bones) {
      if (placed.has(b.id)) continue;
      if (b.parent === null || placed.has(b.parent)) { order.push(b); placed.add(b.id); }
    }
  }
  return order;
}

const boneCache = new WeakMap<BodySpec, Bone[]>();
const indexCache = new WeakMap<BodySpec, Map<string, Bone>>();

export function getBones(fig: Figure): Bone[] {
  let b = boneCache.get(fig.spec);
  if (!b) { b = buildBones(fig.spec); boneCache.set(fig.spec, b); }
  return b;
}

export function getBone(fig: Figure, id: string): Bone | undefined {
  let m = indexCache.get(fig.spec);
  if (!m) { m = new Map(getBones(fig).map((b) => [b.id, b])); indexCache.set(fig.spec, m); }
  return m.get(id);
}

export function restAngles(fig: Figure): Record<string, number> {
  const a: Record<string, number> = {};
  for (const b of getBones(fig)) a[b.id] = b.rest;
  return a;
}

/** Solve bone positions in figure-local space (root at origin, unflipped, unscaled). */
export function solve(fig: Figure, pose: Pose): Solved {
  const out: Solved = new Map();
  for (const bone of getBones(fig)) {
    const rel = pose.angles[bone.id] ?? bone.rest;
    let sx = 0, sy = 0, base = 0;
    if (bone.parent) {
      const p = out.get(bone.parent)!;
      sx = p.sx + (p.ex - p.sx) * bone.at;
      sy = p.sy + (p.ey - p.sy) * bone.at;
      base = p.ang;
    }
    const ang = base + rel;
    out.set(bone.id, { bone, sx, sy, ang, ex: sx + Math.cos(ang) * bone.length, ey: sy + Math.sin(ang) * bone.length });
  }
  return out;
}

/** Parent's absolute local angle (0 for root-attached bones). */
export function parentAngle(solved: Solved, bone: Bone): number {
  return bone.parent ? solved.get(bone.parent)!.ang : 0;
}

export function toWorld(fig: Figure, pose: Pose, p: Vec): Vec {
  const s = fig.scale;
  return { x: pose.x + (pose.flip ? -1 : 1) * s * p.x, y: pose.y + s * p.y };
}

export function toLocal(fig: Figure, pose: Pose, p: Vec): Vec {
  const s = fig.scale;
  return { x: (p.x - pose.x) / ((pose.flip ? -1 : 1) * s), y: (p.y - pose.y) / s };
}

export function angleToWorld(pose: Pose, a: number): number {
  return pose.flip ? Math.PI - a : a;
}

export function angleToLocal(pose: Pose, a: number): number {
  return pose.flip ? Math.PI - a : a;
}

/** Distance from hip to feet for a standing figure, in world units. */
export function standHeight(fig: Figure): number {
  return fig.spec.legPairs > 0 || fig.spec.tentacles > 0 ? fig.spec.leg * 0.98 * fig.scale : 0;
}

export function limbBonesOf(fig: Figure, limb: string): Bone[] {
  return getBones(fig).filter((b) => b.limb === limb).sort((a, b) => a.seg - b.seg);
}

/** Bones whose end is a sensible place to hold an item (hands, tentacle tips, etc.). */
export function holdBones(fig: Figure): Bone[] {
  const bones = getBones(fig);
  const lastOfLimb = new Map<string, Bone>();
  for (const b of bones) {
    if (b.role === 'torso' || b.role === 'neck' || b.role === 'head') continue;
    const cur = lastOfLimb.get(b.limb);
    if (!cur || b.seg > cur.seg) lastOfLimb.set(b.limb, b);
  }
  const ends = [...lastOfLimb.values()];
  const rank = (b: Bone) => (b.role === 'arm' ? 0 : b.role === 'tentacle' ? 1 : 2) * 10 + (b.side === 'F' ? 0 : 1);
  return ends.sort((a, b) => rank(a) - rank(b) || a.limb.localeCompare(b.limb));
}

export function boneLabel(b: Bone): string {
  const side = b.side === 'F' ? 'front' : b.side === 'B' ? 'back' : '';
  const m = /^(arm|leg|tent)[BF]?(\d+)$/.exec(b.limb);
  const idx = m ? Number(m[2]) : 0;
  switch (b.role) {
    case 'arm': return `${side} hand${idx ? ' ' + (idx + 1) : ''}`;
    case 'leg': return `${side} foot${idx ? ' ' + (idx + 1) : ''}`;
    case 'tentacle': return `tentacle ${idx + 1}`;
    default: return b.role;
  }
}
