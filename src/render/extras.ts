import type { BodyExtra, BodyExtraType } from '../model/types';
import { ribbon, shade } from './headFeatures';

/**
 * Body extras are drawn in the torso frame: origin = hip, up = -y along the torso,
 * forward = +x. `T` is the torso length, `lw` the figure's line width.
 */
type Ctx = CanvasRenderingContext2D;
type Painter = (ctx: Ctx, T: number, lw: number, color: string, t: number) => void;

const back: Partial<Record<BodyExtraType, Painter>> = {
  cape(ctx, T, _lw, c, t) {
    const sway = Math.sin(t * 0.35) * T * 0.12;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(T * 0.05, -T * 0.98);
    ctx.quadraticCurveTo(-T * 0.45, -T * 0.6, -T * 0.75 + sway, T * 0.45);
    ctx.lineTo(-T * 0.15 + sway * 0.5, T * 0.35);
    ctx.quadraticCurveTo(-T * 0.1, -T * 0.3, -T * 0.08, -T * 0.98);
    ctx.closePath();
    ctx.fill();
  },
  backSword(ctx, T, lw, c) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = c;
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.moveTo(-T * 0.42, -T * 0.12);
    ctx.lineTo(T * 0.02, -T * 0.86);
    ctx.stroke();
    ctx.strokeStyle = '#b08d57';
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.moveTo(-T * 0.0, -T * 0.83);
    ctx.lineTo(T * 0.05, -T * 0.91);
    ctx.stroke();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(T * 0.05, -T * 0.91);
    ctx.lineTo(T * 0.22, -T * 1.2);
    ctx.stroke();
  },
};

const front: Partial<Record<BodyExtraType, Painter>> = {
  belt(ctx, T, lw, c, t) {
    ctx.fillStyle = c;
    ctx.fillRect(-lw * 1.3, -T * 0.16, lw * 2.6, lw * 0.9);
    ribbon(ctx, -lw * 1.0, -T * 0.12, T * 0.38, lw * 0.6, t, 0.8, 0.9);
  },
  skirt(ctx, T, lw, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-lw * 0.9, -T * 0.22);
    ctx.lineTo(lw * 0.9, -T * 0.22);
    ctx.lineTo(T * 0.38, T * 0.38);
    ctx.quadraticCurveTo(0, T * 0.45, -T * 0.38, T * 0.38);
    ctx.closePath();
    ctx.fill();
  },
  chestArmor(ctx, T, _lw, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-T * 0.22, -T * 0.92);
    ctx.lineTo(T * 0.26, -T * 0.92);
    ctx.lineTo(T * 0.2, -T * 0.25);
    ctx.lineTo(-T * 0.17, -T * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(c, -0.4);
    ctx.lineWidth = T * 0.03;
    for (let i = 1; i < 5; i++) {
      const y = -T * (0.92 - i * 0.135);
      ctx.beginPath();
      ctx.moveTo(-T * 0.2, y);
      ctx.lineTo(T * 0.24, y);
      ctx.stroke();
    }
  },
  scarf(ctx, T, lw, c, t) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(0, -T * 0.98, lw * 1.4, lw * 0.85, 0, 0, 2 * Math.PI);
    ctx.fill();
    ribbon(ctx, -lw * 0.6, -T * 0.98, T * 0.9, lw * 1.0, t, 0, 0.2);
    ribbon(ctx, -lw * 0.6, -T * 0.95, T * 0.7, lw * 0.85, t, 1.9, 0.45);
  },
};

export const BODY_EXTRA_LABELS: Record<BodyExtraType, string> = {
  scarf: 'Scarf', belt: 'Belt / obi', backSword: 'Sword on back', cape: 'Cape', skirt: 'Skirt', chestArmor: 'Chest armour',
};

export const BODY_EXTRA_DEFAULT_COLOR: Record<BodyExtraType, string> = {
  scarf: '#c92a2a', belt: '#c92a2a', backSword: '#3a2a1a', cape: '#8b1e1e', skirt: '#d6336c', chestArmor: '#7a1c1c',
};

export function drawExtras(ctx: Ctx, extras: BodyExtra[], layer: 'back' | 'front', T: number, lw: number, t: number) {
  const table = layer === 'back' ? back : front;
  for (const e of extras) {
    const p = table[e.type];
    if (!p) continue;
    ctx.save();
    p(ctx, T, lw, e.color, t);
    ctx.restore();
  }
}
