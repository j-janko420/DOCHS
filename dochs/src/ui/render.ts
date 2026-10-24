import type { Door, Project } from '../core/types.js';
import { CONFIG_LABEL } from '../core/types.js';
import { floorName } from '../core/classify.js';
import { setFor } from '../core/hardware.js';
import { drawingNumber } from '../core/schedule.js';
import type { HwVisual, Look, Metal, RenderSpec, Side } from '../core/render-spec.js';
import { renderSpec } from '../core/render-spec.js';
import { toSvg } from '../cad/svg.js';
import { BRAND, CREDIT, MARK_SVG, TAGLINE } from './brand.js';

// Realistic orthographic door renders on canvas: front (outside), back
// (inside), side and top, with materials, light, soft shadows and the hardware
// set drawn as generic but recognisable items in their stated finishes.

type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const hash = (t: string) => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function hexRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 200, 200];
}
export function shade(c: string, k: number): string {
  const [r, g, b] = hexRgb(c);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const METAL: Record<Metal, [string, string, string]> = {
  satin: ['#eef0f1', '#b9bec2', '#7d8389'], polished: ['#ffffff', '#c9ced3', '#5d646b'], chrome: ['#ffffff', '#d7dce0', '#4d545b'],
  black: ['#5a5d61', '#2a2c2f', '#111214'], brass: ['#f4dfa2', '#c7a35a', '#7d5f27'], bronze: ['#b48b67', '#7a5a3e', '#3f2b1d'],
  white: ['#ffffff', '#eceae6', '#b9b6b0'], aluminium: ['#f1f3f5', '#c4c9ce', '#8d949b'], grey: ['#b9bdc1', '#80868c', '#4b5056'],
};

function metalGrad(g: Ctx, x0: number, y0: number, x1: number, y1: number, m: Metal): CanvasGradient {
  const [hi, mid, lo] = METAL[m];
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, mid); gr.addColorStop(0.18, hi); gr.addColorStop(0.45, mid); gr.addColorStop(0.8, lo); gr.addColorStop(1, mid);
  return gr;
}

function rrect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath();
  g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr); g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr); g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

function withShadow(g: Ctx, k: number, f: () => void, strength = 0.38) {
  g.save();
  g.shadowColor = `rgba(0,0,0,${strength})`;
  g.shadowBlur = Math.max(2, 9 * k * 4);
  g.shadowOffsetX = 2.5 * k * 4;
  g.shadowOffsetY = 4 * k * 4;
  f();
  g.restore();
}

// ---------- surfaces ----------

function surface(g: Ctx, look: Look, x: number, y: number, w: number, h: number, seed: number, k: number, behind?: string) {
  const R = rng(seed);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  switch (look.surface) {
    case 'timber': {
      g.fillStyle = look.color; g.fillRect(x, y, w, h);
      // veneer leaves (slight tone steps) and grain lines
      const leaves = Math.max(2, Math.round(w / (180 * k)));
      for (let i = 0; i < leaves; i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,240,220' : '60,35,15'},${0.03 + R() * 0.05})`; g.fillRect(x + (w / leaves) * i, y, w / leaves, h); }
      const lines = Math.round(w / Math.max(1.2, 3.2 * k));
      for (let i = 0; i < lines; i++) {
        const gx = x + R() * w, amp = (2 + R() * 8) * k, freq = 0.002 / k + R() * 0.004 / k, ph = R() * 6;
        g.strokeStyle = `rgba(${R() > 0.3 ? '70,40,15' : '255,235,200'},${0.05 + R() * 0.12})`;
        g.lineWidth = Math.max(0.4, (0.4 + R() * 1.6) * k * 2);
        g.beginPath();
        for (let yy = y; yy <= y + h; yy += Math.max(2, 20 * k)) { const xx = gx + Math.sin(yy * freq + ph) * amp; if (yy === y) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
        g.stroke();
      }
      break;
    }
    case 'laminate': case 'paint': {
      g.fillStyle = look.color; g.fillRect(x, y, w, h);
      const n = Math.round((w * h) / Math.max(30, 900 * k * k));
      for (let i = 0; i < Math.min(n, 9000); i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,255,255' : '0,0,0'},${look.surface === 'laminate' ? 0.025 : 0.015})`; g.fillRect(x + R() * w, y + R() * h, 1.2, 1.2); }
      const sheen = g.createLinearGradient(x, y, x + w, y + h * 0.6);
      sheen.addColorStop(0, `rgba(255,255,255,${look.surface === 'laminate' ? 0.22 : 0.14})`); sheen.addColorStop(0.45, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = sheen; g.fillRect(x, y, w, h);
      break;
    }
    case 'metal': {
      g.fillStyle = look.color; g.fillRect(x, y, w, h);
      for (let yy = y; yy < y + h; yy += 1.5) { g.fillStyle = `rgba(${R() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + R() * 0.04})`; g.fillRect(x, yy, w, 1); }
      const gr = g.createLinearGradient(x, y, x + w, y);
      gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.15)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      break;
    }
    case 'stone': {
      g.fillStyle = look.color; g.fillRect(x, y, w, h);
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = `rgba(${look.color === '#2c2c2e' ? '230,230,230' : '90,90,95'},${0.12 + R() * 0.2})`;
        g.lineWidth = (0.6 + R() * 2.4) * k * 3;
        g.beginPath();
        let px = x + R() * w, py = y;
        g.moveTo(px, py);
        while (py < y + h) { const nx = px + (R() - 0.5) * w * 0.35, ny = py + h * (0.08 + R() * 0.12); g.quadraticCurveTo(px + (R() - 0.5) * w * 0.3, (py + ny) / 2, nx, ny); px = nx; py = ny; }
        g.stroke();
      }
      const sh = g.createLinearGradient(x, y, x + w, y + h);
      sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(x, y, w, h);
      break;
    }
    case 'glass': glass(g, x, y, w, h, !!look.frosted, behind ?? '#8e9aa5', R); break;
  }
  g.restore();
}

function glass(g: Ctx, x: number, y: number, w: number, h: number, frosted: boolean, behind: string, R: () => number) {
  const room = g.createLinearGradient(x, y, x, y + h);
  room.addColorStop(0, shade(behind, 0.25)); room.addColorStop(0.65, shade(behind, -0.05)); room.addColorStop(1, shade(behind, -0.35));
  g.fillStyle = room; g.fillRect(x, y, w, h);
  g.fillStyle = frosted ? 'rgba(236,242,246,0.86)' : 'rgba(170,205,225,0.32)';
  g.fillRect(x, y, w, h);
  if (frosted) { for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.12})`; g.fillRect(x + R() * w, y + R() * h, 1.5, 1.5); } }
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [o, ww, a] of [[0.12, 0.16, 0.18], [0.38, 0.05, 0.14], [0.62, 0.1, 0.08]] as const) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.moveTo(x + w * o, y); g.lineTo(x + w * (o + ww), y); g.lineTo(x + w * (o + ww) - h * 0.45, y + h); g.lineTo(x + w * o - h * 0.45, y + h); g.closePath(); g.fill();
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2; g.strokeRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2);
}

// ---------- hardware in elevation ----------

interface Leaf { x: number; w: number; hingeLeft: boolean; active: boolean } // mm, left edge in view coordinates

function drawHardware(g: Ctx, s: RenderSpec, side: Side, leaves: Leaf[], X: (mm: number) => number, Y: (mm: number) => number, k: number, frameTopMm: number, wallRightMm: number, wallLeftMm: number) {
  const on = (h: HwVisual) => h.side === side || h.side === 'both';
  const get = (kind: string) => s.hardware.find((h) => h.kind === kind && on(h));
  const leafBottom = s.undercut;
  for (const L of leaves) {
    const lockEdge = L.hingeLeft ? L.x + L.w : L.x;
    const hingeEdge = L.hingeLeft ? L.x : L.x + L.w;
    const toHinge = L.hingeLeft ? -1 : 1;
    const lockX = lockEdge + toHinge * s.backset;
    // hinges: barrels on the pull side
    const hg = get('hinge');
    if (hg) for (const hp of s.hinges) withShadow(g, k, () => {
      const y = leafBottom + hp;
      g.fillStyle = metalGrad(g, X(hingeEdge - 7), 0, X(hingeEdge + 7), 0, hg.metal);
      rrect(g, X(hingeEdge) - 7 * k, Y(y + 50), 14 * k, 100 * k, 6 * k); g.fill();
    }, 0.25);
    // kick / armour plate
    const kp = get('kick-plate');
    if (kp) withShadow(g, k, () => {
      const ph = kp.height ?? 200;
      const x0 = L.x + 15, x1 = L.x + L.w - 15;
      surface(g, { surface: 'metal', color: METAL[kp.metal][1], label: '' }, X(x0), Y(leafBottom + 10 + ph), (x1 - x0) * k, ph * k, 7, k);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.strokeRect(X(x0), Y(leafBottom + 10 + ph), (x1 - x0) * k, ph * k);
    }, 0.15);
    // push plate
    const pp = get('push-plate');
    if (pp && L.active) withShadow(g, k, () => {
      g.fillStyle = metalGrad(g, X(lockEdge + toHinge * 110), 0, X(lockEdge + toHinge * 35), 0, pp.metal);
      rrect(g, X(Math.min(lockEdge + toHinge * 35, lockEdge + toHinge * 110)), Y(1350), 75 * k, 300 * k, 4 * k); g.fill();
    }, 0.2);
    // panic bar
    const pb = get('panic');
    if (pb) withShadow(g, k, () => {
      const x0 = Math.min(hingeEdge - toHinge * 90, lockEdge + toHinge * 60), x1 = Math.max(hingeEdge - toHinge * 90, lockEdge + toHinge * 60);
      g.fillStyle = metalGrad(g, 0, Y(1040), 0, Y(960), pb.metal);
      rrect(g, X(x0), Y(1030), (x1 - x0) * k, 60 * k, 28 * k); g.fill();
      g.fillStyle = metalGrad(g, 0, Y(1070), 0, Y(930), pb.metal);
      for (const ex of [x0, x1 - 70]) { rrect(g, X(ex), Y(1070), 70 * k, 140 * k, 10 * k); g.fill(); }
    });
    // lock-side trim: card lock / pull / lever, cylinder, thumbturn, indicator
    const cl = get('card-lock');
    if (cl && L.active) withShadow(g, k, () => {
      g.fillStyle = metalGrad(g, X(lockX - 35), 0, X(lockX + 35), 0, cl.metal);
      rrect(g, X(lockX - 34), Y(s.handleH + 160), 68 * k, 300 * k, 10 * k); g.fill();
      g.fillStyle = 'rgba(40,120,255,0.85)'; rrect(g, X(lockX - 18), Y(s.handleH + 120), 36 * k, 36 * k, 6 * k); g.fill();
      g.fillStyle = 'rgba(120,255,140,0.9)'; g.beginPath(); g.arc(X(lockX), Y(s.handleH + 60), 4 * k, 0, Math.PI * 2); g.fill();
    });
    const pl = get('pull');
    if (pl && (L.active || s.pair)) withShadow(g, k, () => {
      const len = Math.min(pl.length ?? 300, s.leafH - 200);
      const cx = lockEdge + toHinge * 70, y0 = Math.max(leafBottom + 150, s.handleH - len / 2);
      g.fillStyle = metalGrad(g, X(cx - 14), 0, X(cx + 14), 0, pl.metal);
      rrect(g, X(cx - 14), Y(y0 + len), 28 * k, len * k, 14 * k); g.fill();
      g.fillStyle = shade(METAL[pl.metal][2], 0);
      for (const yy of [y0 + 40, y0 + len - 40]) { g.beginPath(); g.arc(X(cx), Y(yy), 13 * k, 0, Math.PI * 2); g.fill(); }
    });
    const lv = get('lever');
    if (lv && !pl && (L.active || s.pair) && !(pb && side === s.pushSide && !L.active)) withShadow(g, k, () => {
      const rx = X(lockX), ry = Y(s.handleH);
      g.fillStyle = metalGrad(g, rx - 27 * k, ry - 27 * k, rx + 27 * k, ry + 27 * k, lv.metal);
      g.beginPath(); g.arc(rx, ry, 27 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke();
      const dir = toHinge;
      g.fillStyle = metalGrad(g, 0, ry - 11 * k, 0, ry + 11 * k, lv.metal);
      g.beginPath();
      g.moveTo(rx, ry - 10 * k); g.lineTo(rx + dir * 120 * k, ry - 9 * k); g.quadraticCurveTo(rx + dir * 138 * k, ry, rx + dir * 120 * k, ry + 10 * k); g.lineTo(rx, ry + 10 * k); g.closePath(); g.fill();
      g.fillStyle = METAL[lv.metal][1]; g.beginPath(); g.arc(rx, ry, 13 * k, 0, Math.PI * 2); g.fill();
    });
    const cyl = get('cylinder'), tt = get('thumbturn'), ind = get('indicator');
    if (L.active && !cl) {
      const ey = s.handleH - 72;
      if (cyl) withShadow(g, k, () => {
        g.fillStyle = metalGrad(g, X(lockX - 25), Y(ey + 25), X(lockX + 25), Y(ey - 25), cyl.metal);
        g.beginPath(); g.arc(X(lockX), Y(ey), 25 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1b1c1e'; g.beginPath(); g.arc(X(lockX), Y(ey + 4), 6 * k, 0, Math.PI * 2); g.fill(); g.fillRect(X(lockX - 2.5), Y(ey + 4), 5 * k, 14 * k);
      }, 0.25);
      if (tt) withShadow(g, k, () => {
        g.fillStyle = metalGrad(g, X(lockX - 25), Y(ey + 25), X(lockX + 25), Y(ey - 25), tt.metal);
        g.beginPath(); g.arc(X(lockX), Y(ey), 25 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = METAL[tt.metal][2]; rrect(g, X(lockX - 7), Y(ey + 22), 14 * k, 44 * k, 6 * k); g.fill();
      }, 0.25);
      if (ind) withShadow(g, k, () => {
        g.fillStyle = metalGrad(g, X(lockX - 25), Y(ey + 25), X(lockX + 25), Y(ey - 25), ind.metal);
        g.beginPath(); g.arc(X(lockX), Y(ey), 25 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#d33'; g.beginPath(); g.arc(X(lockX), Y(ey), 12 * k, Math.PI, 0); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(X(lockX), Y(ey), 12 * k, 0, Math.PI); g.fill();
      }, 0.25);
    }
    // closer on the leaf head
    const cs = get('closer');
    if (cs && (L.active || s.pair)) withShadow(g, k, () => {
      const top = leafBottom + s.leafH;
      const bx0 = L.hingeLeft ? L.x + 70 : L.x + L.w - 70 - 280;
      g.fillStyle = metalGrad(g, 0, Y(top - 20), 0, Y(top - 85), cs.metal);
      rrect(g, X(bx0), Y(top - 22), 280 * k, 62 * k, 8 * k); g.fill();
      const ax = L.hingeLeft ? bx0 + 250 : bx0 + 30;
      g.strokeStyle = METAL[cs.metal][2]; g.lineWidth = 9 * k; g.lineCap = 'round';
      g.beginPath(); g.moveTo(X(ax), Y(top - 50)); g.lineTo(X(ax + (L.hingeLeft ? 120 : -120)), Y(frameTopMm - 25)); g.stroke();
      g.fillStyle = METAL[cs.metal][1]; rrect(g, X(ax + (L.hingeLeft ? 90 : -150)), Y(frameTopMm - 5), 60 * k, 30 * k, 4 * k); g.fill();
    });
    // viewer / sign
    const vw = get('viewer');
    if (vw && L.active) withShadow(g, k, () => { const cx = L.x + L.w / 2; g.fillStyle = metalGrad(g, X(cx - 14), Y(1514), X(cx + 14), Y(1486), vw.metal); g.beginPath(); g.arc(X(cx), Y(1500), 14 * k, 0, Math.PI * 2); g.fill(); g.fillStyle = '#20262c'; g.beginPath(); g.arc(X(cx), Y(1500), 6 * k, 0, Math.PI * 2); g.fill(); }, 0.25);
    const sg = get('sign');
    if (sg && L.active) withShadow(g, k, () => { const cx = L.x + L.w / 2; g.fillStyle = metalGrad(g, X(cx - 100), 0, X(cx + 100), 0, sg.metal); rrect(g, X(cx - 90), Y(1640), 180 * k, 120 * k, 8 * k); g.fill(); }, 0.2);
    // flush bolts on the inactive leaf's meeting edge
    const fb = s.hardware.find((h) => h.kind === 'flush-bolt');
    if (fb && s.pair && !L.active) for (const yy of [leafBottom + 40, leafBottom + s.leafH - 190]) withShadow(g, k, () => { g.fillStyle = metalGrad(g, X(lockEdge - 10), 0, X(lockEdge + 10), 0, fb.metal); rrect(g, X(lockEdge + toHinge * 22) - 9 * k, Y(yy + 150), 18 * k, 150 * k, 4 * k); g.fill(); }, 0.2);
  }
  // wall-mounted reader on the secure (outside) face, lock side
  const rd = s.hardware.find((h) => h.kind === 'reader');
  if (rd && side === 'outside') withShadow(g, k, () => {
    const lockOnRight = leaves[leaves.length - 1].hingeLeft;
    const x = lockOnRight ? wallRightMm : wallLeftMm - 60;
    g.fillStyle = METAL[rd.metal === 'satin' ? 'black' : rd.metal][1];
    rrect(g, X(x), Y(1250), 60 * k, 130 * k, 8 * k); g.fill();
    g.fillStyle = 'rgba(60,150,255,0.9)'; g.beginPath(); g.arc(X(x + 30), Y(1210), 8 * k, 0, Math.PI * 2); g.fill();
  });
  // overhead track for sliding doors
  const tr = s.hardware.find((h) => h.kind === 'track');
  if (tr || s.sliding) withShadow(g, k, () => { g.fillStyle = metalGrad(g, 0, Y(frameTopMm + 70), 0, Y(frameTopMm), tr?.metal ?? 'aluminium'); g.fillRect(X(wallLeftMm - 50), Y(frameTopMm + 80), (wallRightMm - wallLeftMm + 100) * k, 70 * k); }, 0.25);
}

// ---------- views ----------

export type ViewKind = 'front' | 'back' | 'side' | 'top';

interface Box { x: number; y: number; w: number; h: number }

function wallAndFloor(g: Ctx, b: Box, floorY: number, k: number, seed: number) {
  const R = rng(seed);
  const wall = g.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  wall.addColorStop(0, '#f1efea'); wall.addColorStop(0.6, '#e2dfd8'); wall.addColorStop(1, '#d3cfc6');
  g.fillStyle = wall; g.fillRect(b.x, b.y, b.w, floorY - b.y);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,255,255' : '90,80,60'},0.035)`; g.fillRect(b.x + R() * b.w, b.y + R() * (floorY - b.y), 1.4, 1.4); }
  // skirting
  g.fillStyle = '#ece9e3'; g.fillRect(b.x, floorY - 90 * k, b.w, 90 * k);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(b.x, floorY - 90 * k, b.w, 2);
  const fl = g.createLinearGradient(0, floorY, 0, b.y + b.h);
  fl.addColorStop(0, '#b8ada0'); fl.addColorStop(1, '#8f8478');
  g.fillStyle = fl; g.fillRect(b.x, floorY, b.w, b.y + b.h - floorY);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(b.x, floorY, b.w, Math.max(2, 6 * k));
  // soft vignette
  const v = g.createRadialGradient(b.x + b.w / 2, b.y + b.h * 0.45, Math.min(b.w, b.h) * 0.2, b.x + b.w / 2, b.y + b.h * 0.45, Math.max(b.w, b.h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = v; g.fillRect(b.x, b.y, b.w, b.h);
}

function elevation(g: Ctx, s: RenderSpec, side: Side, b: Box) {
  const margin = 380, above = 300, below = 140;
  const sceneW = s.soW + 2 * margin, sceneH = s.soH + above + below;
  const k = Math.min(b.w / sceneW, b.h / sceneH);
  const ox = b.x + (b.w - sceneW * k) / 2 + margin * k, floorY = b.y + (b.h - sceneH * k) / 2 + (above + s.soH) * k;
  const X = (mm: number) => ox + mm * k, Y = (mm: number) => floorY - mm * k;
  g.save();
  g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
  wallAndFloor(g, b, floorY, k, hash(s.mark + side));
  // structural opening reveal and frame
  const gap = 5, fw = s.fw;
  const fx0 = gap, fx1 = s.soW - gap, fTop = s.soH - gap;
  const ax0 = fx0 + fw, ax1 = fx1 - fw, aTop = fTop - fw;
  withShadow(g, k, () => { g.fillStyle = '#2b2b2b'; g.fillRect(X(fx0), Y(fTop), (fx1 - fx0) * k, fTop * k); }, 0.35);
  for (const [x, y, w, h] of [[fx0, 0, fw, fTop], [fx1 - fw, 0, fw, fTop], [fx0, aTop, fx1 - fx0, fw]] as const) surface(g, s.frame, X(x), Y(y + h), w * k, h * k, hash(s.mark + 'f' + x + y), k);
  // frame bevels
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(X(fx0), Y(fTop), (fx1 - fx0) * k, 2); g.fillRect(X(fx0), Y(fTop), 2, fTop * k);
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(X(ax0) - 2, Y(aTop), 2, aTop * k); g.fillRect(X(ax0), Y(aTop) - 1, (ax1 - ax0) * k, 2);
  // leaves (outside view: hinge on the stated side; inside view mirrored)
  const hingeLeft = side === 'outside' ? s.hingeLeftFromOutside : !s.hingeLeftFromOutside;
  const eg = 3;
  const total = s.leafW.reduce((a, c) => a + c, 0) || 1;
  const leaves: Leaf[] = [];
  const avail = ax1 - ax0 - eg * (s.leafW.length + 1);
  let x = ax0 + eg;
  const order = hingeLeft ? s.leafW : [...s.leafW].reverse();
  order.forEach((lw, i) => {
    const w = (lw / total) * avail;
    const isFirst = i === 0;
    leaves.push({ x, w, hingeLeft: s.pair ? isFirst : hingeLeft, active: s.pair ? (hingeLeft ? isFirst : !isFirst) : true });
    x += w + eg;
  });
  const look = s.face[side];
  // the visible leaf fills the aperture up to the head stop (leaf height runs behind the stop)
  const leafTop = aTop - eg;
  for (const L of leaves) {
    withShadow(g, k, () => { g.fillStyle = look.color; g.fillRect(X(L.x), Y(leafTop), L.w * k, (leafTop - s.undercut) * k); }, 0.25);
    surface(g, look, X(L.x), Y(leafTop), L.w * k, (leafTop - s.undercut) * k, hash(s.mark + side + L.x), k);
    // light from upper left, edge occlusion
    const lg = g.createLinearGradient(X(L.x), Y(leafTop), X(L.x + L.w), Y(s.undercut));
    lg.addColorStop(0, 'rgba(255,255,255,0.10)'); lg.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = lg; g.fillRect(X(L.x), Y(leafTop), L.w * k, (leafTop - s.undercut) * k);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.strokeRect(X(L.x) + 0.5, Y(leafTop) + 0.5, L.w * k - 1, (leafTop - s.undercut) * k - 1);
    if (s.vision && look.surface !== 'glass') {
      const vw = Math.min(s.vision.w, L.w - 160), vh = Math.min(s.vision.h, s.leafH - 400);
      const vx = L.x + (L.w - vw) / 2, vy = leafTop - s.vision.fromTop - vh;
      withShadow(g, k, () => { g.fillStyle = shade(look.color, -0.25); g.fillRect(X(vx - 14), Y(vy + vh + 14), (vw + 28) * k, (vh + 28) * k); }, 0.3);
      surface(g, s.vision.look, X(vx), Y(vy + vh), vw * k, vh * k, hash(s.mark + 'vp'), k, '#7f8b96');
    }
    if (s.louvre) {
      const lw = Math.min(s.louvre.w, L.w - 120), lx = L.x + (L.w - lw) / 2, ly = s.undercut + s.louvre.fromBottom;
      g.fillStyle = shade(look.color, -0.45); g.fillRect(X(lx), Y(ly + s.louvre.h), lw * k, s.louvre.h * k);
      for (let yy = ly + 10; yy < ly + s.louvre.h; yy += 25) { g.fillStyle = metalGrad(g, 0, Y(yy + 14), 0, Y(yy), 'grey'); g.fillRect(X(lx), Y(yy + 14), lw * k, 14 * k); }
    }
  }
  // floor spring plates
  if (s.hardware.some((h) => h.kind === 'floor-spring')) for (const L of leaves) { const hx = L.hingeLeft ? L.x : L.x + L.w; g.fillStyle = metalGrad(g, X(hx - 60), 0, X(hx + 200), 0, 'satin'); g.fillRect(X(L.hingeLeft ? hx : hx - 300), floorY - 2, 300 * k, Math.max(3, 8 * k)); }
  drawHardware(g, s, side, leaves, X, Y, k, fTop, fx1 + 120, fx0 - 120);
  g.restore();
  return k;
}

function hatch(g: Ctx, x: number, y: number, w: number, h: number, step: number) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#d9d4cb'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(80,70,60,0.45)'; g.lineWidth = 1;
  for (let c = -h; c < w; c += step) { g.beginPath(); g.moveTo(x + c, y + h); g.lineTo(x + c + h, y); g.stroke(); }
  g.restore();
  g.strokeStyle = '#4a443d'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
}

const proj = (h: HwVisual) => ({ lever: 70, pull: 75, 'push-plate': 3, 'kick-plate': 2, closer: 55, panic: 95, cylinder: 12, thumbturn: 30, 'card-lock': 25, indicator: 20, viewer: 8, sign: 4 } as Record<string, number>)[h.kind] ?? 0;

function sideView(g: Ctx, s: RenderSpec, b: Box) {
  // section through the closed door, looking from the lock side: outside left, inside right
  const depth = Math.max(s.wallT, s.fd) + 2 * 260, H = s.soH + 420;
  const k = Math.min(b.w / depth, b.h / H);
  const cx = b.x + b.w / 2, floorY = b.y + (b.h - H * k) / 2 + (s.soH + 280) * k;
  const X = (mm: number) => cx + mm * k, Y = (mm: number) => floorY - mm * k;
  g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
  g.fillStyle = '#f4f2ee'; g.fillRect(b.x, b.y, b.w, b.h);
  const wt = s.wallT;
  hatch(g, X(-wt / 2), Y(s.soH + 260), wt * k, 260 * k, 7);
  g.fillStyle = '#9c9186'; g.fillRect(b.x, floorY, b.w, b.y + b.h - floorY);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(b.x, floorY, b.w, 2);
  // frame head in section
  surface(g, s.frame, X(-s.fd / 2), Y(s.soH), s.fd * k, (s.fw + 5) * k, 3, k);
  // leaf edge (flush with the push face of the frame)
  const pushLeft = s.pushSide === 'outside';
  const lx = pushLeft ? -s.fd / 2 + 12 : s.fd / 2 - 12 - s.T;
  withShadow(g, k, () => surface(g, s.edge, X(lx), Y(s.undercut + s.leafH), s.T * k, s.leafH * k, 11, k), 0.25);
  // hardware projections
  for (const h of s.hardware) {
    const p = proj(h);
    if (!p) continue;
    const sides: Side[] = h.side === 'both' ? ['outside', 'inside'] : h.side === 'outside' || h.side === 'inside' ? [h.side] : [];
    for (const sd of sides) {
      const left = sd === 'outside';
      const face = left ? lx : lx + s.T;
      const x0 = left ? face - p : face;
      const yC = h.kind === 'panic' ? 1000 : h.kind === 'closer' ? s.undercut + s.leafH - 50 : h.kind === 'kick-plate' ? s.undercut + 10 + (h.height ?? 200) / 2 : h.kind === 'viewer' || h.kind === 'sign' ? 1500 : h.kind === 'cylinder' || h.kind === 'thumbturn' || h.kind === 'indicator' ? s.handleH - 72 : s.handleH;
      const hh = h.kind === 'kick-plate' ? (h.height ?? 200) : h.kind === 'pull' ? Math.min(h.length ?? 300, 800) : h.kind === 'closer' ? 60 : h.kind === 'panic' ? 140 : h.kind === 'card-lock' ? 300 : 40;
      withShadow(g, k, () => { g.fillStyle = metalGrad(g, 0, Y(yC + hh / 2), 0, Y(yC - hh / 2), h.metal); rrect(g, X(x0), Y(yC + hh / 2), p * k, hh * k, Math.min(8, p / 3) * k); g.fill(); }, 0.25);
    }
  }
  g.fillStyle = '#5b6168'; g.font = `600 ${Math.max(11, 13 * (b.w / 600))}px "IBM Plex Sans", Arial`;
  g.textAlign = 'left'; g.fillText('OUTSIDE', b.x + 10, b.y + 22);
  g.textAlign = 'right'; g.fillText('INSIDE', b.x + b.w - 10, b.y + 22);
  g.restore();
}

function topView(g: Ctx, s: RenderSpec, b: Box) {
  // plan at handle height, outside at the bottom
  const W = s.soW + 2 * 400, D = Math.max(s.wallT, s.fd) + 2 * (s.leafW[0] + 120);
  const k = Math.min(b.w / W, b.h / D);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const X = (mm: number) => cx + (mm - s.soW / 2) * k, Y = (mm: number) => cy - mm * k; // y = depth, + inside
  g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
  g.fillStyle = '#efece6'; g.fillRect(b.x, b.y, b.w, b.h);
  for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(120,100,80,0.04)'; g.fillRect(b.x + ((i * 73) % b.w), b.y + ((i * 131) % b.h), 2, 2); }
  const wt = s.wallT;
  hatch(g, X(-400), Y(wt / 2), 400 * k, wt * k, 7);
  hatch(g, X(s.soW), Y(wt / 2), 400 * k, wt * k, 7);
  // jambs
  for (const jx of [5, s.soW - 5 - s.fw]) surface(g, s.frame, X(jx), Y(s.fd / 2), s.fw * k, s.fd * k, 5, k);
  // leaves closed, with swing arcs to the push side
  const hingeLeft = s.hingeLeftFromOutside;
  const ax0 = 5 + s.fw, ax1 = s.soW - 5 - s.fw;
  const pushDir = s.pushSide === 'outside' ? -1 : 1; // leaf swings away from the push side
  const leafY = s.pushSide === 'outside' ? -s.fd / 2 + 12 : s.fd / 2 - 12 - s.T;
  const total = s.leafW.reduce((a, c) => a + c, 0) || 1;
  let x = ax0 + 3;
  const ord = hingeLeft ? s.leafW : [...s.leafW].reverse();
  ord.forEach((lw, i) => {
    const w = (lw / total) * (ax1 - ax0 - 6);
    const hL = s.pair ? i === 0 : hingeLeft;
    withShadow(g, k, () => surface(g, s.edge, X(x), Y(leafY + s.T), w * k, s.T * k, 9, k), 0.2);
    const hx = hL ? x : x + w;
    g.strokeStyle = 'rgba(40,90,60,0.6)'; g.setLineDash([6, 5]); g.lineWidth = 1.2;
    g.beginPath();
    const r = w * k;
    const a0 = hL ? 0 : Math.PI, a1 = hL ? -pushDir * Math.PI / 2 : Math.PI + pushDir * Math.PI / 2;
    g.arc(X(hx), Y(pushDir > 0 ? leafY + s.T : leafY), r, Math.min(-a0, -a1), Math.max(-a0, -a1));
    g.stroke(); g.setLineDash([]);
    // handles in plan
    for (const h of s.hardware.filter((q) => ['lever', 'pull', 'panic', 'card-lock'].includes(q.kind))) {
      const p = proj(h), lock = hL ? x + w - s.backset : x + s.backset;
      for (const sd of (h.side === 'both' ? ['outside', 'inside'] : [h.side]) as Side[]) {
        if (sd !== 'outside' && sd !== 'inside') continue;
        const yy = sd === 'outside' ? leafY - p : leafY + s.T;
        const len = h.kind === 'panic' ? w - 150 : h.kind === 'lever' ? 130 : 30;
        const lx0 = h.kind === 'panic' ? x + 75 : hL ? lock - (h.kind === 'lever' ? len : 15) : lock - (h.kind === 'lever' ? 0 : 15);
        g.fillStyle = metalGrad(g, 0, Y(yy + p), 0, Y(yy), h.metal);
        rrect(g, X(lx0), Y(yy + p), len * k, p * k, 6 * k); g.fill();
      }
    }
    x += w + 3;
  });
  g.fillStyle = '#5b6168'; g.font = `600 ${Math.max(11, 13 * (b.w / 900))}px "IBM Plex Sans", Arial`;
  g.textAlign = 'center'; g.fillText('INSIDE', b.x + b.w / 2, b.y + 20); g.fillText('OUTSIDE', b.x + b.w / 2, b.y + b.h - 10);
  g.restore();
}

export function renderView(p: Project, d: Door, kind: ViewKind, canvas: HTMLCanvasElement) {
  const s = renderSpec(p, d);
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const b = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  if (kind === 'front') elevation(g, s, 'outside', b);
  else if (kind === 'back') elevation(g, s, 'inside', b);
  else if (kind === 'side') sideView(g, s, b);
  else topView(g, s, b);
  return s;
}

// ---------- A3 render sheet ----------

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function text(g: Ctx, s: string, x: number, y: number, size: number, weight = 400, color = '#1b1f24', align: CanvasTextAlign = 'left', maxW?: number) {
  g.font = `${weight} ${size}px "IBM Plex Sans", Arial, sans-serif`;
  g.fillStyle = color; g.textAlign = align;
  if (maxW) { let t = s; while (t.length > 3 && g.measureText(t).width > maxW) t = t.slice(0, -2); if (t !== s) t = t.slice(0, -1) + '…'; g.fillText(t, x, y); } else g.fillText(s, x, y);
}

// 420 x 297 mm at `dpmm` pixels per mm.
export async function renderSheet(p: Project, d: Door, canvas: HTMLCanvasElement, dpmm = 6) {
  const W = Math.round(420 * dpmm), H = Math.round(297 * dpmm);
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!;
  const m = (mm: number) => mm * dpmm;
  const s = renderSpec(p, d);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#14181d'; g.lineWidth = m(0.5); g.strokeRect(m(10), m(10), W - m(20), H - m(20));
  // header band
  const hb = g.createLinearGradient(m(10), 0, W - m(10), 0);
  hb.addColorStop(0, '#050d22'); hb.addColorStop(0.6, '#0a1b44'); hb.addColorStop(1, '#0d2560');
  g.fillStyle = hb; g.fillRect(m(10), m(10), W - m(20), m(26));
  const markImg = await loadImage(svgUrl(MARK_SVG.replace('<svg ', '<svg width="96" height="96" ')));
  if (markImg) g.drawImage(markImg, m(14), m(13), m(20), m(20));
  text(g, BRAND, m(38), m(26.5), m(10), 700, '#ffffff');
  text(g, TAGLINE.toUpperCase(), m(38), m(32), m(2.6), 600, '#9cc3f5');
  text(g, p.name || 'Project', W - m(14), m(22), m(5.2), 600, '#ffffff', 'right', m(220));
  text(g, [p.number, p.client, p.location].filter(Boolean).join('  ·  ') || ' ', W - m(14), m(30), m(3), 400, '#c7d9f5', 'right', m(220));
  // views
  const gx = m(14), gy = m(40), gw = m(268), gh = m(205);
  const cells: [ViewKind, Box, string][] = [
    ['front', { x: gx, y: gy, w: m(104), h: m(150) }, 'FRONT - OUTSIDE FACE'],
    ['back', { x: gx + m(108), y: gy, w: m(104), h: m(150) }, 'BACK - INSIDE FACE'],
    ['side', { x: gx + m(216), y: gy, w: m(52), h: m(150) }, 'SIDE - SECTION'],
    ['top', { x: gx, y: gy + m(157), w: gw, h: m(38) }, 'TOP - PLAN AT HANDLE HEIGHT'],
  ];
  for (const [kind, b, label] of cells) {
    const c = document.createElement('canvas');
    c.width = Math.round(b.w); c.height = Math.round(b.h);
    renderView(p, d, kind, c);
    g.drawImage(c, b.x, b.y);
    g.strokeStyle = '#c9ced3'; g.lineWidth = 1; g.strokeRect(b.x, b.y, b.w, b.h);
    text(g, label, b.x, b.y + b.h + m(4.2), m(2.8), 600, '#14181d');
  }
  void gh;
  // right panel: door data and hardware set
  const px = m(288), pw = W - m(10) - px - m(4);
  let y = m(44);
  const rowH = m(5.1);
  const kv = (k2: string, v: string) => { text(g, k2.toUpperCase(), px, y, m(2.1), 600, '#6b747e'); text(g, v || '-', px + m(38), y, m(2.8), 500, '#14181d', 'left', pw - m(38)); y += rowH; };
  text(g, `DOOR ${d.mark}`, px, y, m(6), 700, '#0a1b44'); y += m(4);
  text(g, `${floorName(p, d.floorId)}${d.room ? ' · ' + d.room : ''}`, px, y + m(2.5), m(3), 400, '#4a525c', 'left', pw); y += m(9);
  kv('Type', d.doorType);
  kv('Configuration', `${d.configuration ? CONFIG_LABEL[d.configuration] : ''} ${d.handing}`.trim());
  kv('Structural opening', `${s.soW} x ${s.soH} mm`);
  kv('Leaf', `${s.leafW.map((x) => Math.round(x)).join(' + ')} x ${Math.round(s.leafH)} x ${s.T} mm`);
  kv('Fire / acoustic', `${d.fireRating || '-'} / ${d.acousticRating || '-'}`);
  kv('Leaf', `${d.leafMaterial} ${d.leafCore}`.trim());
  kv('Finish outside', s.face.outside.label);
  kv('Finish inside', s.face.inside.label);
  kv('Frame', `${d.frameMaterial} ${d.frameFinish}`.trim());
  if (s.vision) kv('Vision panel', `${s.vision.w} x ${s.vision.h} ${d.glazingType}`.trim());
  // swatches
  y += m(2);
  const sw = [s.face.outside, s.face.inside, s.frame];
  ['Outside', 'Inside', 'Frame'].forEach((lab, i) => {
    const sx = px + i * m(30);
    surface(g, sw[i], sx, y, m(26), m(12), 99 + i, dpmm / 10, '#8e9aa5');
    g.strokeStyle = '#9aa1a8'; g.strokeRect(sx, y, m(26), m(12));
    text(g, lab, sx, y + m(16), m(2.2), 500, '#4a525c');
  });
  y += m(23);
  const set = setFor(p, d);
  text(g, `HARDWARE SET ${d.hardwareSet || '-'}`, px, y, m(3.4), 700, '#0a1b44'); y += m(2);
  if (set?.description) { text(g, set.description, px, y + m(3.4), m(2.4), 400, '#4a525c', 'left', pw); y += m(4); }
  y += m(4);
  g.fillStyle = '#eef1f5'; g.fillRect(px, y - m(3.6), pw, m(5));
  text(g, 'QTY', px + m(1), y, m(2.1), 600, '#4a525c'); text(g, 'ITEM', px + m(10), y, m(2.1), 600, '#4a525c'); text(g, 'FINISH', px + pw - m(30), y, m(2.1), 600, '#4a525c');
  y += m(4.6);
  const items = set?.items ?? [];
  const maxRows = Math.floor((H - m(62) - y) / m(4.4));
  items.slice(0, maxRows).forEach((it) => {
    const mt = s.hardware.find((h) => h.label === it.item)?.metal;
    if (mt) { g.fillStyle = metalGrad(g, px + pw - m(34), 0, px + pw - m(31), 0, mt); g.beginPath(); g.arc(px + pw - m(32.5), y - m(1), m(1.4), 0, Math.PI * 2); g.fill(); }
    text(g, `${it.qty}${it.basis === 'per-leaf' ? '/lf' : ''}`, px + m(1), y, m(2.4), 500);
    text(g, `${it.item}${it.manufacturer ? ` · ${it.manufacturer}` : ''}${it.model ? ` ${it.model}` : ''}`, px + m(10), y, m(2.4), 400, '#14181d', 'left', pw - m(46));
    text(g, it.finish || '-', px + pw - m(30), y, m(2.4), 400, '#14181d', 'left', m(30));
    g.strokeStyle = '#eceef0'; g.beginPath(); g.moveTo(px, y + m(1.4)); g.lineTo(px + pw, y + m(1.4)); g.stroke();
    y += m(4.4);
  });
  if (items.length > maxRows) text(g, `+ ${items.length - maxRows} more items (see hardware schedule)`, px, y, m(2.3), 400, '#6b747e');
  if (!items.length) text(g, 'No hardware set linked: generic lever and hinges shown.', px, y, m(2.4), 400, '#9a5c00', 'left', pw);
  // title block strip
  const ty = H - m(10) - m(38);
  if (p.titleBlock && p.titleBlock.placement !== 'full') {
    const tb = p.titleBlock;
    const sc = Math.min((W - m(20) - m(4)) / tb.width, m(36) / tb.height);
    const svg = toSvg(tb.entities.map((e) => e), { width: tb.width, height: tb.height, S: 1, background: '#ffffff' });
    const im = await loadImage(svgUrl(svg));
    if (im) g.drawImage(im, m(12), ty + m(1), tb.width * sc, tb.height * sc);
  } else {
    g.strokeStyle = '#14181d'; g.lineWidth = m(0.3); g.strokeRect(m(10), ty, W - m(20), m(38));
    const cols: [string, string][] = [['Project', `${p.name}${p.number ? ` (${p.number})` : ''}`], ['Client', p.client], ['Drawing', `${drawingNumber(p, d)}-R  Door render`], ['Date / rev', `${p.date}  ${d.revision || p.revision}`], ['Status', `${d.status.toUpperCase()} - visualisation, not for construction`]];
    const cw = (W - m(20)) / cols.length;
    cols.forEach(([k2, v], i) => {
      const x = m(10) + i * cw;
      if (i) { g.beginPath(); g.moveTo(x, ty); g.lineTo(x, ty + m(38)); g.stroke(); }
      text(g, k2.toUpperCase(), x + m(3), ty + m(7), m(2.2), 600, '#6b747e');
      text(g, v || '-', x + m(3), ty + m(15), m(3.4), 500, '#14181d', 'left', cw - m(6));
    });
    text(g, `${BRAND} - ${TAGLINE} · ${CREDIT}`, m(13), ty + m(33), m(2.2), 400, '#6b747e');
  }
  // the honest small print
  const note = `Visualisation of the door record and hardware set ${d.hardwareSet || ''}: generic product shapes in the stated finishes, not manufacturer models. Verify against approved submittals.${s.assumptions.length ? ' Assumed: ' + s.assumptions.join('; ') + '.' : ''}`;
  text(g, note, m(14), ty - m(2.2), m(2), 400, '#6b747e', 'left', W - m(28));
  return s;
}
