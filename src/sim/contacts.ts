import type { Project, Vec } from '../model/types';
import { figWorld, worldRevision, type BodySeg, type FigWorld } from './world';
import { closestOnSeg, dist, distPointSeg, rayCircle, segIntersect, segSegDist } from './geom';

export type HitKind = 'slash' | 'impact' | 'clash' | 'shot';

export interface HitEvent {
  id: string;
  frame: number;
  kind: HitKind;
  x: number;
  y: number;
  /** Unit direction of the blow. */
  dx: number;
  dy: number;
  speed: number;
  attacker: string;
  /** Target figure id (null for a missed shot). */
  target: string | null;
  part: string | null;
  seed: number;
  /** Shots: muzzle position. */
  from?: Vec;
}

const MIN_BLADE_SPEED = 3;
const MIN_STRIKE_SPEED = 4;
const COOLDOWN = 5;

let cached: { project: Project; rev: number; events: HitEvent[] } | null = null;

export function getContacts(project: Project): HitEvent[] {
  const rev = worldRevision();
  if (cached && cached.project === project && cached.rev === rev) return cached.events;
  const events = computeContacts(project);
  cached = { project, rev, events };
  return events;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hitsSeg(a: Vec, b: Vec, seg: BodySeg, tol: number): { d: number; p: Vec } | null {
  if (seg.circle) {
    const c = closestOnSeg(seg.a, a, b);
    const d = dist(c, seg.a);
    if (d > seg.r + tol) return null;
    const k = seg.r / Math.max(d, 1e-6);
    return { d, p: d < 1e-6 ? c : { x: seg.a.x + (c.x - seg.a.x) * k, y: seg.a.y + (c.y - seg.a.y) * k } };
  }
  const r = segSegDist(a, b, seg.a, seg.b);
  return r.d <= seg.r + tol ? r : null;
}

function pointHitsSeg(p: Vec, seg: BodySeg, tol: number): Vec | null {
  if (seg.circle) {
    const d = dist(p, seg.a);
    return d <= seg.r + tol ? p : null;
  }
  return distPointSeg(p, seg.a, seg.b) <= seg.r + tol ? closestOnSeg(p, seg.a, seg.b) : null;
}

export function computeContacts(project: Project): HitEvent[] {
  const figs = project.figures.filter((f) => f.visible);
  const events: HitEvent[] = [];
  const last = new Map<string, number>();
  let activePrev = new Set<string>();

  const emit = (key: string, f: number, ev: Omit<HitEvent, 'id' | 'frame' | 'seed'>, active: Set<string>) => {
    active.add(key);
    if (activePrev.has(key)) return;
    const l = last.get(key);
    if (l !== undefined && f - l < COOLDOWN) return;
    last.set(key, f);
    events.push({ ...ev, id: `${key}@${f}`, frame: f, seed: hash(key) ^ f });
  };

  for (let f = 0; f < project.frames; f++) {
    const now: FigWorld[] = figs.map((fig) => figWorld(fig, f));
    const prev: FigWorld[] | null = f > 0 ? figs.map((fig) => figWorld(fig, f - 1)) : null;
    const active = new Set<string>();

    // Gunfire happens exactly on keyframes with fire = true.
    for (let i = 0; i < now.length; i++) {
      for (const m of now[i].muzzles) {
        if (!m.fire) continue;
        let best = 2500, target: string | null = null, part: string | null = null;
        const end = { x: m.p.x + m.dir.x * best, y: m.p.y + m.dir.y * best };
        for (let j = 0; j < now.length; j++) {
          if (j === i) continue;
          for (const seg of now[j].segs) {
            let t: number | null;
            if (seg.circle) t = rayCircle(m.p, m.dir, seg.a, seg.r);
            else {
              const u = segIntersect(m.p, end, seg.a, seg.b);
              t = u === null ? null : u * 2500;
            }
            if (t !== null && t < best) { best = t; target = now[j].fig.id; part = seg.part; }
          }
        }
        const key = `shot:${now[i].fig.id}:${m.itemId}`;
        events.push({
          id: `${key}@${f}`, frame: f, kind: 'shot', seed: hash(key) ^ f,
          x: m.p.x + m.dir.x * best, y: m.p.y + m.dir.y * best, dx: m.dir.x, dy: m.dir.y, speed: 30,
          attacker: now[i].fig.id, target, part, from: { ...m.p },
        });
      }
    }

    if (prev) {
      for (let i = 0; i < now.length; i++) {
        const A = now[i], Ap = prev[i];
        const sA = A.fig.scale;
        const prevBlades = new Map(Ap.blades.map((b) => [b.id, b]));
        const prevStrikers = new Map(Ap.strikers.map((s) => [s.id, s]));
        for (let j = 0; j < now.length; j++) {
          if (i === j) continue;
          const B = now[j];
          // Weapons against bodies.
          for (const bl of A.blades) {
            const pb = prevBlades.get(bl.id);
            if (!pb) continue;
            const speed = Math.max(dist(bl.b, pb.b), dist(bl.a, pb.a));
            if (speed < MIN_BLADE_SPEED) continue;
            for (const seg of B.segs) {
              let hit = hitsSeg(bl.a, bl.b, seg, 1.5 * sA);
              if (!hit) {
                const swept = hitsSeg(pb.b, bl.b, seg, 0);
                if (swept) hit = swept;
              }
              if (!hit) continue;
              const vx = bl.b.x - pb.b.x, vy = bl.b.y - pb.b.y, vl = Math.hypot(vx, vy) || 1;
              emit(`w:${A.fig.id}:${bl.itemId}:${B.fig.id}`, f, {
                kind: bl.kind === 'blade' ? 'slash' : 'impact', x: hit.p.x, y: hit.p.y,
                dx: vx / vl, dy: vy / vl, speed, attacker: A.fig.id, target: B.fig.id, part: seg.part,
              }, active);
              break;
            }
          }
          // Fists, feet and tentacle tips against bodies.
          for (const st of A.strikers) {
            const ps = prevStrikers.get(st.id);
            if (!ps) continue;
            const speed = dist(st.p, ps.p);
            if (speed < MIN_STRIKE_SPEED) continue;
            for (const seg of B.segs) {
              let p = pointHitsSeg(st.p, seg, 2.5 * sA);
              if (!p && !seg.circle) {
                const t = segIntersect(ps.p, st.p, seg.a, seg.b);
                if (t !== null) p = { x: ps.p.x + (st.p.x - ps.p.x) * t, y: ps.p.y + (st.p.y - ps.p.y) * t };
              }
              if (!p) continue;
              emit(`s:${A.fig.id}:${st.id}:${B.fig.id}`, f, {
                kind: 'impact', x: p.x, y: p.y, dx: (st.p.x - ps.p.x) / speed, dy: (st.p.y - ps.p.y) / speed,
                speed, attacker: A.fig.id, target: B.fig.id, part: seg.part,
              }, active);
              break;
            }
          }
          // Weapon against weapon: a clash (each pair once).
          if (j > i) {
            const prevB = new Map(prev[j].blades.map((b) => [b.id, b]));
            for (const bl of A.blades) for (const ob of B.blades) {
              const pa = prevBlades.get(bl.id), po = prevB.get(ob.id);
              const speed = Math.max(pa ? dist(pa.b, bl.b) : 0, po ? dist(po.b, ob.b) : 0);
              if (speed < MIN_BLADE_SPEED) continue;
              const t = segIntersect(bl.a, bl.b, ob.a, ob.b);
              if (t === null) continue;
              const x = bl.a.x + (bl.b.x - bl.a.x) * t, y = bl.a.y + (bl.b.y - bl.a.y) * t;
              emit(`c:${bl.id}:${ob.id}`, f, {
                kind: 'clash', x, y, dx: 0, dy: -1, speed, attacker: A.fig.id, target: B.fig.id, part: null,
              }, active);
            }
          }
        }
      }
    }
    activePrev = active;
  }
  return events.sort((a, b) => a.frame - b.frame);
}
