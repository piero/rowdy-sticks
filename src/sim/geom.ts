import type { Vec } from '../model/types';

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (v: Vec) => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function closestOnSeg(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function distPointSeg(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestOnSeg(p, a, b));
}

/** Intersection parameter t along p→p2 with segment a→b, or null. */
export function segIntersect(p: Vec, p2: Vec, a: Vec, b: Vec): number | null {
  const rx = p2.x - p.x, ry = p2.y - p.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = a.x - p.x, qy = a.y - p.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Minimum distance between two segments plus the closest point on the second one. */
export function segSegDist(a1: Vec, a2: Vec, b1: Vec, b2: Vec): { d: number; p: Vec } {
  const t = segIntersect(a1, a2, b1, b2);
  if (t !== null) return { d: 0, p: { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t } };
  let best = { d: Infinity, p: b1 };
  for (const q of [a1, a2]) {
    const c = closestOnSeg(q, b1, b2);
    const d = dist(q, c);
    if (d < best.d) best = { d, p: c };
  }
  for (const q of [b1, b2]) {
    const d = distPointSeg(q, a1, a2);
    if (d < best.d) best = { d, p: q };
  }
  return best;
}

/** Ray (origin o, unit dir) against a circle; returns distance or null. */
export function rayCircle(o: Vec, dir: Vec, c: Vec, r: number): number | null {
  const fx = o.x - c.x, fy = o.y - c.y;
  const b = fx * dir.x + fy * dir.y;
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
