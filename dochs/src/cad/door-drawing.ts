import type { Door } from '../core/types.js';
import { isSliding, leafCount } from '../core/types.js';
import { frameFit, has, hingeLeft, num, parseHinges, swingsIn } from '../core/geometry.js';
import type { Entity, Layer, Pt, View } from './entities.js';

// Parametric door views generated only from the door record. Frame sections are
// schematic: they use the entered frame parameters (width, depth, rebate, gaps)
// and are labelled for verification against the approved frame profile.

const TXT = 2.5; // paper mm
const SMALL = 2;
const STUB = 300; // length of wall shown either side of the opening, drawing extent only

interface Leaf { x0: number; x1: number; hinge: 'left' | 'right' | null }

export interface DoorParams {
  W: number; H: number; g: number; fw: number; rb: number; eg: number; t: number;
  wallT: number; fd: number; fy0: number; fy1: number; uc: number; LH: number;
  frameOk: boolean; swingIn: boolean; leaves: Leaf[]; leafY0: number; leafY1: number;
  apertureX0: number; apertureX1: number; leafTop: number;
}

export function doorParams(d: Door): DoorParams {
  const fit = frameFit(d);
  const frameOk = fit.complete;
  const W = num(d.openingWidth) || 900;
  const H = num(d.openingHeight) || 2100;
  const g = frameOk ? num(d.installGap) : 0;
  const fw = frameOk ? num(d.frameWidth) : 0;
  const c = d.configuration || 'single';
  const rb = frameOk && !isSliding(c) && !c.startsWith('double-action') ? num(d.rebateDepth) : 0;
  const eg = frameOk ? num(d.edgeGap) : 0;
  const t = num(d.leafThickness) || 1;
  const wallT = has(d.wallThickness) ? d.wallThickness : has(d.frameDepth) ? d.frameDepth : Math.max(3 * t, 100);
  const fd = has(d.frameDepth) ? d.frameDepth : wallT;
  const fy0 = d.framePosition === 'flush-outside' ? 0 : d.framePosition === 'flush-inside' ? wallT - fd : (wallT - fd) / 2;
  const fy1 = fy0 + fd;
  const uc = num(d.undercut);
  const LH = num(d.leafHeight) || H - uc;
  const swingIn = swingsIn(d);
  const ax0 = g + fw, ax1 = W - g - fw;
  const L1 = num(d.leafWidth1) || (ax1 - ax0);
  const L2 = num(d.leafWidth2) || L1;
  const x0 = ax0 - rb + eg;
  let leaves: Leaf[];
  if (c === 'sliding-single' || c === 'pocket') {
    const mid = (ax0 + ax1) / 2;
    leaves = [{ x0: mid - L1 / 2, x1: mid + L1 / 2, hinge: null }];
  } else if (c === 'sliding-double') {
    const mid = (ax0 + ax1) / 2;
    leaves = [{ x0: mid - L1, x1: mid, hinge: null }, { x0: mid, x1: mid + L2, hinge: null }];
  } else if (leafCount(c) === 2) {
    leaves = [{ x0, x1: x0 + L1, hinge: 'left' }, { x0: x0 + L1 + eg, x1: x0 + L1 + eg + L2, hinge: 'right' }];
  } else {
    leaves = [{ x0, x1: x0 + L1, hinge: hingeLeft(d) ? 'left' : 'right' }];
  }
  let leafY0: number, leafY1: number;
  const mid = (fy0 + fy1) / 2;
  if (c === 'sliding-single' || c === 'sliding-double') {
    if (swingIn) { leafY0 = wallT + Math.max(eg, 0); leafY1 = leafY0 + t; } else { leafY1 = -Math.max(eg, 0); leafY0 = leafY1 - t; }
  } else if (c === 'pocket' || c.startsWith('double-action') || rb === 0) {
    leafY0 = mid - t / 2; leafY1 = mid + t / 2;
  } else if (swingIn) { leafY0 = fy1 - t; leafY1 = fy1; } else { leafY0 = fy0; leafY1 = fy0 + t; }
  return { W, H, g, fw, rb, eg, t, wallT, fd, fy0, fy1, uc, LH, frameOk, swingIn, leaves, leafY0, leafY1, apertureX0: ax0, apertureX1: ax1, leafTop: uc + LH };
}

// ---------- helpers ----------
const L = (layer: Layer, a: Pt, b: Pt): Entity => ({ t: 'line', layer, a, b });
const rect = (layer: Layer, x0: number, y0: number, x1: number, y1: number): Entity => ({ t: 'poly', layer, closed: true, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const T = (p: Pt, s: string, o: Partial<Extract<Entity, { t: 'text' }>> = {}): Entity => ({ t: 'text', layer: 'A-TEXT', p, h: TXT, s, align: 'center', ...o });
const DH = (a: Pt, b: Pt, off: number, value = Math.abs(b[0] - a[0])): Entity => ({ t: 'dim', layer: 'A-DIMS', a, b, dir: 'h', off, h: TXT, value });
const DV = (a: Pt, b: Pt, off: number, value = Math.abs(b[1] - a[1])): Entity => ({ t: 'dim', layer: 'A-DIMS', a, b, dir: 'v', off, h: TXT, value });

function breakLine(layer: Layer, a: Pt, b: Pt): Entity {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const z = Math.min(len * 0.12, 40);
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return {
    t: 'poly', layer, closed: false, pts: [
      a, [m[0] - ux * z, m[1] - uy * z], [m[0] - ux * z / 2 + nx * z, m[1] - uy * z / 2 + ny * z],
      [m[0] + ux * z / 2 - nx * z, m[1] + uy * z / 2 - ny * z], [m[0] + ux * z, m[1] + uy * z], b,
    ],
  };
}

const rot = (p: Pt, c: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
};

function arcBetween(layer: Layer, c: Pt, r: number, from: number, sweep: number): Entity {
  const a0 = sweep >= 0 ? from : from + sweep;
  const a1 = sweep >= 0 ? from + sweep : from;
  return { t: 'arc', layer, c, r, a0: ((a0 % 360) + 360) % 360, a1: ((a1 % 360) + 360) % 360 };
}

// Jamb profile in plan for the left jamb; mirrored for the right jamb.
function jambPolygon(p: DoorParams): Pt[] {
  const { g, fw, rb, fy0, fy1, t, swingIn } = p;
  const x0 = g, x1 = g + fw;
  if (rb <= 0) return [[x0, fy0], [x1, fy0], [x1, fy1], [x0, fy1]];
  if (swingIn) return [[x0, fy0], [x1, fy0], [x1, fy1 - t], [x1 - rb, fy1 - t], [x1 - rb, fy1], [x0, fy1]];
  return [[x0, fy0], [x1 - rb, fy0], [x1 - rb, fy0 + t], [x1, fy0 + t], [x1, fy1], [x0, fy1]];
}

const mirrorX = (pts: Pt[], W: number): Pt[] => pts.map(([x, y]) => [W - x, y] as Pt);

// ---------- plan ----------
export function planView(d: Door): View {
  const p = doorParams(d);
  const { W, wallT, t } = p;
  const c = d.configuration || 'single';
  const es: Entity[] = [];
  const pocketLeft = c === 'pocket' && (d.handing === 'LH' || d.handing === 'LHR');
  const pocketRight = c === 'pocket' && !pocketLeft;
  const L1 = p.leaves[0].x1 - p.leaves[0].x0;
  const stubL = pocketLeft ? L1 + STUB : STUB;
  const stubR = pocketRight ? L1 + STUB : STUB;
  // walls
  for (const [xa, xb, outer] of [[-stubL, 0, -stubL], [W, W + stubR, W + stubR]] as const) {
    es.push(L('A-WALL', [xa, 0], [xb, 0]), L('A-WALL', [xa, wallT], [xb, wallT]));
    es.push(L('A-WALL', [outer === xa ? xb : xa, 0], [outer === xa ? xb : xa, wallT]));
    es.push(breakLine('A-WALL', [outer, -wallT * 0.3], [outer, wallT * 1.3]));
    if (c === 'pocket' && ((pocketLeft && xa < 0) || (pocketRight && xa >= W))) {
      const cy0 = p.leafY0 - Math.max(p.eg, 5), cy1 = p.leafY1 + Math.max(p.eg, 5);
      es.push({ t: 'hatch', layer: 'A-HATCH', x0: xa, y0: 0, x1: xb, y1: cy0, spacing: 1.5 });
      es.push({ t: 'hatch', layer: 'A-HATCH', x0: xa, y0: cy1, x1: xb, y1: wallT, spacing: 1.5 });
      es.push(rect('A-HIDDEN', xa + STUB * 0.25, cy0, xb, cy1));
    } else es.push({ t: 'hatch', layer: 'A-HATCH', x0: xa, y0: 0, x1: xb, y1: wallT, spacing: 1.5 });
  }
  // frame
  if (p.frameOk) {
    const jp = jambPolygon(p);
    es.push({ t: 'poly', layer: 'A-FRAME', closed: true, pts: jp });
    es.push({ t: 'poly', layer: 'A-FRAME', closed: true, pts: mirrorX(jp, W) });
  }
  // leaves
  const angle = has(d.openingAngle) ? d.openingAngle : 90;
  const n: Pt = p.swingIn ? [0, 1] : [0, -1];
  if (c.startsWith('sliding') || c === 'pocket') {
    for (const lf of p.leaves) {
      es.push(rect('A-DOOR', lf.x0, p.leafY0, lf.x1, p.leafY1));
      const left = c === 'sliding-double' ? lf === p.leaves[0] : d.handing === 'LH' || d.handing === 'LHR';
      const s = (lf.x1 - lf.x0) * (left ? -1 : 1);
      es.push(rect('A-HIDDEN', lf.x0 + s, p.leafY0, lf.x1 + s, p.leafY1));
      const ym = (p.leafY0 + p.leafY1) / 2 + (c === 'pocket' ? 0 : (p.swingIn ? 1 : -1) * (t + 40));
      const xa = (lf.x0 + lf.x1) / 2, xb = xa + s * 0.5;
      const ah = Math.sign(s) * 40;
      es.push(L('A-SWING', [xa, ym], [xb, ym]), L('A-SWING', [xb, ym], [xb - ah, ym + 20]), L('A-SWING', [xb, ym], [xb - ah, ym - 20]));
    }
  } else {
    const da = c.startsWith('double-action');
    for (const lf of p.leaves) {
      const left = lf.hinge === 'left';
      const len = lf.x1 - lf.x0;
      const u: Pt = left ? [1, 0] : [-1, 0];
      const hx = left ? lf.x0 : lf.x1;
      const faceY = da ? (p.leafY0 + p.leafY1) / 2 : p.swingIn ? p.leafY1 : p.leafY0;
      let piv: Pt = [hx, faceY];
      if (c === 'pivot' && has(d.pivotOffset)) piv = [hx + u[0] * d.pivotOffset, (p.leafY0 + p.leafY1) / 2];
      const sign = u[0] * n[1] - u[1] * n[0] > 0 ? 1 : -1;
      const ang = angle * sign;
      // closed leaf rectangle, rotated about the pivot
      const closed: Pt[] = [[lf.x0, p.leafY0], [lf.x1, p.leafY0], [lf.x1, p.leafY1], [lf.x0, p.leafY1]];
      es.push({ t: 'poly', layer: 'A-DOOR', closed: true, pts: closed.map((q) => rot(q, piv, ang)) });
      const from = left ? 0 : 180;
      const reach = c === 'pivot' && has(d.pivotOffset) ? len - d.pivotOffset : len;
      es.push(arcBetween('A-SWING', piv, reach, from, ang));
      if (c === 'pivot' && has(d.pivotOffset) && d.pivotOffset > 0) es.push(arcBetween('A-SWING', piv, d.pivotOffset, from + 180, ang));
      if (da) es.push(arcBetween('A-SWING', piv, reach, from, -ang));
      es.push(rect('A-HIDDEN', lf.x0, p.leafY0, lf.x1, p.leafY1));
    }
  }
  // dimensions on the side away from the swing
  const out = !p.swingIn || c === 'pocket' ? 1 : -1;
  const yb = out < 0 ? 0 : wallT;
  const dim = (x0: number, x1: number, row: number) => es.push(DH([x0, yb], [x1, yb], out * row));
  p.leaves.forEach((lf) => dim(lf.x0, lf.x1, 8));
  if (p.frameOk) dim(p.apertureX0, p.apertureX1, 16);
  dim(0, W, 24);
  es.push(DV([-stubL, 0], [-stubL, wallT], -6));
  es.push(T([W + stubR, -10], 'OUTSIDE', { h: SMALL, align: 'right', valign: 'top' }));
  es.push(T([W + stubR, wallT + 10], 'INSIDE', { h: SMALL, align: 'right' }));
  if (d.handing) es.push(T([W / 2, (p.leafY0 + p.leafY1) / 2], d.handing, { h: SMALL, dp: [0, out < 0 ? -1.5 : 1.5], valign: 'middle' }));
  return { key: 'plan', title: 'PLAN', scale: 20, entities: es, kind: 'main' };
}

// ---------- elevations ----------
export function elevationView(d: Door, side: 'front' | 'back'): View {
  const p = doorParams(d);
  const { W, H, g, fw, rb, uc } = p;
  const c = d.configuration || 'single';
  let es: Entity[] = [];
  const sliding = isSliding(c);
  // front = outside; leaf is on the far side when the door swings / slides away from the viewer
  const farSide = c === 'pocket' ? true : side === 'front' ? p.swingIn : !p.swingIn;
  const da = c.startsWith('double-action');
  const leafHidden = farSide && !da && p.frameOk;
  // opening and floor
  es.push(L('A-WALL', [-STUB, 0], [W + STUB, 0]));
  es.push({ t: 'poly', layer: 'A-WALL', closed: false, pts: [[0, 0], [0, H], [W, H], [W, 0]] });
  // frame
  if (p.frameOk) {
    es.push({ t: 'poly', layer: 'A-FRAME', closed: false, pts: [[g, 0], [g, H - g], [W - g, H - g], [W - g, 0]] });
    const inset = farSide || da || sliding ? fw : fw - rb;
    es.push({ t: 'poly', layer: 'A-FRAME', closed: false, pts: [[g + inset, 0], [g + inset, H - g - inset], [W - g - inset, H - g - inset], [W - g - inset, 0]] });
  }
  const top = p.leafTop;
  const ax0 = p.apertureX0, ax1 = p.apertureX1, ay1 = H - g - fw;
  for (const lf of p.leaves) {
    if (leafHidden || (sliding && farSide)) {
      es.push(rect('A-HIDDEN', lf.x0, uc, lf.x1, top));
      const vx0 = Math.max(lf.x0, ax0), vx1 = Math.min(lf.x1, ax1);
      if (vx1 > vx0) {
        es.push(L('A-DOOR', [vx0, uc], [vx1, uc]));
        if (lf.x0 > ax0) es.push(L('A-DOOR', [lf.x0, uc], [lf.x0, Math.min(top, ay1)]));
        if (lf.x1 < ax1) es.push(L('A-DOOR', [lf.x1, uc], [lf.x1, Math.min(top, ay1)]));
      }
    } else es.push(rect('A-DOOR', lf.x0, uc, lf.x1, top));
    const lw = lf.x1 - lf.x0, cx = (lf.x0 + lf.x1) / 2;
    // vision panel
    if (d.visionPanel && has(d.vpWidth) && has(d.vpHeight) && has(d.vpFromTop) && d.vpWidth < lw) {
      const y1 = top - d.vpFromTop, y0 = y1 - d.vpHeight;
      es.push(rect('A-GLAZ', cx - d.vpWidth / 2, y0, cx + d.vpWidth / 2, y1));
      const q = Math.min(d.vpWidth, d.vpHeight) * 0.3;
      es.push(L('A-GLAZ', [cx - q / 2, y1 - q * 1.2], [cx + q / 2, y1 - q * 0.2]), L('A-GLAZ', [cx - q / 2, y1 - q * 1.8], [cx + q / 2, y1 - q * 0.8]));
    }
    if (d.louvre && has(d.louvreWidth) && has(d.louvreHeight) && has(d.louvreFromBottom)) {
      const y0 = uc + d.louvreFromBottom, y1 = y0 + d.louvreHeight;
      es.push(rect('A-DOOR', cx - d.louvreWidth / 2, y0, cx + d.louvreWidth / 2, y1));
      es.push(L('A-DOOR', [cx - d.louvreWidth / 2, y0], [cx + d.louvreWidth / 2, y1]), L('A-DOOR', [cx - d.louvreWidth / 2, y1], [cx + d.louvreWidth / 2, y0]));
    }
    if (d.kickPlate && has(d.kickPlateHeight)) es.push(rect('A-HDWR', lf.x0, uc, lf.x1, uc + d.kickPlateHeight));
    // hinges / pivots, swing indication, handle
    if (lf.hinge) {
      const hx = lf.hinge === 'left' ? lf.x0 : lf.x1;
      const lx = lf.hinge === 'left' ? lf.x1 : lf.x0;
      if (c === 'pivot') {
        const px = hx + (lf.hinge === 'left' ? 1 : -1) * num(d.pivotOffset);
        es.push({ t: 'circle', layer: 'A-HDWR', c: [px, uc], r: 15 }, { t: 'circle', layer: 'A-HDWR', c: [px, top], r: 15 });
        es.push(L('A-SWING', [lx, uc], [px, (uc + top) / 2]), L('A-SWING', [lx, top], [px, (uc + top) / 2]));
      } else {
        es.push(L('A-SWING', [lx, uc], [hx, (uc + top) / 2]), L('A-SWING', [lx, top], [hx, (uc + top) / 2]));
        parseHinges(d.hingePositions).forEach((hp, i) => {
          es.push(L('A-HDWR', [hx - 25, uc + hp], [hx + 25, uc + hp]));
          es.push(T([hx, uc + hp], `H${i + 1}@${hp}`, { h: SMALL, align: lf.hinge === 'left' ? 'left' : 'right', valign: 'middle', dp: [lf.hinge === 'left' ? 1.5 : -1.5, 0] }));
        });
      }
      if (has(d.handleHeight)) {
        const dir = lf.hinge === 'left' ? -1 : 1;
        const bx = has(d.backset) ? lx + dir * d.backset : lx;
        es.push(L('A-CENTER', [lx, d.handleHeight], [lx + dir * Math.min(200, lw / 3), d.handleHeight]));
        if (has(d.backset)) es.push({ t: 'circle', layer: 'A-HDWR', c: [bx, d.handleHeight], r: 20 });
      }
    } else if (sliding) {
      const left = c === 'sliding-double' ? lf === p.leaves[0] : d.handing === 'LH' || d.handing === 'LHR';
      const ym = (uc + top) / 2, s = (left ? -1 : 1) * lw * 0.3, ah = Math.sign(s) * 50;
      es.push(L('A-SWING', [cx, ym], [cx + s, ym]), L('A-SWING', [cx + s, ym], [cx + s - ah, ym + 30]), L('A-SWING', [cx + s, ym], [cx + s - ah, ym - 30]));
      if (has(d.handleHeight)) es.push(L('A-CENTER', [cx - 100, d.handleHeight], [cx + 100, d.handleHeight]));
    }
  }
  // dimensions (drawn in front-view coordinates, mirrored with the geometry)
  p.leaves.forEach((lf) => es.push(DH([lf.x0, H], [lf.x1, H], 7)));
  es.push(DH([0, H], [W, H], 15));
  if (p.frameOk) es.push(DH([ax0, 0], [ax1, 0], -8));
  es.push(DV([0, 0], [0, H], -10));
  const lf0 = p.leaves[p.leaves.length - 1];
  es.push(DV([lf0.x1, uc], [lf0.x1, top], 8 + (W - lf0.x1) / 20));
  if (uc > 0) es.push(DV([W, 0], [W, uc], 16, uc));
  if (has(d.handleHeight)) es.push(DV([W, 0], [W, d.handleHeight], 24));
  if (d.visionPanel && has(d.vpFromTop) && has(d.vpHeight)) {
    es.push(DV([0, top], [0, top - d.vpFromTop], -20));
    es.push(DV([0, top - d.vpFromTop], [0, top - d.vpFromTop - d.vpHeight], -20));
  }
  if (side === 'back') es = mirrorView(es, W);
  const title = side === 'front' ? 'ELEVATION - OUTSIDE' : 'ELEVATION - INSIDE';
  return { key: `elev-${side}`, title, scale: 20, entities: es, kind: 'main' };
}

function mirrorView(es: Entity[], W: number): Entity[] {
  const m = (q: Pt): Pt => [W - q[0], q[1]];
  return es.map((e): Entity => {
    switch (e.t) {
      case 'line': return { ...e, a: m(e.a), b: m(e.b) };
      case 'poly': return { ...e, pts: e.pts.map(m) };
      case 'circle': return { ...e, c: m(e.c) };
      case 'arc': return { ...e, c: m(e.c), a0: (540 - e.a1) % 360, a1: (540 - e.a0) % 360 };
      case 'text': return { ...e, p: m(e.p), dp: e.dp ? [-e.dp[0], e.dp[1]] : undefined, align: e.align === 'left' ? 'right' : e.align === 'right' ? 'left' : e.align };
      case 'dim': return { ...e, a: m(e.a), b: m(e.b), off: e.dir === 'v' ? -e.off : e.off };
      case 'hatch': return { ...e, x0: W - e.x1, x1: W - e.x0 };
      case 'image': return { ...e, p: [W - e.p[0] - e.w, e.p[1]] };
    }
  });
}

// ---------- sections (detail scale) ----------

export function headSection(d: Door): View | null {
  const p = doorParams(d);
  if (!p.frameOk) return null;
  const { H, g, fw, rb, eg, wallT, fy0, fy1, leafY0, leafY1, leafTop } = p;
  const es: Entity[] = [];
  const up = 100;
  // wall above the opening
  es.push(L('A-WALL', [0, H], [0, H + up]), L('A-WALL', [wallT, H], [wallT, H + up]), L('A-WALL', [0, H], [wallT, H]));
  es.push({ t: 'hatch', layer: 'A-HATCH', x0: 0, y0: H, x1: wallT, y1: H + up, spacing: 2 });
  es.push(breakLine('A-WALL', [-wallT * 0.2, H + up], [wallT * 1.2, H + up]));
  // frame head: jamb profile mapped (x, y) -> (u = y, v = H - x)
  es.push({ t: 'poly', layer: 'A-FRAME', closed: true, pts: jambPolygon(p).map(([x, y]) => [y, H - x] as Pt) });
  // leaf top portion
  const cut = Math.min(150, p.LH);
  es.push({ t: 'poly', layer: 'A-DOOR', closed: false, pts: [[leafY0, leafTop - cut], [leafY0, leafTop], [leafY1, leafTop], [leafY1, leafTop - cut]] });
  es.push(breakLine('A-DOOR', [leafY0 - 20, leafTop - cut], [leafY1 + 20, leafTop - cut]));
  // dims (true values)
  es.push(DV([wallT, H], [wallT, H - g], 14, g));
  es.push(DV([wallT, H - g], [wallT, H - g - fw], 6, fw));
  if (rb > 0) es.push(DV([0, H - g - fw], [0, H - g - fw + rb], -6, rb));
  es.push(DV([0, leafTop], [0, H - g - fw + rb], -14, eg));
  es.push(DH([fy0, H - g - fw], [fy1, H - g - fw], -10, fy1 - fy0));
  es.push(DH([leafY0, leafTop - cut], [leafY1, leafTop - cut], -6, leafY1 - leafY0));
  es.push(DH([0, H + up], [wallT, H + up], 6, wallT));
  es.push(T([wallT, H + up], `FRAME: ${d.frameMaterial || 'NOT SPECIFIED'}`, { h: SMALL, align: 'left', dp: [6, -2] }));
  es.push(T([wallT, H + up], d.frameProfile || 'PROFILE NOT SPECIFIED', { h: SMALL, align: 'left', dp: [6, -5.5] }));
  es.push(T([wallT, leafTop - cut], `LEAF: ${d.leafMaterial || 'NOT SPECIFIED'} ${num(d.leafThickness)} THK`, { h: SMALL, align: 'left', dp: [6, 2] }));
  return { key: 'head', title: 'HEAD SECTION', scale: 5, entities: es, kind: 'detail' };
}

export function jambSection(d: Door): View | null {
  const p = doorParams(d);
  if (!p.frameOk) return null;
  const { g, fw, rb, eg, wallT, fy0, fy1, leafY0, leafY1 } = p;
  const es: Entity[] = [];
  const stub = 120;
  es.push(L('A-WALL', [-stub, 0], [0, 0]), L('A-WALL', [-stub, wallT], [0, wallT]), L('A-WALL', [0, 0], [0, wallT]));
  es.push({ t: 'hatch', layer: 'A-HATCH', x0: -stub, y0: 0, x1: 0, y1: wallT, spacing: 2 });
  es.push(breakLine('A-WALL', [-stub, -wallT * 0.2], [-stub, wallT * 1.2]));
  es.push({ t: 'poly', layer: 'A-FRAME', closed: true, pts: jambPolygon(p) });
  const lx0 = p.leaves[0].x0;
  const run = 150;
  es.push({ t: 'poly', layer: 'A-DOOR', closed: false, pts: [[lx0 + run, leafY0], [lx0, leafY0], [lx0, leafY1], [lx0 + run, leafY1]] });
  es.push(breakLine('A-DOOR', [lx0 + run, leafY0 - 20], [lx0 + run, leafY1 + 20]));
  const yo = 0;
  es.push(DH([0, yo], [g, yo], -13, g));
  es.push(DH([g, yo], [g + fw, yo], -6, fw));
  if (rb > 0) es.push(DH([g + fw - rb, wallT], [g + fw, wallT], 6, rb));
  es.push(DH([g + fw - rb, wallT], [lx0, wallT], 12, eg));
  es.push(DV([g + fw, fy0], [g + fw, fy1], 40, fy1 - fy0));
  es.push(DV([lx0 + run, leafY0], [lx0 + run, leafY1], 8, leafY1 - leafY0));
  es.push(DV([-stub, 0], [-stub, wallT], -6, wallT));
  es.push(T([g + fw / 2, wallT], d.wallType ? `WALL: ${d.wallType}` : 'WALL TYPE NOT SPECIFIED', { h: SMALL, dp: [0, 18] }));
  return { key: 'jamb', title: 'JAMB SECTION', scale: 5, entities: es, kind: 'detail' };
}

export function thresholdSection(d: Door): View {
  const p = doorParams(d);
  const { wallT, uc, leafY0, leafY1 } = p;
  const es: Entity[] = [];
  const cut = 150;
  es.push(L('A-WALL', [-150, 0], [wallT + 150, 0]));
  es.push({ t: 'hatch', layer: 'A-HATCH', x0: -150, y0: -40, x1: wallT + 150, y1: 0, spacing: 2 });
  es.push(L('A-WALL', [-150, -40], [wallT + 150, -40]));
  es.push({ t: 'poly', layer: 'A-DOOR', closed: false, pts: [[leafY0, uc + cut], [leafY0, uc], [leafY1, uc], [leafY1, uc + cut]] });
  es.push(breakLine('A-DOOR', [leafY0 - 20, uc + cut], [leafY1 + 20, uc + cut]));
  if (uc > 0) es.push(DV([leafY1, 0], [leafY1, uc], 8, uc));
  es.push(DH([leafY0, uc + cut], [leafY1, uc + cut], 6, leafY1 - leafY0));
  es.push(T([-150, 0], `THRESHOLD: ${d.threshold || 'NOT SPECIFIED'}`, { h: SMALL, align: 'left', dp: [0, 2] }));
  es.push(T([-150, -40], `FLOOR FINISH: ${d.floorFinish || 'NOT SPECIFIED'}`, { h: SMALL, align: 'left', dp: [0, -4] }));
  return { key: 'threshold', title: 'THRESHOLD SECTION', scale: 5, entities: es, kind: 'detail' };
}

export function doorViews(d: Door): View[] {
  return [elevationView(d, 'front'), elevationView(d, 'back'), planView(d), headSection(d), jambSection(d), thresholdSection(d)].filter((v): v is View => v !== null);
}
