import type { Easing, Figure, ItemState, Keyframe, Pose, Project } from '../model/types';
import { clonePose, D2R, evaluate, fillItems, interpolate, itemWorld, sortKeys } from '../model/pose';
import { getBones, solve } from '../model/skeleton';
import { WEAPONS } from '../model/weapons';

/** Canonical joint names presets are written in (degrees, relative angles as stored in poses). */
type Canon = 'torso' | 'neck' | 'head' | 'uaF' | 'faF' | 'uaB' | 'faB' | 'thF' | 'shF' | 'thB' | 'shB';
type Angles = Partial<Record<Canon, number>>;

interface PresetKey {
  /** Frame offset at 24 fps. */
  t: number;
  a?: Angles;
  /** Root offset in local units (dx is mirrored with facing). */
  dx?: number;
  dy?: number;
  /** Root height above the ground instead of dy (lying down). */
  ground?: number;
  /** Weapon angle (degrees) for items held in front/back hands; DEFAULT_GRIP = the weapon's own default. */
  wF?: number;
  wB?: number;
  ease?: Easing;
  release?: boolean;
  fire?: boolean;
  /** Tentacle wiggle amplitude in degrees per segment. */
  wiggle?: number;
}

export interface Preset {
  label: string;
  group: 'Basics' | 'Locomotion' | 'Unarmed' | 'Weapons' | 'Reactions';
  keys: PresetKey[];
}

const DEFAULT_GRIP = -90;

const STANCE: Angles = { torso: -84, neck: -4, head: 0, uaF: 140, faF: -115, uaB: 165, faB: -120, thF: 65, shF: 20, thB: 112, shB: -18 };
const IDLE: Angles = { torso: -90, neck: 0, head: 0, uaF: 165, faF: -10, uaB: 195, faB: -10, thF: 84, shF: 0, thB: 96, shB: 0 };
const GUARD_ARMS: Angles = { uaF: 140, faF: -115, uaB: 165, faB: -120 };

function cycle(phases: { a: Angles; dy: number }[], half: number, stride: number, cycles: number, lead = 4): PresetKey[] {
  const keys: PresetKey[] = [];
  const perPhase = half / 2;
  const n = phases.length * cycles;
  for (let i = 0; i <= n; i++) {
    const ph = phases[i % phases.length];
    keys.push({ t: lead + i * perPhase, a: ph.a, dy: ph.dy, dx: (i * stride) / 2, ease: 'linear' });
  }
  return keys;
}

const WALK = cycle([
  { a: { torso: -88, thF: 65, shF: 5, thB: 115, shB: 12, uaF: 195, faF: -15, uaB: 150, faB: -25 }, dy: 4 },
  { a: { torso: -89, thF: 88, shF: 2, thB: 80, shB: 55, uaF: 175, faF: -15, uaB: 175, faB: -20 }, dy: -1 },
  { a: { torso: -88, thF: 115, shF: 12, thB: 65, shB: 5, uaF: 150, faF: -25, uaB: 195, faB: -15 }, dy: 4 },
  { a: { torso: -89, thF: 80, shF: 55, thB: 88, shB: 2, uaF: 175, faF: -20, uaB: 175, faB: -15 }, dy: -1 },
], 12, 30, 2);

const RUN = cycle([
  { a: { torso: -72, thF: 45, shF: 20, thB: 135, shB: 60, uaF: 215, faF: -95, uaB: 120, faB: -100 }, dy: 3 },
  { a: { torso: -73, thF: 85, shF: 15, thB: 62, shB: 105, uaF: 170, faF: -95, uaB: 170, faB: -95 }, dy: -6 },
  { a: { torso: -72, thF: 135, shF: 60, thB: 45, shB: 20, uaF: 120, faF: -100, uaB: 215, faB: -95 }, dy: 3 },
  { a: { torso: -73, thF: 62, shF: 105, thB: 85, shB: 15, uaF: 170, faF: -95, uaB: 170, faB: -95 }, dy: -6 },
], 10, 48, 3, 3);

export const PRESETS: Record<string, Preset> = {
  stance: { label: 'Fighting stance', group: 'Basics', keys: [{ t: 6, a: STANCE, dy: 2 }] },
  idle: { label: 'Stand / breathe', group: 'Basics', keys: [
    { t: 6, a: IDLE, dy: 0 },
    { t: 18, a: { ...IDLE, uaF: 168, uaB: 192, torso: -91 }, dy: 1.5 },
    { t: 30, a: IDLE, dy: 0 },
  ] },
  bow: { label: 'Bow (rei)', group: 'Basics', keys: [
    { t: 6, a: { ...IDLE }, dy: 0 },
    { t: 14, a: { ...IDLE, torso: -32, neck: 5, uaF: 122, faF: 0, uaB: 122, faB: 0 }, dy: 2 },
    { t: 24, a: { ...IDLE, torso: -32, neck: 5, uaF: 122, faF: 0, uaB: 122, faB: 0 }, dy: 2 },
    { t: 32, a: IDLE, dy: 0 },
  ] },
  victory: { label: 'Victory', group: 'Basics', keys: [
    { t: 5, a: { ...IDLE, uaF: 15, faF: -15, uaB: -15, faB: 15 }, dy: 2, wF: -90 },
    { t: 9, a: { ...IDLE, uaF: 5, faF: -5, uaB: -5, faB: 5, thF: 70, shF: 30, thB: 110, shB: 30 }, dy: -14 },
    { t: 13, a: { ...IDLE, uaF: 15, faF: -15, uaB: -15, faB: 15 }, dy: 0 },
    { t: 24, a: { ...IDLE, uaF: 15, faF: -15, uaB: -15, faB: 15 }, dy: 0 },
  ] },
  wiggle: { label: 'Tentacle wiggle', group: 'Basics', keys: Array.from({ length: 9 }, (_, i) => ({ t: 4 + i * 4, wiggle: 16, ease: 'easeInOut' as Easing })) },
  walk: { label: 'Walk (2 cycles)', group: 'Locomotion', keys: WALK },
  run: { label: 'Run (3 cycles)', group: 'Locomotion', keys: RUN },
  jump: { label: 'Jump forward', group: 'Locomotion', keys: [
    { t: 5, a: { torso: -70, thF: 25, shF: 100, thB: 40, shB: 95, uaF: 220, faF: -10, uaB: 225, faB: -10 }, dy: 23 },
    { t: 10, a: { torso: -88, thF: 85, shF: 0, thB: 95, shB: 0, uaF: 20, faF: -10, uaB: 30, faB: -10 }, dy: -15, dx: 10, ease: 'easeOut' },
    { t: 16, a: { torso: -85, thF: 20, shF: 110, thB: 45, shB: 100, uaF: 100, faF: -60, uaB: 110, faB: -60 }, dy: -70, dx: 30, ease: 'easeIn' },
    { t: 22, a: { torso: -86, thF: 70, shF: 10, thB: 100, shB: 10, uaF: 120, faF: -40, uaB: 130, faB: -40 }, dy: -22, dx: 45, ease: 'linear' },
    { t: 25, a: { torso: -72, thF: 35, shF: 90, thB: 50, shB: 80, uaF: 120, faF: -30, uaB: 135, faB: -30 }, dy: 18, dx: 50 },
    { t: 33, a: STANCE, dy: 2, dx: 50 },
  ] },
  punch: { label: 'Punch', group: 'Unarmed', keys: [
    { t: 3, a: { torso: -88, uaF: 175, faF: -140, uaB: 140, faB: -115 }, dy: 2 },
    { t: 6, a: { torso: -76, uaF: 92, faF: -2, uaB: 178, faB: -105, thF: 55, shF: 25 }, dx: 8, dy: 3, ease: 'easeOut' },
    { t: 10, a: { torso: -78, uaF: 100, faF: -30, uaB: 175, faB: -110 }, dx: 8, dy: 3 },
    { t: 15, a: STANCE, dx: 8, dy: 2 },
  ] },
  combo: { label: 'Punch combo (1-2)', group: 'Unarmed', keys: [
    { t: 3, a: { torso: -86, ...GUARD_ARMS }, dy: 2 },
    { t: 5, a: { torso: -78, uaF: 92, faF: -2, uaB: 170, faB: -125 }, dx: 6, dy: 3, ease: 'easeOut' },
    { t: 8, a: { torso: -84, ...GUARD_ARMS }, dx: 6, dy: 2 },
    { t: 11, a: { torso: -70, uaF: 160, faF: -125, uaB: 88, faB: -2, thF: 55, shF: 28 }, dx: 14, dy: 4, ease: 'easeOut' },
    { t: 16, a: { torso: -82, ...GUARD_ARMS }, dx: 14, dy: 2 },
    { t: 20, a: STANCE, dx: 14, dy: 2 },
  ] },
  kick: { label: 'Side kick', group: 'Unarmed', keys: [
    { t: 4, a: { torso: -100, thF: -5, shF: 125, thB: 98, shB: 0, ...GUARD_ARMS }, dy: -1 },
    { t: 7, a: { torso: -118, thF: -12, shF: 4, thB: 100, shB: 0, uaF: 120, faF: -110, uaB: 200, faB: -60 }, dx: 4, dy: -1, ease: 'easeOut' },
    { t: 11, a: { torso: -100, thF: -5, shF: 125, thB: 98, shB: 0, ...GUARD_ARMS }, dx: 4, dy: -1 },
    { t: 15, a: STANCE, dx: 4, dy: 2 },
  ] },
  highKick: { label: 'High kick', group: 'Unarmed', keys: [
    { t: 4, a: { torso: -105, thF: -25, shF: 120, thB: 100, shB: 0, ...GUARD_ARMS }, dy: -1 },
    { t: 7, a: { torso: -135, thF: -52, shF: 4, thB: 102, shB: 0, uaF: 110, faF: -100, uaB: 210, faB: -50 }, dx: 4, dy: -1, ease: 'easeOut' },
    { t: 11, a: { torso: -105, thF: -25, shF: 120, thB: 100, shB: 0, ...GUARD_ARMS }, dx: 4, dy: -1 },
    { t: 16, a: STANCE, dx: 4, dy: 2 },
  ] },
  slash: { label: 'Overhead slash', group: 'Weapons', keys: [
    { t: 5, a: { torso: -96, uaF: 15, faF: -40, uaB: 25, faB: -45, thF: 70, shF: 15, thB: 110, shB: -15 }, dy: 1, wF: -90, wB: -90 },
    { t: 9, a: { torso: -66, uaF: 105, faF: -15, uaB: 115, faB: -10, thF: 50, shF: 30, thB: 125, shB: -10 }, dx: 12, dy: 8, wF: 6, wB: 6, ease: 'easeOut' },
    { t: 13, a: { torso: -68, uaF: 112, faF: -12, uaB: 120, faB: -10, thF: 50, shF: 30, thB: 125, shB: -10 }, dx: 12, dy: 8, wF: 10, wB: 10 },
    { t: 20, a: STANCE, dx: 12, dy: 2, wF: -90, wB: -90 },
  ] },
  thrust: { label: 'Thrust', group: 'Weapons', keys: [
    { t: 5, a: { torso: -92, uaF: 205, faF: -120, uaB: 200, faB: -110 }, dy: 2, wF: 0, wB: 0 },
    { t: 9, a: { torso: -74, uaF: 95, faF: -5, uaB: 110, faB: -15, thF: 50, shF: 30, thB: 125, shB: -10 }, dx: 16, dy: 7, wF: 0, wB: 0, ease: 'easeOut' },
    { t: 13, a: { torso: -76, uaF: 98, faF: -8, uaB: 112, faB: -15, thF: 50, shF: 30, thB: 125, shB: -10 }, dx: 16, dy: 7, wF: 0, wB: 0 },
    { t: 20, a: STANCE, dx: 16, dy: 2, wF: -90, wB: -90 },
  ] },
  sweep: { label: 'Horizontal sweep', group: 'Weapons', keys: [
    { t: 5, a: { torso: -100, uaF: 230, faF: -20, uaB: 220, faB: -30 }, dy: 3, wF: -100, wB: -100 },
    { t: 9, a: { torso: -75, uaF: 95, faF: -5, uaB: 100, faB: -10, thF: 55, shF: 25 }, dx: 10, dy: 5, wF: -10, wB: -10, ease: 'easeOut' },
    { t: 12, a: { torso: -78, uaF: 50, faF: -20, uaB: 60, faB: -20 }, dx: 10, dy: 5, wF: 60, wB: 60 },
    { t: 19, a: STANCE, dx: 10, dy: 2, wF: -90, wB: -90 },
  ] },
  block: { label: 'Block', group: 'Weapons', keys: [
    { t: 4, a: { torso: -94, uaF: 70, faF: -95, uaB: 80, faB: -100 }, dx: -3, dy: 4, wF: 100, wB: 100, ease: 'easeOut' },
    { t: 14, a: { torso: -95, uaF: 72, faF: -95, uaB: 82, faB: -100 }, dx: -4, dy: 4, wF: 100, wB: 100 },
    { t: 19, a: STANCE, dx: -4, dy: 2, wF: -90, wB: -90 },
  ] },
  throw: { label: 'Throw (front hand)', group: 'Weapons', keys: [
    { t: 5, a: { torso: -98, uaF: 230, faF: -70, uaB: 120, faB: -60 }, dy: 2 },
    { t: 9, a: { torso: -74, uaF: 80, faF: -5, uaB: 190, faB: -40, thF: 55, shF: 25 }, dx: 8, dy: 4, release: true, ease: 'easeOut' },
    { t: 16, a: STANCE, dx: 8, dy: 2 },
  ] },
  shoot: { label: 'Shoot ×2', group: 'Weapons', keys: [
    { t: 4, a: { torso: -88, uaF: 92, faF: -2, uaB: 95, faB: -3 }, dy: 2, wF: 0, wB: 0 },
    { t: 8, a: { torso: -88, uaF: 92, faF: -2, uaB: 95, faB: -3 }, dy: 2, wF: 0, wB: 0, fire: true },
    { t: 10, a: { torso: -92, uaF: 82, faF: -28, uaB: 86, faB: -26 }, dy: 2, wF: 0, wB: 0 },
    { t: 15, a: { torso: -88, uaF: 92, faF: -2, uaB: 95, faB: -3 }, dy: 2, wF: 0, wB: 0, fire: true },
    { t: 17, a: { torso: -92, uaF: 82, faF: -28, uaB: 86, faB: -26 }, dy: 2, wF: 0, wB: 0 },
    { t: 26, a: { torso: -88, uaF: 92, faF: -2, uaB: 95, faB: -3 }, dy: 2, wF: 0, wB: 0 },
  ] },
  hit: { label: 'Get hit (stagger)', group: 'Reactions', keys: [
    { t: 3, a: { torso: -112, neck: 15, head: 10, uaF: 120, faF: -40, uaB: 230, faB: -30, thF: 70, shF: 10, thB: 120, shB: 10 }, dx: -14, dy: 3, ease: 'easeOut' },
    { t: 12, a: STANCE, dx: -18, dy: 2 },
  ] },
  fall: { label: 'Fall backwards (keyed)', group: 'Reactions', keys: [
    { t: 5, a: { torso: -128, neck: 20, head: 10, uaF: 70, faF: -20, uaB: 250, faB: -20, thF: 60, shF: 30, thB: 100, shB: 30 }, dx: -18, dy: 6, ease: 'easeIn' },
    { t: 11, a: { torso: -180, neck: 5, head: 0, uaF: 160, faF: -10, uaB: 205, faB: 5, thF: -15, shF: 25, thB: 5, shB: 10 }, dx: -40, ground: 3, ease: 'easeOut' },
    { t: 14, a: { torso: -178, neck: 0, head: 0, uaF: 165, faF: 0, uaB: 200, faB: 0, thF: -8, shF: 10, thB: 2, shB: 4 }, dx: -42, ground: 3 },
  ] },
};

interface Mapper { (pk: Angles, base: Pose, t: number, wiggle: number): Record<string, number> }

/** Map canonical joints onto whatever limbs this figure actually has. */
function mapper(fig: Figure): Mapper {
  const bones = getBones(fig);
  const limbs = new Map<string, typeof bones>();
  for (const b of bones) {
    if (b.role === 'torso' || b.role === 'neck' || b.role === 'head') continue;
    let l = limbs.get(b.limb);
    if (!l) { l = []; limbs.set(b.limb, l); }
    l.push(b);
  }
  return (a, base, t, wiggle) => {
    const out: Record<string, number> = {};
    const set = (id: string, deg: number | undefined) => { if (deg !== undefined) out[id] = deg * D2R; };
    set('torso', a.torso); set('neck', a.neck); set('head', a.head);
    for (const [limb, bs] of limbs) {
      bs.sort((x, y) => x.seg - y.seg);
      const m = /^(arm|leg|tent)([BF]?)(\d+)$/.exec(limb);
      if (!m) continue;
      const kind = m[1], idx = Number(m[3]);
      let S = (m[2] || 'F') as 'F' | 'B';
      let upper: number | undefined, lower: number | undefined;
      let spread = 0;
      if (kind === 'arm') {
        upper = a[`ua${S}`]; lower = a[`fa${S}`];
        spread = idx * 18 * (S === 'F' ? -1 : 1);
      } else if (kind === 'leg') {
        if (idx % 2 === 1) S = S === 'F' ? 'B' : 'F'; // alternate gait for extra leg pairs
        upper = a[`th${S}`]; lower = a[`sh${S}`];
        spread = idx * 14 * (S === 'F' ? -1 : 1);
      }
      const n = bs.length;
      const tentacle = bs[0].shape === 'tentacle';
      const amp = (tentacle ? Math.max(6, wiggle) : 0) * D2R;
      bs.forEach((b, i) => {
        const wave = amp ? Math.sin(t * 0.35 + i * 0.9 + idx * 1.7 + (S === 'B' ? 2 : 0)) * amp : 0;
        if (kind === 'tent') { out[b.id] = b.rest + (i === 0 ? wave * 0.5 : wave); return; }
        if (i === 0) {
          if (upper !== undefined) out[b.id] = (upper + spread) * D2R + wave * 0.3;
          else if (amp) out[b.id] = (base.angles[b.id] ?? b.rest) + wave * 0.3;
        } else if (lower !== undefined) {
          out[b.id] = (tentacle ? lower / (n - 1) : lower) * D2R + wave;
        } else if (amp) out[b.id] = (base.angles[b.id] ?? b.rest) + wave;
      });
    }
    return out;
  };
}

function handBones(fig: Figure, side: 'F' | 'B'): Set<string> {
  const ends = new Map<string, { seg: number; id: string }>();
  for (const b of getBones(fig)) {
    if (b.role !== 'arm' || b.side !== side) continue;
    const cur = ends.get(b.limb);
    if (!cur || b.seg > cur.seg) ends.set(b.limb, { seg: b.seg, id: b.id });
  }
  return new Set([...ends.values()].map((e) => e.id));
}

/**
 * Insert a preset move for `fig` starting at `frame`, continuing from its current pose.
 * Existing keys inside the inserted range are replaced. Returns the last frame written.
 */
export function insertPreset(project: Project, fig: Figure, presetId: string, frame: number, speed = 1): number {
  const preset = PRESETS[presetId];
  if (!preset) return frame;
  const base = evaluate(fig, frame);
  fillItems(fig, base);
  for (const s of Object.values(base.items)) s.fire = false;
  const tScale = project.fps / 24 / Math.max(0.1, speed);
  const map = mapper(fig);
  const dir = base.flip ? -1 : 1;
  const s = fig.scale;
  const front = handBones(fig, 'F'), back = handBones(fig, 'B');

  const out: Keyframe[] = [];
  let carry: Angles = {};
  let lastFrame = frame;
  for (const pk of preset.keys) {
    let f = frame + Math.max(1, Math.round(pk.t * tScale));
    if (f <= lastFrame) f = lastFrame + 1;
    lastFrame = f;
    carry = { ...carry, ...(pk.a ?? {}) };
    const pose: Pose = clonePose(out.at(-1)?.pose ?? base);
    pose.angles = { ...pose.angles, ...map(carry, base, f, pk.wiggle ?? 0) };
    pose.x = base.x + dir * (pk.dx ?? 0) * s;
    pose.y = pk.ground !== undefined ? project.groundY - pk.ground * s : base.y + (pk.dy ?? 0) * s;
    for (const it of fig.items) {
      const st = pose.items[it.id];
      if (!st || !st.attached) continue;
      st.fire = false;
      const grip = (w: number) => (w === DEFAULT_GRIP ? WEAPONS[it.type].angle : w) * D2R;
      if (pk.wF !== undefined && front.has(st.bone)) st.angle = grip(pk.wF);
      if (pk.wB !== undefined && back.has(st.bone)) st.angle = grip(pk.wB);
      if (pk.fire && WEAPONS[it.type].muzzle && (front.has(st.bone) || back.has(st.bone))) st.fire = true;
    }
    out.push({ frame: f, ease: pk.ease ?? 'easeInOut', pose });
  }

  // Throws: items in the front hand fly off along the forearm direction.
  const relIdx = preset.keys.findIndex((k) => k.release);
  const bodyKeys = out.map((k) => ({ ...k, pose: clonePose(k.pose) }));
  if (relIdx >= 0) {
    const relKey = out[relIdx];
    const solved = solve(fig, relKey.pose);
    for (const it of fig.items) {
      const st0 = relKey.pose.items[it.id];
      if (!st0 || !st0.attached || !st0.visible || !front.has(st0.bone)) continue;
      const def = WEAPONS[it.type];
      const xf = itemWorld(fig, relKey.pose, solved, it, st0);
      const hand = solved.get(st0.bone)!;
      const fdir = relKey.pose.flip ? Math.PI - hand.ang : hand.ang;
      const vx = Math.cos(fdir), vy = Math.sin(fdir);
      const speedPx = 32 * s;
      const flight = Math.round(16 * tScale);
      const startAng = def.spin ? xf.ang : fdir;
      const free = (df: number): ItemState => ({
        ...st0, attached: false, fire: false,
        x: xf.x + vx * speedPx * df / tScale, y: xf.y + vy * speedPx * df / tScale,
        angle: def.spin ? startAng + df * 0.9 : startAng,
        mirror: def.spin ? xf.mirror : false,
        visible: df <= flight,
      });
      // Extra keys pin the flight path: just after release, at impact range, then gone.
      const endFrame = relKey.frame + flight;
      for (const k of out.slice(relIdx + 1)) k.pose.items[it.id] = free(k.frame - relKey.frame);
      for (const ef of [relKey.frame + 1, endFrame, endFrame + 1]) {
        let k = out.find((kk) => kk.frame === ef);
        if (!k) {
          k = { frame: ef, ease: 'linear', pose: bodyPoseAt(fig, bodyKeys, ef) };
          out.push(k);
          out.sort((a, b) => a.frame - b.frame);
        }
        k.pose.items[it.id] = free(ef - relKey.frame);
      }
    }
  }

  const endF = out.at(-1)!.frame;
  if (!fig.keys.some((k) => k.frame === frame)) fig.keys.push({ frame, ease: 'easeInOut', pose: base });
  fig.keys = fig.keys.filter((k) => k.frame <= frame || k.frame > endF);
  fig.keys.push(...out);
  sortKeys(fig);
  if (endF >= project.frames) project.frames = endF + 1;
  return endF;
}

/** Body pose at frame f, interpolated between the preset's own keys (before flight keys were added). */
function bodyPoseAt(fig: Figure, keys: Keyframe[], f: number): Pose {
  const next = keys.findIndex((k) => k.frame >= f);
  if (next <= 0) return clonePose((next === 0 ? keys[0] : keys[keys.length - 1]).pose);
  return interpolate(fig, keys[next - 1], keys[next], f);
}
