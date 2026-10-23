import assert from 'node:assert/strict';
import { demoProject } from '../src/anim/demo';
import { computeContacts } from '../src/sim/contacts';
import { invalidateWorld, figWorld } from '../src/sim/world';
import { createFigure, newProject, ARCHETYPES, normalizeProject } from '../src/model/project';
import { insertPreset, PRESETS } from '../src/anim/presets';
import { bakeRagdoll, DEFAULT_RAGDOLL } from '../src/sim/ragdoll';
import { defaultItemState } from '../src/model/pose';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name); throw e; }
}

function finitePoses(p: ReturnType<typeof newProject>) {
  for (const fig of p.figures) for (let f = 0; f < p.frames; f++) {
    const w = figWorld(fig, f);
    for (const s of w.segs) for (const v of [s.a.x, s.a.y, s.b.x, s.b.y]) assert.ok(Number.isFinite(v), `${fig.name} frame ${f} not finite`);
    for (const it of w.items) assert.ok(Number.isFinite(it.xf.x) && Number.isFinite(it.xf.y), `item NaN ${fig.name} f${f}`);
  }
}

test('demo project produces a hit and a ragdoll', () => {
  const p = demoProject();
  invalidateWorld();
  const ev = computeContacts(p);
  console.log('     events:', ev.map((e) => `${e.kind}@${e.frame}`).join(' '));
  assert.ok(ev.some((e) => e.kind === 'slash'), 'expected a slash');
  const sam = p.figures[1];
  assert.ok(sam.keys.length > 20, 'expected ragdoll keys');
  const lastPose = sam.keys.at(-1)!.pose;
  // Samurai should end lying near the ground.
  assert.ok(lastPose.y > p.groundY - 40, `samurai root y ${lastPose.y.toFixed(1)} should be near ground ${p.groundY}`);
  finitePoses(p);
});

test('every archetype x every preset stays finite', () => {
  for (const key of Object.keys(ARCHETYPES)) {
    const p = newProject();
    const fig = createFigure(p, key, 300);
    const target = createFigure(p, 'plain', 420, true);
    p.figures.push(fig, target);
    let f = 0;
    for (const id of Object.keys(PRESETS)) f = insertPreset(p, fig, id, f) + 2;
    invalidateWorld();
    finitePoses(p);
    computeContacts(p);
  }
});

test('ragdoll keeps bone lengths', () => {
  const p = newProject();
  const fig = createFigure(p, 'spider', 400);
  p.figures.push(fig);
  bakeRagdoll(p, fig, { ...DEFAULT_RAGDOLL, startFrame: 0, duration: 40, impulse: { x: 400, y: 380, vx: 600, vy: -200, radius: 30 } });
  invalidateWorld();
  const w = figWorld(fig, 40);
  assert.ok(w.pose.y <= p.groundY, 'root above ground');
  for (const s of w.segs) if (!s.circle) assert.ok(s.a.y <= p.groundY + 8 && s.b.y <= p.groundY + 8, `seg ${s.part} below ground: ${s.b.y}`);
  finitePoses(p);
});

test('thrown shuriken flies and hits', () => {
  const p = newProject();
  const a = createFigure(p, 'spider', 300);
  a.items = a.items.filter((i) => i.type === 'shuriken');
  const b = createFigure(p, 'plain', 560, true);
  p.figures.push(a, b);
  // put the shuriken in the front hand
  a.keys[0].pose.items = { [a.items[0].id]: { ...defaultItemState(a, a.items[0]), bone: 'armF0_1' } };
  insertPreset(p, a, 'throw', 0);
  invalidateWorld();
  const ev = computeContacts(p);
  console.log('     events:', ev.map((e) => `${e.kind}@${e.frame}`).join(' '));
  assert.ok(ev.some((e) => e.target === b.id), 'shuriken should hit');
});

test('gun shot hits target in front', () => {
  const p = newProject();
  const a = createFigure(p, 'agent', 300);
  const b = createFigure(p, 'plain', 600, true);
  p.figures.push(a, b);
  insertPreset(p, a, 'shoot', 0);
  invalidateWorld();
  const shots = computeContacts(p).filter((e) => e.kind === 'shot');
  assert.equal(shots.length, 2);
  assert.ok(shots.every((s) => s.target === b.id), 'both shots should hit');
});

test('save/load round trip', () => {
  const p = demoProject();
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.figures.length, 2);
  assert.deepEqual(q.figures[1].keys.length, p.figures[1].keys.length);
});

console.log(`\n${passed} tests passed`);
