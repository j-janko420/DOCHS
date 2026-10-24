import type { TbPlacement, TitleBlock } from '../core/types.js';
import type { PdfVector } from '../core/pdf-read.js';
import type { DxfRead } from './dxf-read.js';
import type { Entity, Pt } from './entities.js';
import { bbox } from './entities.js';

// Company title blocks: normalise a PDF page / DXF / image to mm at the origin,
// choose how it sits on the sheet, and fill {PLACEHOLDER} text with sheet data.

const MM = 25.4 / 72;
const r2 = (v: number) => Math.round(v * 100) / 100;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Drops points closer than 0.05 mm and collinear middle points (keeps files small).
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q: Pt = [r2(p[0]), r2(p[1])];
    const a = out[out.length - 1];
    if (a && Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.05) continue;
    const b = out[out.length - 2];
    if (a && b && Math.abs((a[0] - b[0]) * (q[1] - b[1]) - (a[1] - b[1]) * (q[0] - b[0])) < 1e-3) out[out.length - 1] = q;
    else out.push(q);
  }
  return out;
}

export function defaultPlacement(w: number, h: number): TbPlacement {
  const r = w / h;
  return r >= 3.2 ? 'bottom' : r <= 0.55 ? 'right' : 'full';
}

// A full-sheet frame usually carries its title strip along the right or bottom
// edge: find a long rule line there and keep that strip clear of drawings.
export function detectStrips(es: Entity[], w: number, h: number): { right: number; bottom: number } {
  // rule lines are often drawn in pieces: add up collinear vertical / horizontal runs
  const vx = new Map<number, number>(), hy = new Map<number, number>();
  const seg = (a: Pt, b: Pt) => {
    if (Math.abs(a[0] - b[0]) < 0.2) { const k = Math.round(a[0] * 2) / 2; vx.set(k, (vx.get(k) ?? 0) + Math.abs(a[1] - b[1])); }
    if (Math.abs(a[1] - b[1]) < 0.2) { const k = Math.round(a[1] * 2) / 2; hy.set(k, (hy.get(k) ?? 0) + Math.abs(a[0] - b[0])); }
  };
  for (const e of es) {
    if (e.t === 'line') seg(e.a, e.b);
    else if (e.t === 'poly') for (let i = 1; i < e.pts.length + (e.closed ? 1 : 0); i++) seg(e.pts[i - 1], e.pts[i % e.pts.length]);
  }
  let right = 0, bottom = 0;
  for (const [x, len] of vx) if (len > h * 0.6 && x > w * 0.55 && x < w * 0.95) right = Math.max(right, w - x);
  // bottom strip: the long rule nearest the bottom edge (above the frame border)
  for (const [y, len] of hy) if (len > w * 0.6 && y > h * 0.05 && y < h * 0.4) bottom = bottom ? Math.min(bottom, y) : y;
  return { right: r2(right), bottom: r2(bottom) };
}

function finish(name: string, source: TitleBlock['source'], entities: Entity[], notes: string[]): TitleBlock {
  const box = bbox(entities);
  const w = box.x1 - box.x0 || 1, h = box.y1 - box.y0 || 1;
  const moved = entities.map((e) => shift(e, -box.x0, -box.y0));
  const placement = defaultPlacement(w, h);
  const strips = placement === 'full' ? detectStrips(moved, w, h) : { right: 0, bottom: 0 };
  return { name, source, width: r2(w), height: r2(h), entities: moved, placement, reserveRight: strips.right, reserveBottom: strips.bottom, notes };
}

function shift(e: Entity, dx: number, dy: number): Entity {
  const m = (p: Pt): Pt => [r2(p[0] + dx), r2(p[1] + dy)];
  switch (e.t) {
    case 'line': return { ...e, a: m(e.a), b: m(e.b) };
    case 'poly': return { ...e, pts: e.pts.map(m) };
    case 'arc': case 'circle': return { ...e, c: m(e.c) };
    case 'text': return { ...e, p: m(e.p) };
    case 'image': return { ...e, p: m(e.p) };
    default: return e;
  }
}

export function tbFromPdf(v: PdfVector, name: string, jpegDataUrl?: (bytes: Uint8Array) => string): TitleBlock {
  const es: Entity[] = [];
  for (const p of v.paths) {
    const pts = simplify(p.pts.map(([x, y]) => [x * MM, y * MM] as Pt));
    if (pts.length > 1) es.push({ t: 'poly', layer: 'A-TITLE', closed: p.closed, pts });
  }
  for (const t of v.texts) es.push({ t: 'text', layer: 'A-TEXT', p: [r2(t.x * MM), r2(t.y * MM)], h: r2(t.size * MM * 0.718), s: t.s, align: 'left', rot: Math.abs(t.rot) > 0.5 ? Math.round(t.rot * 10) / 10 : undefined });
  for (const im of v.images) es.push({ t: 'image', layer: 'A-TITLE', p: [r2(im.x * MM), r2(im.y * MM)], w: r2(im.w * MM), h: r2(im.h * MM), src: jpegDataUrl ? jpegDataUrl(im.jpeg) : `data:image/jpeg;base64,${b64(im.jpeg)}` });
  // the page itself is the frame: keep its outline so the sheet size is the page size
  es.push({ t: 'poly', layer: 'A-SHEET', closed: true, pts: [[0, 0], [r2(v.width * MM), 0], [r2(v.width * MM), r2(v.height * MM)], [0, r2(v.height * MM)]] });
  const notes = [`PDF page ${r2(v.width * MM)} x ${r2(v.height * MM)} mm: ${v.paths.length} paths, ${v.texts.length} texts, ${v.images.length} JPEG image(s) kept as vector / image.`];
  if (v.truncated) notes.push('Very complex page: only the first 40,000 paths were kept.');
  const tb = finish(name, 'pdf', es, notes);
  // a full PDF page has no blank margin: keep its own size
  return tb;
}

export function tbFromDxf(r: DxfRead, name: string): TitleBlock {
  const notes = [`DXF: ${r.entities.length} entities (units ${r.units}).`];
  const sk = Object.entries(r.skipped).filter(([k]) => k !== 'DIMENSION');
  if (sk.length) notes.push(`Not shown: ${sk.map(([k, n]) => `${n} ${k}`).join(', ')}.`);
  return finish(name, 'dxf', r.entities.map((e) => ({ ...e, layer: 'A-TITLE' }) as Entity), notes);
}

export function tbFromImage(src: string, wPx: number, hPx: number, name: string): TitleBlock {
  const w = 420, h = r2((420 * hPx) / wPx);
  return finish(name, 'image', [{ t: 'image', layer: 'A-TITLE', p: [0, 0], w, h, src }], [`Image ${wPx} x ${hPx} px. Shown in the preview and PDF; DXF keeps its frame only (R12 has no images).`]);
}

export interface TbFrame {
  s: number; // title block mm -> paper mm
  x: number; y: number; // paper mm, bottom-left of the placed title block
  area: { x0: number; y0: number; x1: number; y1: number }; // free drawing area, paper mm
  ownBorder: boolean;
}

export function tbFrame(tb: TitleBlock, PW: number, PH: number, M: number): TbFrame {
  const w = tb.width, h = tb.height;
  if (tb.placement === 'bottom') {
    let s = (PW - 2 * M) / w;
    if (h * s > PH * 0.4) s = (PH * 0.4) / h;
    const tw = w * s, th = h * s;
    return { s, x: M + (PW - 2 * M - tw) / 2, y: M, area: { x0: M, y0: M + th, x1: PW - M, y1: PH - M }, ownBorder: true };
  }
  if (tb.placement === 'right') {
    let s = (PH - 2 * M) / h;
    if (w * s > PW * 0.35) s = (PW * 0.35) / w;
    const tw = w * s, th = h * s;
    return { s, x: PW - M - tw, y: M + (PH - 2 * M - th) / 2, area: { x0: M, y0: M, x1: PW - M - tw, y1: PH - M }, ownBorder: true };
  }
  const s = Math.min(PW / w, PH / h);
  const x = (PW - w * s) / 2, y = (PH - h * s) / 2;
  const inset = Math.max(M, 12);
  return { s, x, y, area: { x0: x + inset, y0: y + inset + tb.reserveBottom * s, x1: x + w * s - inset - tb.reserveRight * s, y1: y + h * s - inset }, ownBorder: false };
}

export const TB_TOKENS = ['PROJECT', 'PROJECT_NO', 'CLIENT', 'CONSULTANT', 'LOCATION', 'DRAWING_NO', 'DRAWING_TITLE', 'DOOR', 'SCALE', 'DATE', 'REV', 'STATUS', 'DRAWN', 'CHECKED', 'APPROVED', 'SHEET_SIZE'] as const;
export type TbValues = Partial<Record<(typeof TB_TOKENS)[number], string>>;

export function hasTokens(tb: TitleBlock): boolean {
  return tb.entities.some((e) => e.t === 'text' && /\{[A-Z_]+\}/.test(e.s));
}

export function fillTokens(s: string, v: TbValues): string {
  return s.replace(/\{([A-Z_]+)\}/g, (m, k: string) => (k in v ? v[k as keyof TbValues] ?? '' : m));
}
