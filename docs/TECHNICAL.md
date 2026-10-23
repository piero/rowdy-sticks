# Rowdy Sticks — Technical Overview

This document explains how the app is put together: the data model, how a frame
is computed and drawn, how hits and ragdolls work, how the editor is wired,
and how export and file I/O work in the browser and in the TinyJS desktop shell.
For features and controls, see the [README](../README.md).

## Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Data model](#2-data-model)
3. [Skeletons](#3-skeletons)
4. [Coordinate spaces](#4-coordinate-spaces)
5. [Animation: keyframes and evaluation](#5-animation-keyframes-and-evaluation)
6. [Weapons and items](#6-weapons-and-items)
7. [The world cache](#7-the-world-cache)
8. [Rendering](#8-rendering)
9. [Hit detection](#9-hit-detection)
10. [Ragdoll physics](#10-ragdoll-physics)
11. [Preset moves](#11-preset-moves)
12. [The editor](#12-the-editor)
13. [Export](#13-export)
14. [Platform layer and desktop backend](#14-platform-layer-and-desktop-backend)
15. [Build, run and test](#15-build-run-and-test)
16. [Extending the app](#16-extending-the-app)

---

## 1. Architecture at a glance

The app is a single-page TypeScript app built with Vite, with no UI framework. It
draws everything on two `<canvas>` elements (stage and timeline) and builds the
side panels with a small DOM helper. Its only runtime dependencies are `gifenc`
(GIF encoding) and `mp4-muxer` (MP4 container).

```
src/main.ts ──► editor/app.ts (startApp)
                   │
     ┌─────────────┼──────────────────────────────┐
     ▼             ▼                              ▼
 editor/state   editor/stage, timeline,       platform/files
 (Editor:       panels, exportDialog          (browser ⇄ TinyJS)
  project,         │                              │
  undo, events)    ▼                              ▼
     │         render/draw ◄── sim/world ◄── model/*     backend/main.ts
     │             ▲              ▲                       (txiki.js fs)
     │             │              │
     │         sim/contacts   sim/ragdoll
     │             ▲
     └──── anim/presets, anim/demo
```

The layers depend on each other in one direction:

| Layer | Depends on | Responsibility |
|---|---|---|
| `model/` | nothing | Plain-JSON types, skeleton builder/solver, pose interpolation, weapon geometry |
| `sim/` | `model` | Per-frame world cache, hit detection, ragdoll baking |
| `render/` | `model`, `sim` | Canvas 2D painters for figures, features, weapons, effects |
| `anim/` | `model`, `sim` | Preset moves and the demo scene |
| `export/` | `render` | GIF / MP4 / sprite-sheet encoders |
| `platform/` | — | File I/O for both environments |
| `editor/` | everything | UI, input, undo, playback |

`model/`, `sim/` and `anim/` don't touch the DOM, so the headless tests run them
directly in Node.

## 2. Data model

All types live in `src/model/types.ts`. A project is plain JSON with no classes,
so it can be serialised for saving, autosave and undo snapshots, and loaded back
with `JSON.parse`.

```
Project
├─ width, height, fps, frames, background
├─ groundY, showGround, groundColor
├─ effects { hits, blood, trails, shake }
└─ figures: Figure[]
     ├─ id, name, color, lineWidth, scale, headStyle, visible
     ├─ spec: BodySpec           ← limb counts/styles and proportions
     ├─ headFeatures: Feature[]  ← { id, type, color }
     ├─ extras: Feature[]        ← scarf, cape, …
     ├─ items: Item[]            ← { id, type: WeaponType, color, scale }
     └─ keys: Keyframe[]         ← sorted by frame
          └─ { frame, ease, pose: Pose }
               └─ Pose { x, y, flip, angles: {boneId: rad}, items: {itemId: ItemState} }
```

Key points:

- **A figure's bones are never stored.** They're derived from `spec` (see §3).
  A pose stores only a relative angle per bone id, and missing angles fall back to
  the bone's rest angle. This means changing the body spec (say, adding an arm
  pair) keeps existing animation working.
- **`ItemState`** is per keyframe. It says whether the item is `attached` to a
  bone (and then its `angle` is relative to that bone) or free (and then `x, y,
  angle` are in world space). It also stores `visible`, `bend` (the chain angle
  for flexible weapons), `mirror` (handedness while free) and `fire` (a firearm
  shoots on this exact keyframe).
- **Loading:** `normalizeProject()` (`model/project.ts`) checks loaded JSON and
  fills in missing fields with defaults. It drops unknown weapon types and
  invalid keys, sorts keys, and makes sure every figure has at least one key.
  Autosave, Open and undo restore all go through it, or through plain
  `JSON.parse` of a snapshot the app made itself.
- **Archetypes** (`ARCHETYPES` in `model/project.ts`) are presets for new
  stickmen (spec overrides plus features, extras and weapons). `createFigure()`
  places a new figure on the ground at the free x position farthest from the
  other figures.

## 3. Skeletons

`buildBones(spec)` in `model/skeleton.ts` creates the bone list:

- `torso` (the root bone, from the hip upwards), then `neck` and `head`.
- For each arm or leg pair *k* and side `B`/`F`, a limb named `armF0`, `legB1`,
  and so on. Normal limbs have 2 segments (`armF0_0`, `armF0_1`). Tentacle limbs
  have `tentacleSegments` tapering segments.
- Hip tentacles `tent0…tentN`, fanned out around the hip.

Each `Bone` has a `parent` (or `null` for the hip), its `length`, `at` (how far
along the parent it attaches, 0–1, so extra arm pairs sit lower on the torso),
its `rest` angle relative to the parent, plus `role`, `limb`, `seg`, `side` and a
`width` multiplier for tapering.

The list is sorted so parents always come before their children. That lets
`solve(fig, pose)` do forward kinematics in a single pass: each bone starts at
`parent.start + (parent.end − parent.start) × at`, its absolute angle is the
parent's angle plus its relative angle, and its end is the start plus the angle
times the length. The result is a `Map<boneId, SolvedBone>`.

Bone lists are cached in a `WeakMap` keyed by the `spec` object. **Changing a
figure's body means replacing `fig.spec` with a new object**, as
`bodySection` does with `fig.spec = { ...fig.spec, ...patch }`. Changing a field
in place would leave the cache out of date.

Helpers:

- `holdBones()`: the end bones of limbs that can hold items, ordered with front
  hands first.
- `limbBonesOf()`: a limb's bones in segment order.
- `standHeight()`: the hip height for a standing figure.

## 4. Coordinate spaces

| Space | Origin / orientation | Used for |
|---|---|---|
| **Figure-local** | hip at (0,0), facing +x, unscaled, y down | `solve()`, presets, drawing a figure |
| **World / stage** | top-left of the project (`width × height`), y down | poses' `x, y`, free items, hit tests, ragdoll |
| **Item-local** | grip at (0,0), +x = weapon forward, unscaled | weapon geometry (`WEAPONS`), weapon painters |
| **Screen** | canvas CSS pixels | editor handles and picking (`Stage.toScreen` / `toStage` apply pan and zoom) |

To go from figure-local to world, mirror x if `pose.flip`, multiply by
`fig.scale`, then translate by `(pose.x, pose.y)`. This is `toWorld`/`toLocal`,
and angles map with `angleToWorld(a) = flip ? π − a : a`. For items,
`itemWorld()` returns a `WorldXf { x, y, ang, mirror, scale }`, and
`itemPointWorld(xf, px, py)` places any item-local point in world space.

## 5. Animation: keyframes and evaluation

`evaluate(fig, frame)` in `model/pose.ts` is the core function that turns keys
into a pose:

- Before the first key or after the last, the pose is held.
- On a key, it returns a clone of the key's pose.
- Between keys *k0* and *k1*, it computes `t = ease(k0.ease, …)`, so a key's
  easing controls the span that *follows* it. `step` holds the pose until the
  next key.
  - Bone angles are interpolated linearly (as already-unwrapped relative angles).
  - The root `x, y` is interpolated linearly, and `flip` comes from *k0*.
  - Items: if both sides are attached to the same bone, the angle and bend are
    interpolated. If either side is free, the item is interpolated in **world
    space**, so a weapon released mid-swing flies smoothly from the hand.
- `fire` is only true on the exact keyframe.

Angles are stored unwrapped. When editing, `unwrapNear(a, ref)` picks the copy of
an angle (mod 2π) closest to the previous value, so interpolation never spins
the long way round.

**Auto-key:** `ensureKey(fig, frame)` returns the key at `frame`, creating it
from the evaluated pose if needed. Every editing action (dragging a handle,
pose panel controls, pasting, flipping) goes through it, so any edit at a frame
creates a keyframe there.

## 6. Weapons and items

`model/weapons.ts` defines `WEAPONS`, keyed by `WeaponType`. Each entry is a
`WeaponDef`, in item-local units:

- `angle`: the default grip angle relative to the holding bone, in degrees.
- `tip(bend)`: where the editor's rotate handle sits.
- `strikes(bend)`: the line segments that can hit, each tagged `blade` or
  `blunt`. Polearms have both a blade tip and a blunt shaft. Firearms and the
  bow have none.
- `muzzle`: present on firearms, the origin of the shot ray.
- `flexible` (nunchaku, kusarigama): geometry depends on `bend`. See
  `nunchakuGeometry` and `kusariGeometry`.
- `throwable` / `spin`: used by the "throw" preset.

`render/weapons.ts` has a painter per weapon type that draws in the same
item-local frame. The geometry in `WEAPONS` and the painters must match, because
hit detection only uses `strikes`.

## 7. The world cache

`sim/world.ts` turns a figure at a frame into everything the renderer and the
simulation need:

```ts
FigWorld {
  pose, solved,
  segs:     BodySeg[]   // world-space capsules per bone (the head is a circle), used as hit targets
  strikers: Striker[]   // the end point of every arm/leg/tentacle (fists, feet, tips)
  blades:   BladeSeg[]  // world-space strike segments of visible items
  muzzles:  Muzzle[]    // firearm muzzle position + direction + fire flag
  items:    { item, xf, visible }[]
}
```

`figWorld(fig, frame)` caches results by `figId@frame`. **Call
`invalidateWorld()` after any change to the project.** `Editor.changed()` does
this for you. It also increments a global revision number that the contact cache
uses (§9).

## 8. Rendering

`render/draw.ts`, `drawScene(ctx, project, frame, opts)` draws one frame in
stage units. The stage, the exporters and the sprite-sheet renderer all use it,
so what you see in the editor is what you export.

Drawing order:

1. Background, then the camera shake offset (from recent hit events, using
   seeded randomness so it's the same every time), then the ground.
2. `opts.underlay` (the onion skin in the editor).
3. Each visible figure in list order. First the blade motion trails (smears
   built from the blade positions over the last 3 frames), then `drawFigure`.
4. Free (released) items for all figures.
5. Hit effects for events up to 12 frames old: slash crescents, impact bursts,
   muzzle flashes and tracers, sparks, and blood particles. Each effect's
   randomness comes from the event's `seed` (`rng` = mulberry32), so effects
   look the same on every play and in every export.
6. `opts.overlay`.

`drawFigure` applies the figure transform (translate, then scale with a negative
x scale when flipped) and draws in figure-local space, back to front:

```
back extras (cape, back sword) → back head features (long hair…)
→ back-side limbs → items held by back limbs
→ torso + neck → head (filled or outline) → front head features
→ front-side limbs → front extras (scarf, belt…) → items held by front/centre bones
```

Extras are drawn in a frame aligned with the torso, and head features in a frame
centred on the head and scaled to its radius. Hair, scarves and capes flutter
using the frame number as time (`ribbon()` in `headFeatures.ts`). Nothing is
simulated, so the flutter is the same every time.

## 9. Hit detection

`sim/contacts.ts`, `computeContacts(project)` scans every frame of the project
and returns a sorted list of `HitEvent`s
(`slash | impact | clash | shot`). `getContacts()` caches the result per
project and world revision, so the timeline, inspector and renderer share one
computation.

For each frame *f*, for each pair of visible figures A and B:

- **Shots:** a muzzle with `fire` sends a ray of up to 2500 units against every
  other figure's segments (ray–circle tests for heads, segment intersection for
  bones). The event is recorded even when the shot misses (`target: null`), so
  the tracer and muzzle flash still draw.
- **Weapons vs bodies:** a blade segment moving faster than 3 units per frame is
  tested against B's body capsules, with a small tolerance. If that misses, the
  sweep of the blade tip from frame *f−1* to *f* is tested too, so fast swings
  can't skip past a target. A `blade` hit is a `slash`, a `blunt` hit is an
  `impact`.
- **Strikers vs bodies:** limb ends moving faster than 4 units per frame are
  tested the same way (point vs capsule, plus the swept path).
- **Clashes:** blade vs blade segment intersection, tested once per pair of
  figures.

To avoid repeated events, a contact key (attacker, weapon or limb, target) only
emits an event when it *starts* touching. It must not have been touching on the
previous frame, and at least 5 frames must have passed since its last event for
that key. Each event records the hit point, the direction and speed of the blow,
the body part hit, and a deterministic `seed`.

Contacts are computed from the animation; they don't change it. The ragdoll
section (§10) is how a hit gets a physical reaction.

## 10. Ragdoll physics

`sim/ragdoll.ts`, `bakeRagdoll(project, fig, options)` runs a **Verlet
simulation** and writes the result as ordinary keyframes.

**Setup:**

- There's one particle for the hip and one for each bone end. Each particle's
  previous position comes from the pose at `startFrame − 1`, so the body keeps
  moving the way it was animated.
- Each bone becomes a distance constraint. Bones attached partway along their
  parent (`at < 1`) use a constraint against a point interpolated between the
  parent's two ends.
- Particle radii come from the line width; the head's comes from its circle.
- Rotational "muscle" springs pull each bone back toward its starting angle
  relative to its parent.
- An optional impulse adds velocity to particles, weighted by a Gaussian of
  their distance from the impact point.
- With `dropItems` on, each held item becomes its own two-particle stick that
  falls separately.

**Step:** the simulation runs 4 substeps per frame. Each substep integrates
(with 0.995 damping and gravity), applies the springs, then runs 8 iterations
that satisfy the constraints and collide particles with the ground (with bounce
and friction). Spring strength fades to zero over the first half of the
duration, so the body goes limp and can't lever itself back up off the floor.

**Bake:** every `keyEvery` frames, each bone's relative angle is recovered
in figure-local space (unwrapped against the previous key to stay continuous),
the root is set to the hip particle, and dropped items become free `ItemState`s.
Keys are `linear`. Existing keys after the start frame are removed (or only
those inside the simulated range, if `clearAfter` is off), and `project.frames`
grows if needed.

"Knock out at hit" in the inspector starts the simulation at a detected hit
event, with the impulse at the hit point in the direction of the blow.

## 11. Preset moves

`anim/presets.ts` describes moves in terms of a canonical humanoid skeleton:
`torso, neck, head, uaF/faF` (front upper arm/forearm), `uaB/faB`,
`thF/shF` (front thigh/shin), `thB/shB`. Angles are in degrees and timing is in
frames at 24 fps. A preset key can also set:

- the root offset (`dx`, mirrored with facing, and `dy`), or `ground` (height above the floor, for lying down)
- weapon grip angles for the front and back hands (`wF`, `wB`)
- `fire`, `release` (throw), `wiggle` (tentacle wave amplitude) and the easing

`insertPreset(project, fig, id, frame, speed)` starts from the figure's pose at
`frame`:

1. Timing is scaled by `fps / 24 / speed`.
2. `mapper(fig)` maps canonical joints onto the figure's actual limbs. Extra arm
   and leg pairs get a spread offset, and extra leg pairs alternate their gait.
   Tentacle limbs split the "lower" angle across their segments and get a sine
   wave. Hip tentacles just wave around their rest angle.
3. Joints a key doesn't mention keep their value from the previous key.
4. **Throws:** at the `release` key, items in the front hand become free and fly
   along the forearm direction, spinning if `spin` is set. Extra keys are added
   to pin the flight path and to hide the item when it lands.
5. Keys in the inserted range are replaced, a key is made at `frame` if needed,
   and `project.frames` grows if needed.

`anim/demo.ts` builds the demo fight in code. It uses presets for the walk,
slashes, stance and block, finds the first hit with `computeContacts`, and bakes
a ragdoll on the samurai from that hit.

## 12. The editor

### State and events: `editor/state.ts`

`Editor` holds the project, the current frame, the selection (`selFig`, `selKey`),
playback state, tool (`fk`/`ik`), onion and FX toggles, and the pose clipboard.
UI parts subscribe with `ed.on(event, fn)`:

| Event | Fired when | Typical listeners |
|---|---|---|
| `project` | any data change | stage, timeline redraw |
| `structure` | figures, keys or body changed | panels re-render |
| `frame` | current frame changed | stage, timeline, pose panel (debounced) |
| `selection` | selected figure or key changed | panels, stage |
| `view` | display-only toggles | stage |

**How to change the project:**

```ts
ed.checkpoint(key?);   // snapshot for undo (same key = merged into one step, e.g. slider drags)
/* change ed.project */
ed.changed(structural?); // invalidate the world cache, emit events, schedule autosave
ed.endEdit();          // end a merged edit (on slider release / pointer up)
```

Undo and redo are stacks of `JSON.stringify(project)` snapshots, up to 120.
Autosave writes the project to `localStorage` 800 ms after the last change, and
`startApp` loads it on startup unless the URL has `?demo`. `?frame=N` opens the
app at frame N.

### Stage: `editor/stage.ts`

The stage canvas is sized for the device pixel ratio, with pan and zoom
(`ox, oy, zoom`). Drawing requests are batched to one per animation frame. It
calls `drawScene` and then draws the editing handles in screen space so they
stay the same size at any zoom.

Handles for the selected figure:

- `root`: an orange square at the hip, to move the figure.
- `bone`: a dot at each bone end, coloured by role.
- `itemTip`: a red diamond, to rotate a weapon or swing a flexible weapon's chain.
- `itemGrip`: a square, to move a free item.

Picking finds the nearest handle within 11 px and favours item handles. If no
handle is hit, it tests the figures' body capsules and blades.

When a drag starts, the stage calls `ensureKey` and `fillItems` and saves the
starting pose. While dragging:

- **FK** (`aimBone`): rotates one bone so it points at the cursor.
- **IK** (`solveCCD`): cyclic coordinate descent over the limb (the last two
  bones of a normal limb, or the whole tentacle), 12 iterations. The bone at the
  end of the chain moves fully each step and the others by 0.8.
- Shift switches between FK and IK for one drag. Alt rotates a flexible weapon
  instead of bending its chain.

### Timeline: `editor/timeline.ts`

The timeline is a canvas with one row per figure. It shows key diamonds (grey
for `step` keys, with a dot for keys that fire), hit markers from `getContacts` on the row of the figure
that was hit (red for hits, yellow for clashes), a ruler and the playhead. You
can scrub on the ruler, drag diamonds to change their
frame (a drag can't drop a key onto another key), double-click to add a key,
and use the wheel to scroll or ⌘/Ctrl+wheel to zoom. It fits the whole project
until you zoom manually.

### Panels: `editor/panels.ts` and `editor/dom.ts`

- **Scene panel (left):** project settings, the figure list (show/hide, reorder,
  duplicate with new item ids, delete) and adding figures from an archetype.
- **Inspector (right):** Stickman, Body, Features, Weapons, Pose @ frame, Moves
  and Ragdoll sections. It re-renders completely on `selection` and `structure`,
  and the scroll position is kept.

`dom.ts` provides `h()` and small control builders (`num`, `select`, `color`,
`check`, `button`, `row`, `section`). All text goes through `textContent`, never
`innerHTML`.

### App wiring: `editor/app.ts`

`startApp` builds the layout and an `actions` table (new, open, save, export,
undo/redo, keys, clipboard, flip, toggles). It also handles:

- **Keyboard shortcuts.** These are ignored while typing in a field or while a
  dialog is open. ⌘Z inside a text field undoes the text, not the project.
- **The native menu** (`tiny.menu`) when running under TinyJS. A menu
  accelerator and a keydown can both fire for one shortcut, so `runOnce` drops
  the second within 150 ms.
- **Playback.** A `requestAnimationFrame` loop works out the frame from elapsed
  time × fps (dropping frames rather than slowing down), and loops if enabled.

## 13. Export

`export/exporters.ts` renders each frame with `drawScene` into an offscreen
canvas, scaled by the chosen output scale. The loop yields to the event loop
(`setTimeout 0`) after every frame so the progress bar updates. Exports can be
cancelled with an `AbortSignal`, which throws `ExportCancelled`.

| Format | How |
|---|---|
| **GIF** | `gifenc`: a 256-colour palette quantised per frame, with frame delay `1000/fps × step` |
| **MP4** | WebCodecs `VideoEncoder` → `mp4-muxer`. Tries several H.264 profiles from High down to Baseline. Dimensions are rounded to even numbers, there's a keyframe every 2 s, and the encoder queue is limited to 8 frames. If WebCodecs isn't available, it falls back to **MediaRecorder** on `canvas.captureStream(0)` in real time (MP4 if supported, otherwise WebM, and the user is told) |
| **Sprite sheet** | All frames in a grid on one canvas (max 16384² px) → PNG, plus optional TexturePacker "hash" JSON. The `image` field is filled in with the saved PNG's name |

`editor/exportDialog.ts` is the dialog. Its settings are module-level, so they
are remembered between exports during a session.

## 14. Platform layer and desktop backend

`platform/files.ts` checks for TinyJS (`inTiny`: is `globalThis.tiny.api.call`
present?) and uses one of two paths:

| | Browser | TinyJS desktop |
|---|---|---|
| Save | `Blob` + `<a download>` | `tiny.dialog.saveFile`, then backend `writeText`, or `writeChunk`… + `finishWrite` for binary |
| Open | hidden `<input type=file>` | `tiny.dialog.openFile` + backend `readText` |
| Alerts | `window.alert/confirm` | `tiny.dialog.alert/confirm` |

The bridge sends strings, so binary exports are base64-encoded in 3 MB chunks.
`backend/main.ts` runs in **txiki.js**. It decodes the chunks, collects them by
upload id, and writes the file with `tjs.writeFile` when `finishWrite` arrives.
The backend only handles filesystem access; all rendering and encoding happens in
the page.

On desktop, Save writes straight back to the opened or saved path. Save As, or
saving a project that was never saved, shows the dialog.

`tinyjs.json` configures the app window (1440×900), icon and bundle id, sets
`backend/main.ts` as the backend, and points to the Vite build (`dist/`) and
dev server. Vite builds with `base: './'` so the page also loads from
`file://` inside the webview.

## 15. Build, run and test

```sh
npm run dev        # Vite dev server on 127.0.0.1:5173
npm run build      # tsc --noEmit + vite build → dist/
npm run typecheck
npm test           # headless tests
tinyjs dev         # desktop window with hot reload
tinyjs build       # dist/Rowdy Sticks.app
```

`scripts/run-tests.mjs` bundles `tests/model.test.ts` with esbuild into a temp
directory and runs it in Node. The tests use only the DOM-free layers:

- The demo produces a hit and a ragdoll.
- Every archetype × every preset produces finite poses.
- The ragdoll keeps bone lengths.
- A thrown shuriken flies and hits.
- A gunshot hits a target in front of the shooter.
- Saving and loading round-trips a project.

## 16. Extending the app

- **New weapon:** add the type to `WeaponType` (`types.ts`), a `WeaponDef` to
  `WEAPONS` (geometry, strikes, muzzle, flags) and a painter to
  `render/weapons.ts` drawn in the same item-local frame. It then appears in the
  inspector, hit detection and presets automatically.
- **New head feature / body extra:** add it to the union type, add a painter
  for the `back` and/or `front` layer, and add it to the labels and default
  colours (`HEAD_FEATURE_LABELS`, `BODY_EXTRA_LABELS`, …). Head features are
  grouped in the "Add" dropdown in `featureSection`.
- **New preset move:** add an entry to `PRESETS` using the canonical joints. The
  `mapper` takes care of extra limbs, and the "every archetype × every preset"
  test checks it automatically.
- **New archetype:** add an entry to `ARCHETYPES`.
- **Project format changes:** keep `normalizeProject()` able to load older
  files by giving new fields defaults, since saved projects and autosaves don't
  carry a migration step.
- **Whenever you change the project,** call `checkpoint()` → change →
  `changed()`, or the world and contact caches will be out of date and undo will
  miss the edit.
