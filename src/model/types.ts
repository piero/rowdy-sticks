// Core data model. Everything here is plain JSON so projects can be saved,
// cloned for undo, and loaded back without any class revival.

export type BoneShape = 'line' | 'head' | 'tentacle';
export type BoneRole = 'torso' | 'neck' | 'head' | 'arm' | 'leg' | 'tentacle';
/** B = back (far) side, F = front (near) side, C = centre. */
export type Side = 'B' | 'F' | 'C';

export interface Bone {
  id: string;
  /** null = attached to the root (hip). */
  parent: string | null;
  length: number;
  /** Attachment point along the parent bone, 0 = parent start, 1 = parent end. */
  at: number;
  /** Default angle relative to parent (radians). */
  rest: number;
  shape: BoneShape;
  role: BoneRole;
  /** Limb group, e.g. "armF0"; bones in the same limb form an IK chain. */
  limb: string;
  /** Index of this bone inside its limb. */
  seg: number;
  side: Side;
  /** Line width multiplier (tentacles taper). */
  width: number;
}

export type LimbStyle = 'normal' | 'tentacle';

export interface BodySpec {
  armPairs: number;
  armStyle: LimbStyle;
  legPairs: number;
  legStyle: LimbStyle;
  /** Extra tentacles growing from the hip (octopus style). */
  tentacles: number;
  tentacleSegments: number;
  torso: number;
  head: number;
  arm: number;
  leg: number;
}

export type HeadFeatureType =
  | 'hairShort' | 'hairSpiky' | 'hairLong' | 'hairPonytail' | 'hairBun' | 'topknot' | 'mohawk'
  | 'hornsDevil' | 'hornsOni' | 'hornsRam' | 'antennae' | 'halo' | 'crown'
  | 'helmetKabuto' | 'helmetKnight' | 'helmetArmy' | 'helmetViking'
  | 'ninjaMask' | 'hachimaki' | 'strawHat' | 'cap' | 'cowboyHat'
  | 'eyes' | 'angryEyes' | 'beard';

export type BodyExtraType = 'scarf' | 'belt' | 'backSword' | 'cape' | 'skirt' | 'chestArmor';

export interface Feature<T extends string> {
  id: string;
  type: T;
  color: string;
}
export type HeadFeature = Feature<HeadFeatureType>;
export type BodyExtra = Feature<BodyExtraType>;

export type WeaponType =
  | 'katana' | 'wakizashi' | 'tanto' | 'nodachi' | 'bo' | 'naginata' | 'yari' | 'kunai'
  | 'shuriken' | 'sai' | 'tonfa' | 'nunchaku' | 'kusarigama' | 'kama' | 'tessen' | 'kanabo' | 'yumi'
  | 'sword' | 'knife' | 'pistol' | 'revolver' | 'smg';

export interface Item {
  id: string;
  type: WeaponType;
  color: string;
  scale: number;
}

/** Per-keyframe state of an item. */
export interface ItemState {
  attached: boolean;
  /** Bone whose end holds the item when attached. */
  bone: string;
  /** Angle relative to the bone when attached; world angle when free. */
  angle: number;
  /** World position of the grip when free. */
  x: number;
  y: number;
  /** Free items keep the handedness they had when released. */
  mirror: boolean;
  /** Secondary angle for flexible weapons (nunchaku, kusarigama chain). */
  bend: number;
  visible: boolean;
  /** Firearms: a shot is fired on this keyframe. */
  fire: boolean;
}

export interface Pose {
  x: number;
  y: number;
  flip: boolean;
  angles: Record<string, number>;
  items: Record<string, ItemState>;
}

export type Easing = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'step';

export interface Keyframe {
  frame: number;
  ease: Easing;
  pose: Pose;
}

export interface Figure {
  id: string;
  name: string;
  color: string;
  lineWidth: number;
  scale: number;
  headStyle: 'filled' | 'outline';
  visible: boolean;
  spec: BodySpec;
  headFeatures: HeadFeature[];
  extras: BodyExtra[];
  items: Item[];
  keys: Keyframe[];
}

export interface EffectSettings {
  hits: boolean;
  blood: boolean;
  trails: boolean;
  shake: boolean;
}

export interface Project {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  background: string;
  groundY: number;
  showGround: boolean;
  groundColor: string;
  effects: EffectSettings;
  figures: Figure[];
}

export interface Vec { x: number; y: number }

/** Solved bone in figure-local space (root at 0,0, facing right, unscaled). */
export interface SolvedBone {
  bone: Bone;
  sx: number; sy: number;
  ex: number; ey: number;
  /** Absolute angle in local space. */
  ang: number;
}

export type Solved = Map<string, SolvedBone>;
