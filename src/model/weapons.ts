import type { WeaponType } from './types';

/**
 * Weapon geometry in item-local units: origin = grip (where the hand holds it),
 * +x = the weapon's "forward" direction, figure scale applies on top.
 */
export type StrikeKind = 'blade' | 'blunt';

export interface Strike {
  seg: [number, number, number, number];
  kind: StrikeKind;
}

export interface WeaponDef {
  label: string;
  group: 'Japanese' | 'Blades' | 'Firearms';
  /** Default angle relative to the holding bone, degrees. */
  angle: number;
  /** Handle shown in the editor to rotate the item. */
  tip: (bend: number) => [number, number];
  strikes: (bend: number) => Strike[];
  muzzle?: [number, number];
  flexible?: boolean;
  /** Spins when thrown by the "throw" move. */
  spin?: boolean;
  throwable?: boolean;
  color: string;
}

const s = (x1: number, y1: number, x2: number, y2: number, kind: StrikeKind = 'blade'): Strike => ({ seg: [x1, y1, x2, y2], kind });

/** Nunchaku: stick 1 (0..20) in hand, short chain, stick 2 hanging at `bend`. */
export function nunchakuGeometry(bend: number) {
  const ax = 20, ay = 0;
  const cx = ax + Math.cos(bend) * 6, cy = ay + Math.sin(bend) * 6;
  const ex = cx + Math.cos(bend) * 20, ey = cy + Math.sin(bend) * 20;
  return { ax, ay, cx, cy, ex, ey };
}

/** Kusarigama: chain leaves the pommel at angle (PI + bend). */
export function kusariGeometry(bend: number) {
  const a = Math.PI + bend;
  const len = 70;
  return { px: -4, py: 0, wx: -4 + Math.cos(a) * len, wy: Math.sin(a) * len };
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  katana: { label: 'Katana', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [62, -3], strikes: () => [s(6, 0, 62, -3)] },
  wakizashi: { label: 'Wakizashi', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [45, -2], strikes: () => [s(5, 0, 45, -2)] },
  tanto: { label: 'Tantō', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [24, -1], strikes: () => [s(4, 0, 24, -1)] },
  nodachi: { label: 'Nodachi', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [86, -5], strikes: () => [s(7, 0, 86, -5)] },
  bo: { label: 'Bō staff', group: 'Japanese', angle: -90, color: '#9a6b3f', throwable: true, spin: true,
    tip: () => [48, 0], strikes: () => [s(-48, 0, 48, 0, 'blunt')] },
  naginata: { label: 'Naginata', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [68, -4], strikes: () => [s(40, 0, 68, -4), s(-45, 0, 40, 0, 'blunt')] },
  yari: { label: 'Yari spear', group: 'Japanese', angle: -90, color: '#dfe5ec', throwable: true,
    tip: () => [64, 0], strikes: () => [s(46, 0, 64, 0), s(-45, 0, 46, 0, 'blunt')] },
  kunai: { label: 'Kunai', group: 'Japanese', angle: -90, color: '#c9d0d8', throwable: true,
    tip: () => [18, 0], strikes: () => [s(2, 0, 18, 0)] },
  shuriken: { label: 'Shuriken', group: 'Japanese', angle: 0, color: '#b8c0ca', throwable: true, spin: true,
    tip: () => [14, 0], strikes: () => [s(0, 0, 14, 0), s(7, -7, 7, 7)] },
  sai: { label: 'Sai', group: 'Japanese', angle: -90, color: '#c9d0d8', throwable: true,
    tip: () => [30, 0], strikes: () => [s(0, 0, 30, 0, 'blunt')] },
  tonfa: { label: 'Tonfa', group: 'Japanese', angle: 180, color: '#7a5230',
    tip: () => [30, -5], strikes: () => [s(-8, -5, 30, -5, 'blunt')] },
  nunchaku: { label: 'Nunchaku', group: 'Japanese', angle: -90, color: '#8a5a32', flexible: true,
    tip: (b) => { const g = nunchakuGeometry(b); return [g.ex, g.ey]; },
    strikes: (b) => { const g = nunchakuGeometry(b); return [s(g.cx, g.cy, g.ex, g.ey, 'blunt')]; } },
  kusarigama: { label: 'Kusarigama', group: 'Japanese', angle: -90, color: '#c9d0d8', flexible: true,
    tip: (b) => { const g = kusariGeometry(b); return [g.wx, g.wy]; },
    strikes: (b) => {
      const g = kusariGeometry(b);
      const dx = g.wx - g.px, dy = g.wy - g.py;
      return [s(18, 0, 13, 14), s(g.px + dx * 0.85, g.py + dy * 0.85, g.wx, g.wy, 'blunt')];
    } },
  kama: { label: 'Kama', group: 'Japanese', angle: -90, color: '#c9d0d8', throwable: true,
    tip: () => [13, 14], strikes: () => [s(18, 0, 13, 14)] },
  tessen: { label: 'Tessen fan', group: 'Japanese', angle: -90, color: '#b33a3a',
    tip: () => [24, 0], strikes: () => [s(0, 0, 24, 0, 'blunt')] },
  kanabo: { label: 'Kanabō club', group: 'Japanese', angle: -90, color: '#4b4b55', throwable: true, spin: true,
    tip: () => [62, 0], strikes: () => [s(12, 0, 62, 0, 'blunt')] },
  yumi: { label: 'Yumi bow', group: 'Japanese', angle: 0, color: '#6b3f1f',
    tip: () => [10, -48], strikes: () => [] },
  sword: { label: 'Longsword', group: 'Blades', angle: -90, color: '#e3e7ec', throwable: true,
    tip: () => [60, 0], strikes: () => [s(7, 0, 60, 0)] },
  knife: { label: 'Knife', group: 'Blades', angle: -90, color: '#d6dbe1', throwable: true,
    tip: () => [21, 0], strikes: () => [s(3, 0, 21, 0)] },
  pistol: { label: 'Pistol', group: 'Firearms', angle: 0, color: '#2d2f35', muzzle: [21, -4],
    tip: () => [21, -4], strikes: () => [] },
  revolver: { label: 'Revolver', group: 'Firearms', angle: 0, color: '#4a4d55', muzzle: [27, -4],
    tip: () => [27, -4], strikes: () => [] },
  smg: { label: 'SMG', group: 'Firearms', angle: 0, color: '#26282d', muzzle: [29, -4],
    tip: () => [29, -4], strikes: () => [] },
};

export const WEAPON_TYPES = Object.keys(WEAPONS) as WeaponType[];
