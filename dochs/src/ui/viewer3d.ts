import type { Door } from '../core/types.js';
import { isSliding } from '../core/types.js';
import { has, num } from '../core/geometry.js';
import { doorParams } from '../cad/door-drawing.js';
import { h } from './dom.js';

// Lightweight 3D door viewer on a 2D canvas (no libraries): boxes and quads
// built from the same parameters as the 2D drawings, painter's-sorted with flat
// shading. A visual model only, not fabrication geometry.
//
// World axes: X along the opening, Y up, Z through the wall (Z = plan y,
// outside face of the wall at Z = 0).

type V3 = [number, number, number];
interface Face { pts: V3[]; color: string; alpha?: number; line?: boolean }

const WOOD: [RegExp, string][] = [
  [/walnut/i, '#6b4a2f'], [/oak|veneer|timber|wood|lacquer|stain/i, '#b98a5a'], [/hpl|laminate/i, '#d9d3c7'],
  [/paint|mdf/i, '#ebe8e2'], [/stainless|pvd/i, '#c3c8cc'], [/anodis|alumin/i, '#b5bcc3'], [/powder|steel/i, '#8d969f'],
  [/stone|marble|honed|polished/i, '#d8d0bf'], [/glass/i, '#9cc7e0'],
];
export function colorFor(name: string, fallback = '#c9c3b8'): string {
  for (const [re, c] of WOOD) if (re.test(name)) return c;
  return fallback;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, colorFront = color, colorBack = color, alpha?: number): Face[] {
  const p = (x: number, y: number, z: number): V3 => [x, y, z];
  return [
    { pts: [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)], color: colorFront, alpha }, // outside face (z0)
    { pts: [p(x0, y0, z1), p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z1)], color: colorBack, alpha }, // inside face (z1)
    { pts: [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)], color, alpha },
    { pts: [p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0)], color, alpha },
    { pts: [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)], color, alpha },
    { pts: [p(x0, y0, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y0, z0)], color, alpha },
  ];
}

const rotY = (q: V3, cx: number, cz: number, deg: number): V3 => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const x = q[0] - cx, z = q[2] - cz;
  return [cx + x * c - z * s, q[1], cz + x * s + z * c];
};

export interface SceneOptions { openFraction: number; exploded: boolean; showWall: boolean }

export function buildScene(d: Door, o: SceneOptions): Face[] {
  const p = doorParams(d);
  const faces: Face[] = [];
  const { W, H, g, fw, wallT, fy0, fy1 } = p;
  const c = d.configuration || 'single';
  const ex = o.exploded ? Math.max(W, H) * 0.12 : 0;
  if (o.showWall) {
    const wall = '#d7dadd';
    faces.push(...box(-350, 0, 0, 0, H + 300, wallT, wall, wall, wall, 0.35), ...box(W, 0, 0, W + 350, H + 300, wallT, wall, wall, wall, 0.35), ...box(0, H, 0, W, H + 300, wallT, wall, wall, wall, 0.35));
  }
  if (p.frameOk) {
    const fc = colorFor(`${d.frameFinish} ${d.frameMaterial}`, '#9aa2aa');
    faces.push(...box(g - ex, 0, fy0, g + fw - ex, H - g, fy1, fc));
    faces.push(...box(W - g - fw + ex, 0, fy0, W - g + ex, H - g, fy1, fc));
    faces.push(...box(g, H - g - fw + ex, fy0, W - g, H - g + ex, fy1, fc));
  }
  const edge = colorFor(d.leafMaterial, '#c9b79c');
  const f1 = colorFor(`${d.finishSide1} ${d.leafFacing}`, edge);
  const f2 = colorFor(`${d.finishSide2} ${d.leafFacing}`, edge);
  const glassLeaf = /glass/i.test(d.leafMaterial);
  const angle = (has(d.openingAngle) ? d.openingAngle : 90) * o.openFraction;
  const n = p.swingIn ? 1 : -1;
  for (const lf of p.leaves) {
    const z0 = p.leafY0, z1 = p.leafY1;
    const lfFaces: Face[] = [];
    const y0 = p.uc, y1 = p.leafTop;
    lfFaces.push(...box(lf.x0, y0, z0, lf.x1, y1, z1, glassLeaf ? '#9cc7e0' : edge, glassLeaf ? '#9cc7e0' : f1, glassLeaf ? '#9cc7e0' : f2, glassLeaf ? 0.45 : undefined));
    const cx = (lf.x0 + lf.x1) / 2;
    if (d.visionPanel && has(d.vpWidth) && has(d.vpHeight) && has(d.vpFromTop) && !glassLeaf) {
      const vy1 = y1 - d.vpFromTop, vy0 = vy1 - d.vpHeight, vx0 = cx - d.vpWidth / 2, vx1 = cx + d.vpWidth / 2;
      for (const z of [z0 - 0.8, z1 + 0.8]) lfFaces.push({ pts: [[vx0, vy0, z], [vx1, vy0, z], [vx1, vy1, z], [vx0, vy1, z]], color: '#8fbedb', alpha: 0.85 });
    }
    if (d.kickPlate && has(d.kickPlateHeight))
      for (const z of [z0 - 0.6, z1 + 0.6]) lfFaces.push({ pts: [[lf.x0 + 20, y0 + 10, z], [lf.x1 - 20, y0 + 10, z], [lf.x1 - 20, y0 + d.kickPlateHeight, z], [lf.x0 + 20, y0 + d.kickPlateHeight, z]], color: '#c3c8cc' });
    // handle / pull at the lock edge, both faces
    const hy = has(d.handleHeight) ? d.handleHeight : null;
    if (hy && lf.hinge) {
      const lx = lf.hinge === 'left' ? lf.x1 - num(d.backset ?? 60) - 20 : lf.x0 + num(d.backset ?? 60) + 20;
      const dir = lf.hinge === 'left' ? -1 : 1;
      for (const [za, zb] of [[z0 - 60, z0], [z1, z1 + 60]] as const) {
        lfFaces.push(...box(lx - 12, hy - 12, za, lx + 12, hy + 12, zb, '#5b6168'));
        const zz = za < z0 ? za : zb - 24;
        lfFaces.push(...box(Math.min(lx, lx + dir * 140), hy - 10, zz, Math.max(lx, lx + dir * 140), hy + 10, zz + 24, '#5b6168'));
      }
    } else if (hy && !lf.hinge) {
      for (const z of [z0 - 1, z1 + 1]) lfFaces.push({ pts: [[cx - 15, hy - 120, z], [cx + 15, hy - 120, z], [cx + 15, hy + 120, z], [cx - 15, hy + 120, z]], color: '#5b6168' });
    }
    // operate the leaf
    let moved = lfFaces;
    if (isSliding(c)) {
      const left = c === 'sliding-double' ? lf === p.leaves[0] : d.handing === 'LH' || d.handing === 'LHR';
      const dx = (lf.x1 - lf.x0) * o.openFraction * (left ? -1 : 1);
      moved = lfFaces.map((f) => ({ ...f, pts: f.pts.map(([x, y, z]) => [x + dx, y, z] as V3) }));
    } else if (lf.hinge && angle) {
      const left = lf.hinge === 'left';
      const u = left ? 1 : -1;
      const hx = left ? lf.x0 : lf.x1;
      const da = c.startsWith('double-action');
      const hz = da ? (z0 + z1) / 2 : p.swingIn ? z1 : z0;
      const px = c === 'pivot' && has(d.pivotOffset) ? hx + u * d.pivotOffset : hx;
      const pz = c === 'pivot' && has(d.pivotOffset) ? (z0 + z1) / 2 : hz;
      const sign = u * n > 0 ? 1 : -1;
      // same rotation as the plan view: (x, plan y) is (X, Z)
      moved = lfFaces.map((f) => ({ ...f, pts: f.pts.map((q) => rotY(q, px, pz, sign * angle)) }));
    }
    if (o.exploded) moved = moved.map((f) => ({ ...f, pts: f.pts.map(([x, y, z]) => [x, y, z - n * ex] as V3) }));
    faces.push(...moved);
  }
  return faces;
}

export interface Camera { yaw: number; pitch: number; zoom: number }

export function render(ctx: CanvasRenderingContext2D, faces: Face[], cam: Camera, w: number, hgt: number, center: V3, size: number) {
  ctx.clearRect(0, 0, w, hgt);
  const cy = Math.cos((cam.yaw * Math.PI) / 180), sy = Math.sin((cam.yaw * Math.PI) / 180);
  const cp = Math.cos((cam.pitch * Math.PI) / 180), sp = Math.sin((cam.pitch * Math.PI) / 180);
  const D = size * 3;
  const scale = (Math.min(w, hgt) / size) * 0.8 * cam.zoom;
  const tf = (q: V3): V3 => {
    const x = q[0] - center[0], y = q[1] - center[1], z = q[2] - center[2];
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const f = D / (D + z2);
    return [w / 2 + x1 * f * scale, hgt / 2 - y2 * f * scale, z2];
  };
  const L: V3 = [0.35, 0.6, -0.72];
  const items = faces.map((f) => {
    const t = f.pts.map(tf);
    const depth = t.reduce((s, q) => s + q[2], 0) / t.length;
    // shade from the world-space normal so lighting turns with the model
    const [a, b, c2] = f.pts;
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: V3 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    const k = 0.62 + 0.38 * Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / len);
    return { t, depth, f, k };
  }).sort((p, q) => q.depth - p.depth);
  for (const it of items) {
    ctx.beginPath();
    it.t.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.globalAlpha = it.f.alpha ?? 1;
    ctx.fillStyle = shade(it.f.color, it.k);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, (it.f.alpha ?? 1) + 0.2);
    ctx.strokeStyle = 'rgba(20,24,29,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Interactive viewer element. State persists per page load.
const views = new Map<string, { cam: Camera; open: number; exploded: boolean; wall: boolean }>();

export function viewer3d(d: Door, key = 'main', height = 460): HTMLElement {
  const s = views.get(key) ?? { cam: { yaw: -28, pitch: 14, zoom: 1 }, open: 0.35, exploded: false, wall: true };
  views.set(key, s);
  const canvas = h('canvas', { class: 'v3d-canvas', 'aria-label': `3D model of door ${d.mark}` }) as HTMLCanvasElement;
  const p = doorParams(d);
  const center: V3 = [p.W / 2, p.H / 2, p.wallT / 2];
  const size = Math.max(p.W + 700, p.H + 300);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, hh = canvas.clientHeight || height;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, buildScene(d, { openFraction: s.open, exploded: s.exploded, showWall: s.wall }), s.cam, w, hh, center, size);
  };
  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: s.cam.yaw, pitch: s.cam.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    s.cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.4;
    s.cam.pitch = Math.max(-80, Math.min(80, drag.pitch + (e.clientY - drag.y) * 0.3));
    draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); s.cam.zoom = Math.max(0.3, Math.min(4, s.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); draw(); }, { passive: false });
  const preset = (yaw: number, pitch: number) => () => { s.cam = { ...s.cam, yaw, pitch }; draw(); };
  const slider = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.open * 100), 'aria-label': 'Open the door', oninput: (e: Event) => { s.open = Number((e.target as HTMLInputElement).value) / 100; draw(); } });
  const el = h('div', { class: 'v3d' },
    h('div', { class: 'v3d-bar' },
      h('button', { class: 'btn sm', onclick: preset(0, 0) }, 'Outside'),
      h('button', { class: 'btn sm', onclick: preset(180, 0) }, 'Inside'),
      h('button', { class: 'btn sm', onclick: preset(-28, 14) }, '3D view'),
      h('button', { class: 'btn sm', onclick: preset(0, 89) }, 'Top'),
      h('label', { class: 'v3d-open' }, 'Open', slider),
      h('label', { class: 'layer' }, h('input', { type: 'checkbox', checked: s.exploded, onchange: (e: Event) => { s.exploded = (e.target as HTMLInputElement).checked; draw(); } }), 'Exploded'),
      h('label', { class: 'layer' }, h('input', { type: 'checkbox', checked: s.wall, onchange: (e: Event) => { s.wall = (e.target as HTMLInputElement).checked; draw(); } }), 'Wall')),
    canvas,
    h('p', { class: 'muted small' }, 'Visual model from the door record (drag to rotate, wheel to zoom). Simplified: not fabrication geometry.'));
  canvas.style.height = `${height}px`;
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(canvas);
  return el;
}
