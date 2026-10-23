import type { Project } from '../model/types';
import { createFigure, newProject } from '../model/project';
import { insertPreset } from './presets';
import { computeContacts } from '../sim/contacts';
import { invalidateWorld } from '../sim/world';
import { bakeRagdoll, DEFAULT_RAGDOLL } from '../sim/ragdoll';

/** Distance between the fighters after the ninja's approach, tuned so the slash connects. */
export const DEMO_GAP = 132;

/**
 * A short fight: the ninja walks in, the first slash falls short as the samurai blocks
 * and steps back, the second slash lands and the samurai collapses (baked ragdoll).
 */
export function demoProject(gap = DEMO_GAP): Project {
  const p = newProject();
  p.name = 'Ninja vs Samurai';
  p.frames = 150;
  const ninja = createFigure(p, 'ninja', 160);
  ninja.name = 'Kage';
  p.figures.push(ninja);
  // Walk (8 half-steps of 15) + slash lunge (12) + second slash lunge (12) + gap, all in local units.
  const samurai = createFigure(p, 'samurai', 160 + (120 + 12 + 12 + gap) * ninja.scale, true);
  samurai.name = 'Ronin';
  p.figures.push(samurai);

  const walked = insertPreset(p, ninja, 'walk', 0);
  const slash1 = walked + 2;
  const slash2 = insertPreset(p, ninja, 'slash', slash1) + 4;
  insertPreset(p, ninja, 'slash', slash2);
  insertPreset(p, samurai, 'stance', 0);
  insertPreset(p, samurai, 'block', slash1 + 1);

  invalidateWorld();
  const hit = computeContacts(p).find((e) => e.target === samurai.id && e.kind !== 'clash');
  if (hit) {
    const strength = 520;
    bakeRagdoll(p, samurai, {
      ...DEFAULT_RAGDOLL,
      startFrame: hit.frame,
      duration: 50,
      impulse: { x: hit.x, y: hit.y, vx: hit.dx * strength, vy: hit.dy * strength - 120, radius: 30 },
    });
    invalidateWorld();
  }
  p.frames = Math.max(p.frames, (samurai.keys.at(-1)?.frame ?? 0) + 20);
  return p;
}
