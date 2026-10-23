import type { BodyExtraType, BodySpec, Figure, HeadFeatureType, ItemState, LimbStyle, WeaponType } from '../model/types';
import type { Editor } from './state';
import { button, check, color, h, num, replaceChildren, row, section, select, text } from './dom';
import { ARCHETYPES, createFigure } from '../model/project';
import { HEAD_FEATURE_DEFAULT_COLOR, HEAD_FEATURE_LABELS } from '../render/headFeatures';
import { BODY_EXTRA_DEFAULT_COLOR, BODY_EXTRA_LABELS } from '../render/extras';
import { WEAPONS, WEAPON_TYPES } from '../model/weapons';
import { boneLabel, holdBones, solve, standHeight } from '../model/skeleton';
import { clonePose, D2R, defaultItemState, ensureKey, evaluate, fillItems, itemWorld, uid } from '../model/pose';
import { insertPreset, PRESETS } from '../anim/presets';
import { bakeRagdoll, DEFAULT_RAGDOLL, type RagdollOptions } from '../sim/ragdoll';
import { getContacts } from '../sim/contacts';

// --------------------------------------------------------------------------- scene panel (left)

export function mountScenePanel(ed: Editor, host: HTMLElement) {
  let archetype = 'ninja';
  const render = () => {
    const p = ed.project;
    const live = (key: string, fn: () => void, structural = false) => { ed.checkpoint(key); fn(); ed.changed(structural); };

    const list = h('ul', { class: 'fig-list' });
    p.figures.forEach((fig, i) => {
      const li = h('li', { class: fig.id === ed.selFig ? 'selected' : '', onclick: () => ed.select(fig.id) },
        h('span', { class: 'swatch', style: `background:${fig.color}` }),
        h('span', { class: 'fig-name' }, fig.name),
        h('span', { class: 'fig-actions' },
          button(fig.visible ? '👁' : '–', () => live('vis', () => { fig.visible = !fig.visible; }, true), { title: 'Show / hide', class: 'icon' }),
          button('↑', () => i > 0 && live('order', () => { p.figures.splice(i - 1, 0, p.figures.splice(i, 1)[0]); }, true), { title: 'Move back (drawn earlier)', class: 'icon', disabled: i === 0 }),
          button('↓', () => i < p.figures.length - 1 && live('order', () => { p.figures.splice(i + 1, 0, p.figures.splice(i, 1)[0]); }, true), { title: 'Move forward (drawn later)', class: 'icon', disabled: i === p.figures.length - 1 }),
          button('⧉', () => {
            ed.checkpoint();
            const copy: Figure = JSON.parse(JSON.stringify(fig));
            copy.id = uid('fig');
            copy.name = fig.name + ' copy';
            const idMap = new Map(copy.items.map((it) => [it.id, uid('it')]));
            copy.items.forEach((it) => { it.id = idMap.get(it.id)!; });
            for (const k of copy.keys) {
              k.pose.x += 80;
              k.pose.items = Object.fromEntries(Object.entries(k.pose.items).map(([id, s]) => [idMap.get(id) ?? id, { ...s, x: s.x + 80 }]));
            }
            p.figures.splice(i + 1, 0, copy);
            ed.selFig = copy.id;
            ed.changed(true);
            ed.emit('selection');
          }, { title: 'Duplicate', class: 'icon' }),
          button('✕', () => {
            ed.checkpoint();
            p.figures.splice(i, 1);
            if (ed.selFig === fig.id) ed.selFig = p.figures[0]?.id ?? null;
            ed.changed(true);
            ed.emit('selection');
          }, { title: 'Delete', class: 'icon danger' }),
        ),
      );
      li.addEventListener('dblclick', () => {
        const name = window.prompt('Rename stickman', fig.name);
        if (name) live('rename', () => { fig.name = name; }, true);
      });
      list.append(li);
    });

    const archetypes = Object.entries(ARCHETYPES).map(([k, a]) => [k, a.label] as [string, string]);
    const add = h('div', { class: 'add-row' },
      select(archetype, archetypes, (v) => { archetype = v; }),
      button('Add', () => {
        ed.checkpoint();
        const fig = createFigure(p, archetype, undefined, p.figures.length % 2 === 1);
        // Start it on the current frame's timeline position as well.
        p.figures.push(fig);
        ed.selFig = fig.id;
        ed.changed(true);
        ed.emit('selection');
      }, { class: 'primary' }),
    );

    const fx = p.effects;
    replaceChildren(host,
      section('Stickmen', list, add, h('p', { class: 'hint' }, 'Click a stickman on stage to select it, drag its body to move it. Double-click a name to rename.')),
      section('Project',
        row('Name', text(p.name, (v) => live('pname', () => { p.name = v; }))),
        row('Size', h('span', { class: 'pair' },
          num(p.width, { min: 64, max: 3840, step: 2 }, (v) => live('pw', () => { p.width = Math.round(v); })),
          h('span', {}, '×'),
          num(p.height, { min: 64, max: 2160, step: 2 }, (v) => live('ph', () => { p.height = Math.round(v); })),
        )),
        row('FPS', num(p.fps, { min: 1, max: 60 }, (v) => live('fps', () => { p.fps = Math.max(1, Math.round(v)); }))),
        row('Frames', num(p.frames, { min: 2, max: 3000 }, (v) => live('frames', () => { p.frames = Math.max(2, Math.round(v)); }))),
        row('Background', color(p.background, (v) => live('bg', () => { p.background = v; }))),
        row('Ground', check(p.showGround, (v) => live('sg', () => { p.showGround = v; })),
          color(p.groundColor, (v) => live('gc', () => { p.groundColor = v; }))),
        row('Ground Y', num(p.groundY, { min: 0, max: p.height, range: true }, (v) => live('gy', () => { p.groundY = v; }), () => ed.endEdit())),
      ),
      section('Interaction effects',
        check(fx.hits, (v) => live('fxh', () => { fx.hits = v; }), 'Detect hits (impact, slash, clash, gunshot)'),
        check(fx.blood, (v) => live('fxb', () => { fx.blood = v; }), 'Blood'),
        check(fx.trails, (v) => live('fxt', () => { fx.trails = v; }), 'Weapon motion trails'),
        check(fx.shake, (v) => live('fxs', () => { fx.shake = v; }), 'Screen shake on hits'),
      ),
    );
  };
  ed.on('structure', render);
  ed.on('selection', render);
  render();
}

// --------------------------------------------------------------------------- inspector (right)

const ragdoll: RagdollOptions & { strength: number; direction: number } = { ...DEFAULT_RAGDOLL, strength: 500, direction: 0 };
let presetChoice = 'walk';
let presetSpeed = 1;

export function mountInspector(ed: Editor, host: HTMLElement) {
  let timer = 0;
  const render = () => {
    const fig = ed.fig;
    if (!fig) {
      replaceChildren(host, section('Inspector', h('p', { class: 'hint' }, 'Select a stickman to edit its body, features, weapons and moves.')));
      return;
    }
    const scrollTop = host.scrollTop;
    replaceChildren(host,
      figureSection(ed, fig), bodySection(ed, fig), featureSection(ed, fig), weaponSection(ed, fig),
      poseSection(ed, fig), movesSection(ed, fig), ragdollSection(ed, fig),
    );
    host.scrollTop = scrollTop;
  };
  ed.on('selection', render);
  ed.on('structure', render);
  // The pose section depends on the frame; refresh lazily while scrubbing, not during playback.
  ed.on('frame', () => {
    if (ed.playing) return;
    clearTimeout(timer);
    timer = window.setTimeout(render, 60);
  });
  render();
}

function mutator(ed: Editor) {
  return {
    live: (key: string, fn: () => void, structural = false) => { ed.checkpoint(key); fn(); ed.changed(structural); },
    act: (fn: () => void, structural = true) => { ed.checkpoint(); fn(); ed.changed(structural); },
    end: () => ed.endEdit(),
  };
}

function figureSection(ed: Editor, fig: Figure) {
  const { live, end } = mutator(ed);
  return section('Stickman',
    row('Name', text(fig.name, (v) => live('name', () => { fig.name = v; }), () => { end(); ed.emit('structure'); })),
    row('Colour', color(fig.color, (v) => live('color', () => { fig.color = v; }), () => { end(); ed.emit('structure'); })),
    row('Line width', num(fig.lineWidth, { min: 1, max: 14, step: 0.5, range: true }, (v) => live('lw', () => { fig.lineWidth = v; }), end)),
    row('Scale', num(fig.scale, { min: 0.3, max: 3, step: 0.05, range: true }, (v) => live('scale', () => { fig.scale = v; }), end)),
    row('Head', select(fig.headStyle, [['filled', 'Filled'], ['outline', 'Outline']], (v) => live('hs', () => { fig.headStyle = v; }))),
  );
}

function bodySection(ed: Editor, fig: Figure) {
  const { live, end } = mutator(ed);
  // Replacing the spec object refreshes the cached skeleton.
  const setSpec = (key: string, patch: Partial<BodySpec>, structural = false) =>
    live(key, () => { fig.spec = { ...fig.spec, ...patch }; }, structural);
  const styles: [LimbStyle, string][] = [['normal', 'Normal'], ['tentacle', 'Tentacle']];
  return section('Body',
    row('Arm pairs', num(fig.spec.armPairs, { min: 0, max: 3 }, (v) => setSpec('ap', { armPairs: clampInt(v, 0, 3) }, true)),
      select(fig.spec.armStyle, styles, (v) => setSpec('as', { armStyle: v }, true))),
    row('Leg pairs', num(fig.spec.legPairs, { min: 0, max: 3 }, (v) => setSpec('lp', { legPairs: clampInt(v, 0, 3) }, true)),
      select(fig.spec.legStyle, styles, (v) => setSpec('ls', { legStyle: v }, true))),
    row('Hip tentacles', num(fig.spec.tentacles, { min: 0, max: 10 }, (v) => setSpec('tn', { tentacles: clampInt(v, 0, 10) }, true))),
    row('Tentacle segs', num(fig.spec.tentacleSegments, { min: 3, max: 12 }, (v) => setSpec('ts', { tentacleSegments: clampInt(v, 3, 12) }, true))),
    row('Torso', num(fig.spec.torso, { min: 15, max: 120, range: true }, (v) => setSpec('to', { torso: v }), end)),
    row('Head size', num(fig.spec.head, { min: 8, max: 80, range: true }, (v) => setSpec('he', { head: v }), end)),
    row('Arm length', num(fig.spec.arm, { min: 15, max: 140, range: true }, (v) => setSpec('ar', { arm: v }), end)),
    row('Leg length', num(fig.spec.leg, { min: 15, max: 160, range: true }, (v) => setSpec('le', { leg: v }), end)),
  );
}

function featureSection(ed: Editor, fig: Figure) {
  const { live, act } = mutator(ed);
  const headTypes = Object.entries(HEAD_FEATURE_LABELS) as [HeadFeatureType, string][];
  const extraTypes = Object.entries(BODY_EXTRA_LABELS) as [BodyExtraType, string][];
  const listOf = <T extends string>(arr: { id: string; type: T; color: string }[], labels: Record<T, string>) =>
    h('ul', { class: 'mini-list' }, ...arr.map((f, i) => h('li', {},
      color(f.color, (v) => live('fc' + f.id, () => { f.color = v; })),
      h('span', { class: 'grow' }, labels[f.type]),
      button('↑', () => act(() => { if (i > 0) arr.splice(i - 1, 0, arr.splice(i, 1)[0]); }), { class: 'icon', title: 'Draw earlier', disabled: i === 0 }),
      button('✕', () => act(() => { arr.splice(i, 1); }), { class: 'icon danger', title: 'Remove' }),
    )));
  let headPick: HeadFeatureType = 'hairShort';
  let extraPick: BodyExtraType = 'scarf';
  return section('Features',
    h('div', { class: 'sub' }, 'Head'),
    listOf(fig.headFeatures, HEAD_FEATURE_LABELS),
    h('div', { class: 'add-row' },
      select(headPick, [
        { group: 'Hair', items: headTypes.filter(([k]) => k.startsWith('hair') || k === 'topknot' || k === 'mohawk') },
        { group: 'Horns & more', items: headTypes.filter(([k]) => k.startsWith('horns') || ['antennae', 'halo', 'crown'].includes(k)) },
        { group: 'Headgear', items: headTypes.filter(([k]) => k.startsWith('helmet') || ['ninjaMask', 'hachimaki', 'strawHat', 'cap', 'cowboyHat'].includes(k)) },
        { group: 'Face', items: headTypes.filter(([k]) => ['eyes', 'angryEyes', 'beard'].includes(k)) },
      ], (v) => { headPick = v; }),
      button('Add', () => act(() => { fig.headFeatures.push({ id: uid('hf'), type: headPick, color: HEAD_FEATURE_DEFAULT_COLOR[headPick] ?? '#222222' }); })),
    ),
    h('div', { class: 'sub' }, 'Body'),
    listOf(fig.extras, BODY_EXTRA_LABELS),
    h('div', { class: 'add-row' },
      select(extraPick, extraTypes, (v) => { extraPick = v; }),
      button('Add', () => act(() => { fig.extras.push({ id: uid('bx'), type: extraPick, color: BODY_EXTRA_DEFAULT_COLOR[extraPick] }); })),
    ),
  );
}

function weaponOptions() {
  const groups: Record<string, [WeaponType, string][]> = {};
  for (const t of WEAPON_TYPES) (groups[WEAPONS[t].group] ??= []).push([t, WEAPONS[t].label]);
  return Object.entries(groups).map(([group, items]) => ({ group, items }));
}

function weaponSection(ed: Editor, fig: Figure) {
  const { live, act, end } = mutator(ed);
  let pick: WeaponType = 'katana';
  const hands = holdBones(fig);
  const list = h('ul', { class: 'mini-list' }, ...fig.items.map((it, i) => h('li', {},
    color(it.color, (v) => live('ic' + it.id, () => { it.color = v; })),
    h('span', { class: 'grow' }, WEAPONS[it.type].label),
    num(it.scale, { min: 0.3, max: 3, step: 0.1 }, (v) => live('is' + it.id, () => { it.scale = v; }), end),
    button('✕', () => act(() => {
      fig.items.splice(i, 1);
      for (const k of fig.keys) delete k.pose.items[it.id];
    }), { class: 'icon danger', title: 'Remove' }),
  )));
  return section('Weapons',
    list,
    h('div', { class: 'add-row' },
      select(pick, weaponOptions(), (v) => { pick = v; }),
      button('Add', () => act(() => {
        const used = new Set(fig.items.map((it) => fig.keys[0]?.pose.items[it.id]?.bone));
        const bone = hands.find((b) => !used.has(b.id)) ?? hands[0];
        const item = { id: uid('it'), type: pick, color: WEAPONS[pick].color, scale: 1 };
        fig.items.push(item);
        // Hold it in a free hand on every existing key.
        for (const k of fig.keys) k.pose.items[item.id] = defaultItemState(fig, item, bone?.id);
      })),
    ),
    h('p', { class: 'hint' }, 'Drag the red diamond on stage to rotate a weapon. Per-frame grip, release and firing are under Pose.'),
  );
}

function poseSection(ed: Editor, fig: Figure) {
  const { act, live, end } = mutator(ed);
  const f = ed.frame;
  const keyed = fig.keys.find((k) => k.frame === f);
  const pose = keyed?.pose ?? evaluate(fig, f);
  // Every pose edit goes through the key at this frame (auto-key).
  const edit = (key: string | null, fn: (st: { pose: typeof pose }) => void, structural = false) => {
    const run = () => { const k = ensureKey(fig, f); fillItems(fig, k.pose); ed.selKey = f; fn({ pose: k.pose }); };
    if (key) live(key, run, structural); else act(run, structural);
  };
  const hands = holdBones(fig);
  const handOpts = hands.map((b) => [b.id, boneLabel(b)] as [string, string]);

  const items = fig.items.map((it) => {
    const st: ItemState = pose.items[it.id] ?? defaultItemState(fig, it);
    const def = WEAPONS[it.type];
    return h('div', { class: 'item-pose' },
      h('div', { class: 'item-title' }, def.label),
      row('Held in', select(st.attached ? st.bone : '__free', [...handOpts, ['__free', '— free (not held) —']], (v) => edit(null, ({ pose: p }) => {
        const s = p.items[it.id];
        if (v === '__free') {
          // Release in place: keep the current world transform.
          const xf = itemWorld(fig, p, solve(fig, p), it, s);
          Object.assign(s, { attached: false, x: xf.x, y: xf.y, angle: xf.ang, mirror: xf.mirror });
        } else {
          Object.assign(s, { attached: true, bone: v, angle: s.attached ? s.angle : def.angle * D2R });
        }
      }))),
      row('Angle', num(Math.round((st.angle / D2R) * 10) / 10, { min: -360, max: 360, step: 1, range: true },
        (v) => edit('ia' + it.id, ({ pose: p }) => { p.items[it.id].angle = v * D2R; }), end)),
      def.flexible ? row('Chain', num(Math.round((st.bend / D2R) * 10) / 10, { min: -360, max: 360, step: 1, range: true },
        (v) => edit('ib' + it.id, ({ pose: p }) => { p.items[it.id].bend = v * D2R; }), end)) : null,
      h('div', { class: 'checks' },
        check(st.visible, (v) => edit(null, ({ pose: p }) => { p.items[it.id].visible = v; }), 'Visible'),
        def.muzzle ? check(!!keyed && st.fire, (v) => edit(null, ({ pose: p }) => { p.items[it.id].fire = v; }), 'Fire on this frame') : null,
      ),
    );
  });

  return section(`Pose @ frame ${f}${keyed ? ' (key)' : ''}`,
    h('div', { class: 'btn-grid' },
      button('Flip facing', () => edit(null, ({ pose: p }) => { p.flip = !p.flip; })),
      button('Mirror limbs', () => edit(null, ({ pose: p }) => mirrorLimbs(p))),
      button('Reset pose', () => edit(null, ({ pose: p }) => {
        for (const k of Object.keys(p.angles)) delete p.angles[k];
        p.y = ed.project.groundY - standHeight(fig);
      })),
      button('Copy pose', () => { ed.clipboard = clonePose(pose); }, { title: 'Also ⌘C' }),
      button('Paste pose', () => {
        const c = ed.clipboard;
        if (c) edit(null, ({ pose: p }) => { Object.assign(p, clonePose({ ...c, x: p.x, y: p.y })); });
      }, { disabled: !ed.clipboard, title: 'Pastes joint angles, keeps position · ⌘V' }),
      button(keyed ? 'Delete key' : 'Add key', () => act(() => {
        if (keyed) { if (fig.keys.length > 1) fig.keys = fig.keys.filter((k) => k !== keyed); ed.selKey = null; }
        else { ensureKey(fig, f); ed.selKey = f; }
      })),
    ),
    keyed ? row('Ease out', select(keyed.ease, [['easeInOut', 'Ease in-out'], ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out'], ['step', 'Hold (step)']],
      (v) => act(() => { keyed.ease = v; }, false))) : null,
    ...items,
  );
}

/** Swap front and back limbs so the pose reads as the other stance. */
function mirrorLimbs(p: { angles: Record<string, number> }) {
  const a = { ...p.angles };
  for (const id of Object.keys(a)) {
    const m = /^(arm|leg)([BF])(\d+_\d+)$/.exec(id);
    if (!m) continue;
    const other = `${m[1]}${m[2] === 'F' ? 'B' : 'F'}${m[3]}`;
    if (other in a) p.angles[id] = a[other];
  }
}

function movesSection(ed: Editor, fig: Figure) {
  const groups: Record<string, [string, string][]> = {};
  for (const [id, pr] of Object.entries(PRESETS)) (groups[pr.group] ??= []).push([id, pr.label]);
  return section('Moves',
    row('Move', select(presetChoice, Object.entries(groups).map(([group, items]) => ({ group, items })), (v) => { presetChoice = v; })),
    row('Speed', num(presetSpeed, { min: 0.25, max: 3, step: 0.05, range: true }, (v) => { presetSpeed = v; })),
    button(`Insert at frame ${ed.frame}`, () => {
      ed.checkpoint();
      const end = insertPreset(ed.project, fig, presetChoice, ed.frame, presetSpeed);
      ed.changed(true);
      ed.setFrame(end);
    }, { class: 'primary wide' }),
    h('p', { class: 'hint' }, 'Moves continue from the current pose, position and facing, and replace keys in the range they cover. Extra arms, legs and tentacles follow along.'),
  );
}

function ragdollSection(ed: Editor, fig: Figure) {
  const events = ed.project.effects.hits ? getContacts(ed.project).filter((e) => e.target === fig.id && e.kind !== 'clash') : [];
  const nextHit = events.find((e) => e.frame >= ed.frame) ?? events.at(-1);
  const run = (start: number, impulse?: RagdollOptions['impulse']) => {
    ed.checkpoint();
    const n = bakeRagdoll(ed.project, fig, { ...ragdoll, startFrame: start, impulse });
    ed.changed(true);
    ed.setFrame(start + Math.min(ragdoll.duration, 12));
    return n;
  };
  const w = () => {
    const pose = evaluate(fig, ed.frame);
    const a = ragdoll.direction * D2R;
    const dir = pose.flip ? -1 : 1;
    return { x: pose.x, y: pose.y - fig.spec.torso * fig.scale * 0.6, vx: Math.cos(a) * ragdoll.strength * -dir, vy: Math.sin(a) * ragdoll.strength, radius: 40 * fig.scale };
  };
  return section('Ragdoll physics',
    row('Duration', num(ragdoll.duration, { min: 6, max: 240 }, (v) => { ragdoll.duration = clampInt(v, 6, 240); })),
    row('Stiffness', num(ragdoll.stiffness, { min: 0, max: 0.6, step: 0.01, range: true }, (v) => { ragdoll.stiffness = v; })),
    row('Gravity', num(ragdoll.gravity, { min: 0, max: 4000, step: 50, range: true }, (v) => { ragdoll.gravity = v; })),
    row('Bounce', num(ragdoll.bounce, { min: 0, max: 0.9, step: 0.05, range: true }, (v) => { ragdoll.bounce = v; })),
    row('Push', num(ragdoll.strength, { min: 0, max: 2000, step: 25, range: true }, (v) => { ragdoll.strength = v; })),
    row('Push angle', num(ragdoll.direction, { min: -90, max: 90, step: 5, range: true }, (v) => { ragdoll.direction = v; })),
    row('Key every', num(ragdoll.keyEvery, { min: 1, max: 6 }, (v) => { ragdoll.keyEvery = clampInt(v, 1, 6); }), h('span', { class: 'unit' }, 'frames')),
    h('div', { class: 'checks' },
      check(ragdoll.dropItems, (v) => { ragdoll.dropItems = v; }, 'Drop weapons'),
      check(ragdoll.clearAfter, (v) => { ragdoll.clearAfter = v; }, 'Clear later keys'),
    ),
    h('div', { class: 'btn-grid' },
      button(`Ragdoll from frame ${ed.frame}`, () => run(ed.frame, ragdoll.strength > 0 ? w() : undefined), { title: 'Pushed backwards (away from facing) by Push / Push angle' }),
      nextHit
        ? button(`Knock out at hit (frame ${nextHit.frame})`, () => run(nextHit.frame, {
          x: nextHit.x, y: nextHit.y, vx: nextHit.dx * ragdoll.strength, vy: nextHit.dy * ragdoll.strength - ragdoll.strength * 0.2, radius: 30 * fig.scale,
        }), { class: 'primary', title: 'Starts the ragdoll on the detected blow, pushed in the blow direction' })
        : button('No hits detected on this stickman', () => {}, { disabled: true }),
    ),
    h('p', { class: 'hint' }, 'The simulation is baked into keyframes you can tweak afterwards. Velocity carries over from the previous frame.'),
  );
}

function clampInt(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, Math.round(v))); }
