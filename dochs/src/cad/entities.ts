// CAD entity model shared by the DXF writer and the SVG preview, so the preview
// and the exported file are the same geometry.
//
// View-local entities: geometry in real millimetres; text heights, dimension
// offsets, label offsets and hatch spacing in *paper* millimetres. `place()`
// converts a view into sheet model space (1 paper mm = S model units).

export type Pt = [number, number];

export interface LayerDef {
  name: string;
  color: number; // AutoCAD Color Index
  ltype: 'CONTINUOUS' | 'DASHED' | 'HIDDEN' | 'CENTER';
  weight: number; // paper mm, preview only
  svg: string;
}

export const LAYERS: LayerDef[] = [
  { name: 'A-WALL', color: 8, ltype: 'CONTINUOUS', weight: 0.35, svg: '#3d434a' },
  { name: 'A-HATCH', color: 9, ltype: 'CONTINUOUS', weight: 0.09, svg: '#9aa1a8' },
  { name: 'A-FRAME', color: 4, ltype: 'CONTINUOUS', weight: 0.35, svg: '#0b6e86' },
  { name: 'A-DOOR', color: 7, ltype: 'CONTINUOUS', weight: 0.5, svg: '#14181d' },
  { name: 'A-GLAZ', color: 5, ltype: 'CONTINUOUS', weight: 0.25, svg: '#2453d6' },
  { name: 'A-HDWR', color: 6, ltype: 'CONTINUOUS', weight: 0.25, svg: '#9c2fb3' },
  { name: 'A-SWING', color: 3, ltype: 'DASHED', weight: 0.18, svg: '#2c8a4b' },
  { name: 'A-HIDDEN', color: 8, ltype: 'HIDDEN', weight: 0.18, svg: '#6b737b' },
  { name: 'A-CENTER', color: 1, ltype: 'CENTER', weight: 0.13, svg: '#c62f2f' },
  { name: 'A-DIMS', color: 3, ltype: 'CONTINUOUS', weight: 0.13, svg: '#1d7a4a' },
  { name: 'A-TEXT', color: 7, ltype: 'CONTINUOUS', weight: 0.18, svg: '#14181d' },
  { name: 'A-SHEET', color: 7, ltype: 'CONTINUOUS', weight: 0.5, svg: '#14181d' },
  { name: 'A-TITLE', color: 7, ltype: 'CONTINUOUS', weight: 0.25, svg: '#14181d' },
];

export type Layer = (typeof LAYERS)[number]['name'];

export type Entity =
  | { t: 'line'; layer: Layer; a: Pt; b: Pt }
  | { t: 'poly'; layer: Layer; pts: Pt[]; closed: boolean }
  | { t: 'arc'; layer: Layer; c: Pt; r: number; a0: number; a1: number } // degrees, CCW a0 -> a1
  | { t: 'circle'; layer: Layer; c: Pt; r: number }
  | { t: 'text'; layer: Layer; p: Pt; h: number; s: string; align?: 'left' | 'center' | 'right'; valign?: 'base' | 'middle' | 'top'; rot?: number; dp?: Pt }
  | { t: 'dim'; layer: Layer; a: Pt; b: Pt; dir: 'h' | 'v'; off: number; h: number; value: number }
  | { t: 'hatch'; layer: Layer; x0: number; y0: number; x1: number; y1: number; spacing: number }
  | { t: 'image'; layer: Layer; p: Pt; w: number; h: number; src: string }; // p = bottom-left; src = JPEG data URL

export interface View {
  key: string;
  title: string;
  scale: number; // 1:scale
  entities: Entity[];
  kind: 'main' | 'detail';
}

const tp = (p: Pt, f: number, dx: number, dy: number): Pt => [p[0] * f + dx, p[1] * f + dy];

// Transform view-local entities to model space: f = S / viewScale, k = S.
export function place(es: Entity[], f: number, k: number, dx: number, dy: number): Entity[] {
  const out: Entity[] = [];
  for (const e of es) {
    switch (e.t) {
      case 'line': out.push({ ...e, a: tp(e.a, f, dx, dy), b: tp(e.b, f, dx, dy) }); break;
      case 'poly': out.push({ ...e, pts: e.pts.map((p) => tp(p, f, dx, dy)) }); break;
      case 'arc': out.push({ ...e, c: tp(e.c, f, dx, dy), r: e.r * f }); break;
      case 'circle': out.push({ ...e, c: tp(e.c, f, dx, dy), r: e.r * f }); break;
      case 'text': {
        const p = tp(e.p, f, dx, dy);
        const d = e.dp ?? [0, 0];
        out.push({ ...e, p: [p[0] + d[0] * k, p[1] + d[1] * k], h: e.h * k, dp: undefined });
        break;
      }
      case 'dim': out.push({ ...e, a: tp(e.a, f, dx, dy), b: tp(e.b, f, dx, dy), off: e.off * k, h: e.h * k }); break;
      case 'image': out.push({ ...e, p: tp(e.p, f, dx, dy), w: e.w * f, h: e.h * f }); break;
      case 'hatch': {
        const [x0, y0] = tp([e.x0, e.y0], f, dx, dy);
        const [x1, y1] = tp([e.x1, e.y1], f, dx, dy);
        out.push(...hatchLines(e.layer, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), e.spacing * k));
        break;
      }
    }
  }
  return out;
}

// 45 degree hatch lines clipped to a rectangle.
export function hatchLines(layer: Layer, x0: number, y0: number, x1: number, y1: number, sp: number): Entity[] {
  const out: Entity[] = [];
  if (sp <= 0 || x1 <= x0 || y1 <= y0) return out;
  // lines y = x + c; c ranges from y0 - x1 to y1 - x0
  const start = Math.ceil((y0 - x1) / sp) * sp;
  for (let c = start; c <= y1 - x0; c += sp) {
    const pts: Pt[] = [];
    const add = (x: number, y: number) => { if (x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9) pts.push([x, y]); };
    add(x0, x0 + c); add(x1, x1 + c); add(y0 - c, y0); add(y1 - c, y1);
    pts.sort((p, q) => p[0] - q[0]);
    if (pts.length >= 2) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) out.push({ t: 'line', layer, a, b });
    }
  }
  return out;
}

export interface DimGeometry {
  lines: [Pt, Pt][];
  textPos: Pt;
  textRot: number;
  defPoint: Pt;
  text: string;
}

export function fmtLen(v: number): string {
  return String(Math.round(v * 10) / 10);
}

// Model-space dimension graphics: extension lines, dimension line, oblique ticks, text.
export function dimGeometry(e: Extract<Entity, { t: 'dim' }>): DimGeometry {
  const s = Math.sign(e.off) || 1;
  const exo = e.h * 0.4, exe = e.h * 0.6, tk = e.h * 0.5;
  const lines: [Pt, Pt][] = [];
  if (e.dir === 'h') {
    const base = s > 0 ? Math.max(e.a[1], e.b[1]) : Math.min(e.a[1], e.b[1]);
    const y = base + e.off;
    const [xa, xb] = [Math.min(e.a[0], e.b[0]), Math.max(e.a[0], e.b[0])];
    const pa = e.a[0] <= e.b[0] ? e.a : e.b, pb = e.a[0] <= e.b[0] ? e.b : e.a;
    lines.push([[xa, pa[1] + s * exo], [xa, y + s * exe]]);
    lines.push([[xb, pb[1] + s * exo], [xb, y + s * exe]]);
    lines.push([[xa - tk, y], [xb + tk, y]]);
    lines.push([[xa - tk, y - tk], [xa + tk, y + tk]]);
    lines.push([[xb - tk, y - tk], [xb + tk, y + tk]]);
    return { lines, textPos: [(xa + xb) / 2, y + e.h * 0.4], textRot: 0, defPoint: [xb, y], text: fmtLen(e.value) };
  }
  const base = s > 0 ? Math.max(e.a[0], e.b[0]) : Math.min(e.a[0], e.b[0]);
  const x = base + e.off;
  const [ya, yb] = [Math.min(e.a[1], e.b[1]), Math.max(e.a[1], e.b[1])];
  const pa = e.a[1] <= e.b[1] ? e.a : e.b, pb = e.a[1] <= e.b[1] ? e.b : e.a;
  lines.push([[pa[0] + s * exo, ya], [x + s * exe, ya]]);
  lines.push([[pb[0] + s * exo, yb], [x + s * exe, yb]]);
  lines.push([[x, ya - tk], [x, yb + tk]]);
  lines.push([[x - tk, ya - tk], [x + tk, ya + tk]]);
  lines.push([[x - tk, yb - tk], [x + tk, yb + tk]]);
  return { lines, textPos: [x - e.h * 0.4, (ya + yb) / 2], textRot: 90, defPoint: [x, yb], text: fmtLen(e.value) };
}

export interface BBox { x0: number; y0: number; x1: number; y1: number }

export function bbox(es: Entity[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Pt) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const e of es) {
    switch (e.t) {
      case 'line': add(e.a); add(e.b); break;
      case 'poly': e.pts.forEach(add); break;
      case 'arc': case 'circle': add([e.c[0] - e.r, e.c[1] - e.r]); add([e.c[0] + e.r, e.c[1] + e.r]); break;
      case 'text': {
        const w = e.s.length * e.h * 0.75;
        const xs = e.align === 'center' ? e.p[0] - w / 2 : e.align === 'right' ? e.p[0] - w : e.p[0];
        if (e.rot === 90) { add([e.p[0] - e.h, e.p[1] - w]); add([e.p[0] + e.h, e.p[1] + w]); }
        else { add([xs, e.p[1] - e.h * 0.5]); add([xs + w, e.p[1] + e.h]); }
        break;
      }
      case 'dim': {
        const g = dimGeometry(e);
        g.lines.forEach(([a, b]) => { add(a); add(b); });
        add([g.textPos[0] - e.h * 1.2, g.textPos[1] - e.h * 1.2]); add([g.textPos[0] + e.h * 1.2, g.textPos[1] + e.h * 1.2]);
        break;
      }
      case 'hatch': add([e.x0, e.y0]); add([e.x1, e.y1]); break;
      case 'image': add(e.p); add([e.p[0] + e.w, e.p[1] + e.h]); break;
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}
