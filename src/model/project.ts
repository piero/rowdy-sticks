import type { BodyExtraType, BodySpec, Figure, HeadFeatureType, Item, Project, WeaponType } from './types';
import { DEFAULT_SPEC, standHeight } from './skeleton';
import { basePose, uid } from './pose';
import { WEAPONS } from './weapons';

export function newProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    width: 960,
    height: 540,
    fps: 24,
    frames: 96,
    background: '#f4f1ea',
    groundY: 470,
    showGround: true,
    groundColor: '#c9c2b4',
    effects: { hits: true, blood: true, trails: true, shake: true },
    figures: [],
  };
}

export interface Archetype {
  label: string;
  color: string;
  spec?: Partial<BodySpec>;
  head?: [HeadFeatureType, string][];
  extras?: [BodyExtraType, string][];
  items?: WeaponType[];
  headStyle?: 'filled' | 'outline';
}

export const ARCHETYPES: Record<string, Archetype> = {
  plain: { label: 'Plain stickman', color: '#1d1d1f' },
  ninja: { label: 'Ninja', color: '#16161a', head: [['ninjaMask', '#16161a']], extras: [['scarf', '#b3202a'], ['belt', '#b3202a']], items: ['katana'] },
  kunoichi: { label: 'Kunoichi', color: '#3b2350', head: [['hairPonytail', '#1b1020'], ['hachimaki', '#d6336c'], ['eyes', '#ffffff']], extras: [['skirt', '#3b2350'], ['belt', '#d6336c']], items: ['kunai', 'tanto'] },
  samurai: { label: 'Samurai', color: '#2a1f1d', head: [['helmetKabuto', '#7a1c1c'], ['angryEyes', '#ffffff']], extras: [['chestArmor', '#7a1c1c'], ['belt', '#d4a017']], items: ['katana'] },
  ronin: { label: 'Rōnin', color: '#1f2a33', head: [['topknot', '#111111'], ['strawHat', '#c9a45c']], extras: [['backSword', '#3a2a1a']], items: ['katana', 'wakizashi'] },
  gunslinger: { label: 'Gunslinger', color: '#3a2c20', head: [['cowboyHat', '#6b4423'], ['eyes', '#ffffff']], extras: [['scarf', '#c0392b']], items: ['revolver', 'revolver'] },
  agent: { label: 'Agent', color: '#111418', head: [['hairShort', '#0b0b0b'], ['eyes', '#ffffff']], items: ['pistol', 'knife'] },
  oni: { label: 'Oni demon', color: '#9b1c1c', head: [['hornsOni', '#f2e6c9'], ['angryEyes', '#ffd43b'], ['hairSpiky', '#1a1a1a']], extras: [['belt', '#f2c94c']], items: ['kanabo'] },
  monk: { label: 'Staff monk', color: '#7a4a12', head: [['eyes', '#ffffff']], extras: [['belt', '#e67e22']], items: ['bo'] },
  alien: { label: 'Four-armed alien', color: '#2f9e44', spec: { armPairs: 2 }, head: [['antennae', '#2f9e44'], ['eyes', '#000000']], items: ['smg', 'pistol', 'knife'] },
  octopus: { label: 'Octopus', color: '#7048e8', spec: { armPairs: 1, armStyle: 'tentacle', legPairs: 0, tentacles: 6, torso: 34, head: 40 }, head: [['eyes', '#ffffff']], items: ['knife', 'sai'] },
  spider: { label: 'Spider warrior', color: '#212529', spec: { armPairs: 3, legPairs: 2 }, head: [['hornsDevil', '#c92a2a'], ['angryEyes', '#ff6b6b']], items: ['kama', 'kama', 'shuriken'] },
  viking: { label: 'Viking', color: '#5c3d2e', head: [['helmetViking', '#8d99ae'], ['beard', '#d9a441']], extras: [['cape', '#8b1e1e'], ['belt', '#3e2723']], items: ['sword'] },
  knight: { label: 'Knight', color: '#495057', head: [['helmetKnight', '#adb5bd']], extras: [['cape', '#1c3d8b']], items: ['sword'] },
  soldier: { label: 'Soldier', color: '#3d4a2a', head: [['helmetArmy', '#556b2f'], ['eyes', '#ffffff']], items: ['smg'] },
  princess: { label: 'Long-hair fighter', color: '#a61e4d', head: [['hairLong', '#e8b04b'], ['crown', '#f2c94c'], ['eyes', '#ffffff']], extras: [['skirt', '#d6336c']], items: ['tessen'] },
};

/** New stickmen stand about a third of the default 540px stage tall. */
export const DEFAULT_SCALE = 1.3;

export function createFigure(project: Project, archetypeKey: string, x?: number, flip = false): Figure {
  const a = ARCHETYPES[archetypeKey] ?? ARCHETYPES.plain;
  const n = project.figures.length;
  const fig: Figure = {
    id: uid('fig'),
    name: `${a.label} ${n + 1}`,
    color: a.color,
    lineWidth: 5,
    scale: DEFAULT_SCALE,
    headStyle: a.headStyle ?? 'filled',
    visible: true,
    spec: { ...DEFAULT_SPEC, ...a.spec },
    headFeatures: (a.head ?? []).map(([type, color]) => ({ id: uid('hf'), type, color })),
    extras: (a.extras ?? []).map(([type, color]) => ({ id: uid('bx'), type, color })),
    items: (a.items ?? []).map((type): Item => ({ id: uid('it'), type, color: WEAPONS[type].color, scale: 1 })),
    keys: [],
  };
  const px = x ?? freeSpot(project);
  const py = project.groundY - standHeight(fig);
  fig.keys.push({ frame: 0, ease: 'easeInOut', pose: basePose(fig, px, py, flip) });
  return fig;
}

/** The x position on the stage farthest from every existing stickman's starting position. */
function freeSpot(project: Project): number {
  const taken = project.figures.map((f) => f.keys[0]?.pose.x ?? 0);
  let best = project.width / 2, bestD = -1;
  for (let i = 0; i <= 20; i++) {
    const x = project.width * (0.12 + 0.76 * (i / 20));
    const d = taken.length ? Math.min(...taken.map((t) => Math.abs(t - x))) : Math.abs(x - project.width / 2) * -1;
    if (d > bestD) { best = x; bestD = d; }
  }
  return best;
}

/** Bring loaded JSON up to the current shape, filling anything missing with defaults. */
export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project file');
  const r = raw as Partial<Project>;
  if (!Array.isArray(r.figures)) throw new Error('Project has no figures array');
  const base = newProject();
  const p: Project = { ...base, ...r, effects: { ...base.effects, ...(r.effects ?? {}) }, version: 1, figures: [] };
  for (const f of r.figures as Partial<Figure>[]) {
    if (!f || typeof f !== 'object') continue;
    const fig: Figure = {
      id: f.id ?? uid('fig'),
      name: f.name ?? 'Stickman',
      color: f.color ?? '#1d1d1f',
      lineWidth: f.lineWidth ?? 5,
      scale: f.scale ?? 1,
      headStyle: f.headStyle ?? 'filled',
      visible: f.visible ?? true,
      spec: { ...DEFAULT_SPEC, ...(f.spec ?? {}) },
      headFeatures: f.headFeatures ?? [],
      extras: f.extras ?? [],
      items: (f.items ?? []).filter((i) => i && i.type in WEAPONS),
      keys: (f.keys ?? []).filter((k) => k && k.pose && Number.isFinite(k.frame)).map((k) => ({
        frame: Math.round(k.frame), ease: k.ease ?? 'easeInOut',
        pose: { x: k.pose.x ?? 0, y: k.pose.y ?? 0, flip: !!k.pose.flip, angles: k.pose.angles ?? {}, items: k.pose.items ?? {} },
      })),
    };
    fig.keys.sort((a, b) => a.frame - b.frame);
    if (fig.keys.length === 0) fig.keys.push({ frame: 0, ease: 'easeInOut', pose: basePose(fig, p.width / 2, p.groundY - standHeight(fig)) });
    p.figures.push(fig);
  }
  return p;
}
