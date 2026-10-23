import type { HeadFeature, HeadFeatureType } from '../model/types';

/**
 * Head features are drawn in a head frame: origin = head centre, r = head radius,
 * up = -y, forward (the way the figure faces) = +x. Mirroring is handled by the caller.
 * Each feature can have a 'back' part (behind the head circle) and a 'front' part.
 */
export type Layer = 'back' | 'front';

type Ctx = CanvasRenderingContext2D;
type Painter = (ctx: Ctx, r: number, color: string, layer: Layer, t: number) => void;

const DEG = Math.PI / 180;
const polar = (r: number, deg: number): [number, number] => [Math.cos(deg * DEG) * r, Math.sin(deg * DEG) * r];

export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** A fluttering ribbon/tail trailing backwards (-x) from (x, y). */
export function ribbon(ctx: Ctx, x: number, y: number, len: number, width: number, t: number, phase: number, droop = 0.35) {
  const pts: [number, number][] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const wave = Math.sin(t * 0.45 + phase + u * 4) * len * 0.12 * u;
    pts.push([x - u * len, y + u * len * droop + wave]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1] - width / 2);
  for (let i = 1; i <= n; i++) ctx.lineTo(pts[i][0], pts[i][1] - (width / 2) * (1 - (i / n) * 0.6));
  for (let i = n; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + (width / 2) * (1 - (i / n) * 0.6));
  ctx.closePath();
  ctx.fill();
}

function hairCap(ctx: Ctx, r: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.13, 160 * DEG, 335 * DEG);
  ctx.lineTo(r * 0.6, -r * 0.42);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.62, -r * 0.35, -r * 0.4);
  ctx.quadraticCurveTo(-r * 0.75, -r * 0.1, -r * 1.0, r * 0.3);
  ctx.closePath();
  ctx.fill();
}

function horn(ctx: Ctx, r: number, deg: number, half: number, len: number, curl: number) {
  const [ax, ay] = polar(r * 0.92, deg - half);
  const [bx, by] = polar(r * 0.92, deg + half);
  const [tx, ty] = polar(r * len, deg + curl);
  const [cx, cy] = polar(r * (1 + len) * 0.55, deg + curl * 0.2);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(cx - (bx - ax) * 0.3, cy - (by - ay) * 0.3, tx, ty);
  ctx.quadraticCurveTo(cx + (bx - ax) * 0.3, cy + (by - ay) * 0.3, bx, by);
  ctx.closePath();
  ctx.fill();
}

function dome(ctx: Ctx, r: number, k = 1.16, brimY = -0.05) {
  ctx.beginPath();
  ctx.arc(0, 0, r * k, Math.PI, 2 * Math.PI);
  ctx.lineTo(r * k, r * brimY);
  ctx.lineTo(-r * k, r * brimY);
  ctx.closePath();
  ctx.fill();
}

const painters: Record<HeadFeatureType, Painter> = {
  hairShort(ctx, r, c, layer) { if (layer === 'front') { ctx.fillStyle = c; hairCap(ctx, r); } },
  hairSpiky(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    hairCap(ctx, r);
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i <= n * 2; i++) {
      const deg = 170 + (170 * i) / (n * 2);
      const [x, y] = polar(i % 2 ? r * 1.6 : r * 1.0, deg - (i % 2 ? 8 : 0));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },
  hairLong(ctx, r, c, layer, t) {
    ctx.fillStyle = c;
    if (layer === 'back') {
      const sway = Math.sin(t * 0.3) * r * 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, 300 * DEG, 160 * DEG, true);
      ctx.quadraticCurveTo(-r * 1.5, r * 1.4, -r * 1.35 + sway, r * 2.7);
      ctx.lineTo(-r * 0.2 + sway, r * 2.45);
      ctx.quadraticCurveTo(-r * 0.2, r * 1.0, r * 0.25, r * 0.1);
      ctx.closePath();
      ctx.fill();
    } else hairCap(ctx, r);
  },
  hairPonytail(ctx, r, c, layer, t) {
    ctx.fillStyle = c;
    if (layer === 'back') {
      const sway = Math.sin(t * 0.4) * r * 0.25;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.95);
      ctx.quadraticCurveTo(-r * 2.5, -r * 1.0, -r * 2.0 + sway, r * 1.5);
      ctx.quadraticCurveTo(-r * 1.55, -r * 0.1, -r * 0.95, -r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-r * 0.92, -r * 0.78, r * 0.2, 0, 2 * Math.PI);
      ctx.fill();
    } else hairCap(ctx, r);
  },
  hairBun(ctx, r, c, layer) {
    ctx.fillStyle = c;
    if (layer === 'back') { ctx.beginPath(); ctx.arc(-r * 0.78, -r * 0.82, r * 0.45, 0, 2 * Math.PI); ctx.fill(); }
    else hairCap(ctx, r);
  },
  topknot(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 150 * DEG, 215 * DEG);
    ctx.lineTo(-r * 0.4, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.32;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 1.02);
    ctx.quadraticCurveTo(r * 0.2, -r * 1.45, r * 0.6, -r * 1.22);
    ctx.stroke();
  },
  mohawk(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    const n = 5;
    for (let i = 0; i <= n * 2; i++) {
      const deg = 200 + (135 * i) / (n * 2);
      const [x, y] = polar(i % 2 ? r * 1.9 : r * 0.95, deg - (i % 2 ? 10 : 0));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },
  hornsDevil(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    horn(ctx, r, 245, 11, 1.75, -18);
    horn(ctx, r, 300, 11, 1.75, 18);
  },
  hornsOni(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.strokeStyle = shade(c, -0.45);
    ctx.lineWidth = r * 0.06;
    for (const [deg, curl] of [[238, -22], [302, 22]] as const) {
      horn(ctx, r, deg, 15, 2.1, curl);
      ctx.stroke();
    }
  },
  hornsRam(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.strokeStyle = c;
    ctx.lineWidth = r * 0.34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const cx = -r * 0.25, cy = -r * 0.35;
    for (let i = 0; i <= 40; i++) {
      const a = (-80 + i * 9) * DEG;
      const rr = r * (0.95 - i * 0.014);
      const x = cx + Math.cos(a + Math.PI) * rr, y = cy + Math.sin(a + Math.PI) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
  antennae(ctx, r, c, layer, t) {
    if (layer !== 'front') return;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    for (const [dx, ph] of [[-0.35, 0], [0.4, 1.7]]) {
      const wob = Math.sin(t * 0.5 + ph) * r * 0.2;
      const tx = r * dx * 2.1 + wob, ty = -r * 2.3;
      ctx.beginPath();
      ctx.moveTo(r * dx * 0.6, -r * 0.92);
      ctx.quadraticCurveTo(r * dx * 0.4, -r * 1.8, tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.22, 0, 2 * Math.PI);
      ctx.fill();
    }
  },
  halo(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.strokeStyle = c;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.65, r * 0.9, r * 0.26, 0, 0, 2 * Math.PI);
    ctx.stroke();
  },
  crown(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.7);
    const pts = [[-0.7, -1.5], [-0.35, -1.05], [0, -1.6], [0.35, -1.05], [0.7, -1.5], [0.7, -0.7]];
    for (const [x, y] of pts) ctx.lineTo(r * x, r * y);
    ctx.closePath();
    ctx.fill();
  },
  helmetKabuto(ctx, r, c, layer) {
    if (layer === 'back') {
      ctx.fillStyle = shade(c, -0.25);
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.3);
      ctx.lineTo(-r * 1.25, -r * 0.2);
      ctx.lineTo(-r * 1.7, r * 0.7);
      ctx.lineTo(-r * 0.5, r * 0.55);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.fillStyle = c;
    dome(ctx, r, 1.18, -0.1);
    ctx.fillStyle = shade(c, -0.3);
    ctx.fillRect(-r * 1.3, -r * 0.22, r * 2.6, r * 0.2);
    // kuwagata crest
    ctx.fillStyle = '#d4a017';
    ctx.beginPath();
    ctx.moveTo(r * 0.25, -r * 1.05);
    ctx.quadraticCurveTo(r * 1.15, -r * 1.5, r * 0.95, -r * 2.35);
    ctx.quadraticCurveTo(r * 0.75, -r * 1.55, r * 0.05, -r * 1.25);
    ctx.quadraticCurveTo(-r * 0.6, -r * 1.6, -r * 0.55, -r * 2.3);
    ctx.quadraticCurveTo(-r * 0.95, -r * 1.4, -r * 0.1, -r * 1.05);
    ctx.closePath();
    ctx.fill();
  },
  helmetKnight(ctx, r, c, layer, t) {
    if (layer === 'back') {
      ctx.fillStyle = '#c92a2a';
      ribbon(ctx, -r * 0.2, -r * 1.2, r * 1.8, r * 0.5, t, 0, 0.5);
      return;
    }
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, r * 0.95);
    ctx.lineTo(-r * 1.15, -r * 0.4);
    ctx.quadraticCurveTo(-r * 1.1, -r * 1.25, 0, -r * 1.25);
    ctx.quadraticCurveTo(r * 1.15, -r * 1.2, r * 1.2, -r * 0.2);
    ctx.lineTo(r * 1.05, r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(c, -0.55);
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(r * 0.05, -r * 0.18);
    ctx.lineTo(r * 1.15, -r * 0.18);
    ctx.stroke();
    ctx.lineWidth = r * 0.07;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(r * (0.35 + i * 0.22), r * 0.2);
      ctx.lineTo(r * (0.35 + i * 0.22), r * 0.55);
      ctx.stroke();
    }
  },
  helmetArmy(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    dome(ctx, r, 1.2, -0.12);
    ctx.fillStyle = shade(c, -0.3);
    ctx.fillRect(-r * 1.4, -r * 0.2, r * 2.8, r * 0.16);
    ctx.strokeStyle = shade(c, -0.4);
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(r * 0.75, -r * 0.1);
    ctx.lineTo(r * 0.55, r * 0.85);
    ctx.stroke();
  },
  helmetViking(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = '#efe6cf';
    horn(ctx, r * 1.05, 210, 12, 1.95, 25);
    horn(ctx, r * 1.05, 330, 12, 1.95, -25);
    ctx.fillStyle = c;
    dome(ctx, r, 1.17, -0.15);
    ctx.fillStyle = shade(c, -0.35);
    ctx.fillRect(-r * 1.2, -r * 0.28, r * 2.4, r * 0.18);
    ctx.fillRect(r * 0.62, -r * 0.3, r * 0.18, r * 0.75);
  },
  ninjaMask(ctx, r, c, layer, t) {
    if (layer === 'back') {
      ctx.fillStyle = c;
      ribbon(ctx, -r * 0.85, -r * 0.35, r * 1.6, r * 0.32, t, 0, 0.25);
      ribbon(ctx, -r * 0.85, -r * 0.3, r * 1.3, r * 0.28, t, 2.1, 0.55);
      return;
    }
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.06, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#f1c8a5';
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, -r * 0.42);
    ctx.lineTo(r * 1.0, -r * 0.45);
    ctx.quadraticCurveTo(r * 1.1, -r * 0.2, r * 1.0, r * 0.05);
    ctx.lineTo(-r * 0.05, r * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(r * 0.6, -r * 0.2, r * 0.13, r * 0.1, 0, 0, 2 * Math.PI);
    ctx.fill();
  },
  hachimaki(ctx, r, c, layer, t) {
    ctx.fillStyle = c;
    if (layer === 'back') {
      ribbon(ctx, -r * 0.9, -r * 0.45, r * 1.5, r * 0.28, t, 0.5, 0.3);
      ribbon(ctx, -r * 0.9, -r * 0.4, r * 1.2, r * 0.24, t, 2.6, 0.6);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(-r * 1.02, -r * 0.3);
    ctx.lineTo(r * 0.92, -r * 0.55);
    ctx.lineTo(r * 1.0, -r * 0.22);
    ctx.lineTo(-r * 1.0, r * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.33, r * 0.11, 0, 2 * Math.PI);
    ctx.fill();
  },
  strawHat(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-r * 2.1, -r * 0.3);
    ctx.quadraticCurveTo(-r * 0.6, -r * 0.9, 0, -r * 1.55);
    ctx.quadraticCurveTo(r * 0.6, -r * 0.9, r * 2.1, -r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(c, -0.35);
    ctx.lineWidth = r * 0.06;
    ctx.stroke();
    for (const k of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.5);
      ctx.lineTo(r * 1.9 * k, -r * 0.42);
      ctx.stroke();
    }
  },
  cap(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    dome(ctx, r, 1.1, -0.35);
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.5);
    ctx.quadraticCurveTo(r * 1.4, -r * 0.62, r * 1.85, -r * 0.35);
    ctx.lineTo(r * 0.6, -r * 0.28);
    ctx.closePath();
    ctx.fill();
  },
  cowboyHat(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.6);
    ctx.quadraticCurveTo(-r * 0.9, -r * 1.75, -r * 0.2, -r * 1.55);
    ctx.quadraticCurveTo(0, -r * 1.35, r * 0.25, -r * 1.6);
    ctx.quadraticCurveTo(r * 0.9, -r * 1.75, r * 0.8, -r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 2.0, -r * 0.95);
    ctx.quadraticCurveTo(-r * 1.6, -r * 0.45, 0, -r * 0.5);
    ctx.quadraticCurveTo(r * 1.6, -r * 0.45, r * 2.0, -r * 0.95);
    ctx.quadraticCurveTo(r * 1.5, -r * 0.65, 0, -r * 0.72);
    ctx.quadraticCurveTo(-r * 1.5, -r * 0.65, -r * 2.0, -r * 0.95);
    ctx.fill();
    ctx.fillStyle = shade(c, -0.4);
    ctx.fillRect(-r * 0.82, -r * 0.82, r * 1.64, r * 0.18);
  },
  eyes(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(r * 0.5, -r * 0.12, r * 0.12, r * 0.15, 0, 0, 2 * Math.PI);
    ctx.fill();
  },
  angryEyes(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.ellipse(r * 0.5, -r * 0.08, r * 0.13, r * 0.11, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.42);
    ctx.lineTo(r * 0.8, -r * 0.22);
    ctx.stroke();
  },
  beard(ctx, r, c, layer) {
    if (layer !== 'front') return;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, r * 0.45);
    ctx.quadraticCurveTo(r * 0.4, r * 0.55, r * 0.95, r * 0.15);
    ctx.quadraticCurveTo(r * 0.95, r * 1.2, r * 0.45, r * 1.55);
    ctx.quadraticCurveTo(-r * 0.05, r * 1.2, -r * 0.35, r * 0.45);
    ctx.fill();
  },
};

export const HEAD_FEATURE_LABELS: Record<HeadFeatureType, string> = {
  hairShort: 'Hair: short', hairSpiky: 'Hair: spiky', hairLong: 'Hair: long', hairPonytail: 'Hair: ponytail',
  hairBun: 'Hair: bun', topknot: 'Hair: samurai topknot', mohawk: 'Hair: mohawk',
  hornsDevil: 'Horns: devil', hornsOni: 'Horns: oni', hornsRam: 'Horns: ram', antennae: 'Antennae',
  halo: 'Halo', crown: 'Crown',
  helmetKabuto: 'Helmet: kabuto', helmetKnight: 'Helmet: knight', helmetArmy: 'Helmet: army', helmetViking: 'Helmet: viking',
  ninjaMask: 'Ninja hood', hachimaki: 'Hachimaki headband', strawHat: 'Straw hat (kasa)', cap: 'Cap', cowboyHat: 'Cowboy hat',
  eyes: 'Eyes', angryEyes: 'Angry eyes', beard: 'Beard',
};

export const HEAD_FEATURE_DEFAULT_COLOR: Partial<Record<HeadFeatureType, string>> = {
  hairLong: '#e8b04b', hairPonytail: '#3b2314', hairBun: '#3b2314', hornsDevil: '#c92a2a', hornsOni: '#f2e6c9',
  hornsRam: '#c8b48a', halo: '#f2c94c', crown: '#f2c94c', helmetKabuto: '#7a1c1c', helmetKnight: '#adb5bd',
  helmetArmy: '#556b2f', helmetViking: '#8d99ae', hachimaki: '#f8f9fa', strawHat: '#c9a45c', cap: '#1c7ed6',
  cowboyHat: '#6b4423', eyes: '#ffffff', angryEyes: '#ffffff', beard: '#8d5a2b',
};

export function drawHeadFeatures(ctx: Ctx, features: HeadFeature[], r: number, layer: Layer, t: number) {
  for (const f of features) {
    ctx.save();
    painters[f.type]?.(ctx, r, f.color, layer, t);
    ctx.restore();
  }
}
