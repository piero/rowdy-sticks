import type { Item, ItemState, WeaponType } from '../model/types';
import { kusariGeometry, nunchakuGeometry } from '../model/weapons';
import { shade } from './headFeatures';

/** Weapons are drawn in item-local space: origin = grip, +x = forward. */
type Ctx = CanvasRenderingContext2D;
type Painter = (ctx: Ctx, color: string, st: ItemState) => void;

const WOOD = '#8a5a32';
const WRAP = '#2b2b2b';
const GOLD = '#b08d57';

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function curvedBlade(ctx: Ctx, color: string, from: number, len: number, curve: number, width = 3.4) {
  ctx.fillStyle = color;
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(from, -width / 2);
  ctx.quadraticCurveTo(from + (len - from) * 0.6, -width / 2 - curve, len, -curve - 0.5);
  ctx.quadraticCurveTo(from + (len - from) * 0.55, width / 2 - curve * 0.7, from, width / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function japaneseSword(ctx: Ctx, color: string, len: number, handle: number, curve: number, guard = 5) {
  line(ctx, -handle, 0, 4, 0, 4.2, WRAP);
  ctx.strokeStyle = '#6b6b6b';
  ctx.lineWidth = 0.7;
  for (let x = -handle + 2; x < 3; x += 3.2) {
    ctx.beginPath(); ctx.moveTo(x, -1.8); ctx.lineTo(x + 1.6, 1.8); ctx.stroke();
  }
  curvedBlade(ctx, color, 5.5, len, curve);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(5, 0, 1.4, guard, 0, 0, 2 * Math.PI);
  ctx.fill();
}

function sickle(ctx: Ctx, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(16, -1.5);
  ctx.quadraticCurveTo(25, 6, 13, 15);
  ctx.quadraticCurveTo(18, 6, 14.5, 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function star(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function poly(ctx: Ctx, pts: number[], fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

const painters: Record<WeaponType, Painter> = {
  katana: (ctx, c) => japaneseSword(ctx, c, 62, 14, 3),
  wakizashi: (ctx, c) => japaneseSword(ctx, c, 45, 11, 2),
  tanto: (ctx, c) => japaneseSword(ctx, c, 24, 9, 0.8, 3),
  nodachi: (ctx, c) => japaneseSword(ctx, c, 86, 22, 5),
  sword(ctx, c) {
    line(ctx, -12, 0, 5, 0, 3.6, '#5c3d2e');
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(-13, 0, 2.4, 0, 2 * Math.PI); ctx.fill();
    poly(ctx, [7, -2.4, 52, -2, 60, 0, 52, 2, 7, 2.4], c);
    ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = 0.6; ctx.stroke();
    line(ctx, 6, -8, 6, 8, 2.8, GOLD);
  },
  knife(ctx, c) {
    line(ctx, -9, 0, 3, 0, 4, '#1f1f1f');
    poly(ctx, [3, -2.2, 16, -2.2, 21, 0, 15, 1.8, 3, 1.8], c);
    ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = 0.5; ctx.stroke();
  },
  kunai(ctx, c) {
    ctx.strokeStyle = shade(c, -0.3); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(-12, 0, 3, 0, 2 * Math.PI); ctx.stroke();
    line(ctx, -9, 0, 2, 0, 3.2, '#5c3d2e');
    poly(ctx, [2, 0, 8, -3.6, 18, 0, 8, 3.6], c);
  },
  shuriken(ctx, c) {
    ctx.fillStyle = c;
    star(ctx, 7, 0, 7.5, 2.2, 4);
    ctx.fill();
    ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = 0.6; ctx.stroke();
    ctx.fillStyle = shade(c, -0.6);
    ctx.beginPath(); ctx.arc(7, 0, 1.3, 0, 2 * Math.PI); ctx.fill();
  },
  sai(ctx, c) {
    line(ctx, -8, 0, 2, 0, 3.2, WRAP);
    line(ctx, 2, 0, 28, 0, 2.2, c);
    poly(ctx, [27, -1.1, 31, 0, 27, 1.1], c);
    ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    for (const k of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(2, 7 * k, 10, 8 * k); ctx.stroke();
    }
  },
  tonfa(ctx, c) {
    line(ctx, -8, -5, 30, -5, 4, c);
    line(ctx, 0, -5, 0, 2, 3.6, shade(c, -0.2));
  },
  bo(ctx, c) {
    line(ctx, -48, 0, 48, 0, 3.2, c);
    line(ctx, -48, 0, -43, 0, 3.6, shade(c, -0.4));
    line(ctx, 43, 0, 48, 0, 3.6, shade(c, -0.4));
  },
  naginata(ctx, c) {
    line(ctx, -45, 0, 40, 0, 2.8, WOOD);
    line(ctx, 36, 0, 41, 0, 3.4, GOLD);
    curvedBlade(ctx, c, 40, 68, 4, 4);
  },
  yari(ctx, c) {
    line(ctx, -45, 0, 47, 0, 2.6, WOOD);
    line(ctx, 44, 0, 48, 0, 3.2, GOLD);
    poly(ctx, [47, 0, 53, -3.2, 64, 0, 53, 3.2], c);
  },
  nunchaku(ctx, c, st) {
    const g = nunchakuGeometry(st.bend);
    line(ctx, -2, 0, g.ax, g.ay, 3.6, c);
    ctx.save();
    ctx.setLineDash([1.2, 1]);
    line(ctx, g.ax, g.ay, g.cx, g.cy, 1, '#777');
    ctx.restore();
    line(ctx, g.cx, g.cy, g.ex, g.ey, 3.6, c);
  },
  kusarigama(ctx, c, st) {
    const g = kusariGeometry(st.bend);
    ctx.save();
    ctx.setLineDash([1.6, 1.2]);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 1;
    ctx.beginPath();
    const mx = (g.px + g.wx) / 2, my = (g.py + g.wy) / 2;
    const nx = -(g.wy - g.py) * 0.08, ny = (g.wx - g.px) * 0.08;
    ctx.moveTo(g.px, g.py);
    ctx.quadraticCurveTo(mx + nx, my + ny, g.wx, g.wy);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath(); ctx.arc(g.wx, g.wy, 4, 0, 2 * Math.PI); ctx.fill();
    line(ctx, -4, 0, 18, 0, 3, WOOD);
    sickle(ctx, c);
  },
  kama(ctx, c) {
    line(ctx, -4, 0, 18, 0, 3, WOOD);
    sickle(ctx, c);
  },
  tessen(ctx, c) {
    const R = 26, a = (35 * Math.PI) / 180;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -a, a); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = 0.7;
    for (let i = 0; i <= 6; i++) {
      const aa = -a + (2 * a * i) / 6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(aa) * R, Math.sin(aa) * R); ctx.stroke();
    }
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath(); ctx.arc(R * 0.62, 0, 3.2, 0, 2 * Math.PI); ctx.fill();
  },
  kanabo(ctx, c) {
    line(ctx, -10, 0, 12, 0, 3.2, '#3a2a1a');
    poly(ctx, [12, -3, 60, -4.8, 63, 0, 60, 4.8, 12, 3], c);
    ctx.fillStyle = shade(c, 0.45);
    for (let x = 18; x < 60; x += 6) for (const y of [-2.2, 2.2]) {
      ctx.beginPath(); ctx.arc(x + (y > 0 ? 3 : 0), y, 0.9, 0, 2 * Math.PI); ctx.fill();
    }
  },
  yumi(ctx, c) {
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(1, -60); ctx.lineTo(1, 32); ctx.stroke();
    ctx.strokeStyle = c; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(1, -60); ctx.quadraticCurveTo(20, -12, 1, 32); ctx.stroke();
    line(ctx, 8.5, -6, 8.5, 6, 3.4, WRAP);
  },
  pistol(ctx, c) {
    poly(ctx, [-1, -2, 5, -2, 3, 9, -3, 9], shade(c, 0.15));
    poly(ctx, [-3, -7, 21, -7, 21, -1.5, -3, -1.5], c);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(7, -0.5, 3, 0, Math.PI); ctx.stroke();
  },
  revolver(ctx, c) {
    poly(ctx, [-1, -1, 4, -1, 1, 9, -5, 8], '#6b4423');
    poly(ctx, [-1, -7.5, 8, -7.5, 8, -0.5, -1, -0.5], shade(c, 0.1));
    poly(ctx, [8, -6, 27, -6, 27, -2.5, 8, -2.5], c);
    poly(ctx, [-3, -8, 0, -9.5, 0, -6], c);
  },
  smg(ctx, c) {
    poly(ctx, [6, -1, 10, -1, 11, 13, 7, 13], shade(c, 0.12));
    poly(ctx, [-1, -1, 4, -1, 3, 8, -2, 8], shade(c, 0.12));
    poly(ctx, [-6, -8, 20, -8, 20, -1, -6, -1], c);
    poly(ctx, [20, -6, 29, -6, 29, -3.5, 20, -3.5], c);
  },
};

export function drawWeapon(ctx: Ctx, item: Item, st: ItemState) {
  ctx.save();
  painters[item.type](ctx, item.color, st);
  ctx.restore();
}
