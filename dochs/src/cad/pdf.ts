import type { Entity, Pt } from './entities.js';
import { LAYERS, dimGeometry } from './entities.js';

// Vector PDF writer (no dependencies) for drawing sheets: the same model-space
// entities as the DXF and the SVG preview, at true paper size, Helvetica text,
// layer colours / line weights / linetypes, JPEG images (title-block logos,
// render sheets). One page per sheet.

export interface PdfPageSpec {
  entities: Entity[];
  paper: [number, number]; // mm
  S: number; // model units per paper mm
  hiddenLayers?: Set<string>;
  mono?: boolean; // black linework (print)
}

const PT = 72 / 25.4;

// Helvetica advance widths (1/1000 em), ASCII 32..126 (Adobe AFM)
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; }
  return (w / 1000) * size;
}

function winAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const code = WIN[ch] ?? (c >= 32 && c <= 255 && !(c >= 127 && c < 160) ? c : 63);
    const b = String.fromCharCode(code);
    out += b === '(' || b === ')' || b === '\\' ? '\\' + b : code > 126 ? '\\' + code.toString(8).padStart(3, '0') : b;
  }
  return out;
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
};

export function jpegInfo(b: Uint8Array): { w: number; h: number; comps: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
    i += 2 + len;
  }
  return null;
}

export function dataUrlBytes(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// cubic Bezier segments for an arc (radians, CCW)
function arcPath(c: Pt, r: number, a0: number, a1: number, P: (p: Pt) => string, move: boolean): string {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const segs = Math.ceil(sweep / (Math.PI / 2));
  const d = sweep / segs, k = (4 / 3) * Math.tan(d / 4);
  let out = move ? `${P([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)])} m\n` : '';
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + i * d, t1 = t0 + d;
    const p1: Pt = [c[0] + r * (Math.cos(t0) - k * Math.sin(t0)), c[1] + r * (Math.sin(t0) + k * Math.cos(t0))];
    const p2: Pt = [c[0] + r * (Math.cos(t1) + k * Math.sin(t1)), c[1] + r * (Math.sin(t1) - k * Math.cos(t1))];
    const p3: Pt = [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)];
    out += `${P(p1)} ${P(p2)} ${P(p3)} c\n`;
  }
  return out;
}

const DASH: Record<string, number[]> = { CONTINUOUS: [], DASHED: [6, 3], HIDDEN: [3, 1.5], CENTER: [12, 3, 3, 3] };

interface Img { name: string; bytes: Uint8Array; w: number; h: number; comps: number }

function pageContent(pg: PdfPageSpec, imgs: Img[], cache: Map<string, Img>): string {
  const k = PT / pg.S; // model units -> pt
  const P = (p: Pt) => `${n(p[0] * k)} ${n(p[1] * k)}`;
  let out = '1 J 1 j\n';
  const byLayer = new Map<string, Entity[]>();
  for (const e of pg.entities) {
    if (pg.hiddenLayers?.has(e.layer)) continue;
    if (!byLayer.has(e.layer)) byLayer.set(e.layer, []);
    byLayer.get(e.layer)!.push(e);
  }
  for (const L of LAYERS) {
    const es = byLayer.get(L.name);
    if (!es) continue;
    const [r, g, b] = pg.mono && L.name !== 'A-HATCH' ? [0, 0, 0] : hex(L.svg);
    const col = `${n(r)} ${n(g)} ${n(b)}`;
    // images first (under the linework)
    for (const e of es) if (e.t === 'image') {
      let im = cache.get(e.src);
      if (!im) {
        const bytes = dataUrlBytes(e.src);
        const info = jpegInfo(bytes);
        if (!info) continue;
        im = { name: `Im${cache.size + 1}`, bytes, ...info };
        cache.set(e.src, im);
        imgs.push(im);
      }
      out += `q ${n(e.w * k)} 0 0 ${n(e.h * k)} ${n(e.p[0] * k)} ${n(e.p[1] * k)} cm /${im.name} Do Q\n`;
    }
    out += `q ${col} RG ${col} rg ${n(L.weight * PT)} w [${DASH[L.ltype].map((x) => n(x * PT)).join(' ')}] 0 d\n`;
    let path = '';
    for (const e of es) {
      switch (e.t) {
        case 'line': path += `${P(e.a)} m ${P(e.b)} l\n`; break;
        case 'poly': path += e.pts.map((p, i) => `${P(p)} ${i ? 'l' : 'm'}`).join(' ') + (e.closed ? ' h\n' : '\n'); break;
        case 'circle': path += arcPath(e.c, e.r, 0, Math.PI * 2, P, true) + 'h\n'; break;
        case 'arc': path += arcPath(e.c, e.r, (e.a0 * Math.PI) / 180, (e.a1 * Math.PI) / 180, P, true); break;
        case 'dim': for (const [a, bb] of dimGeometry(e).lines) path += `${P(a)} m ${P(bb)} l\n`; break;
      }
    }
    if (path) out += path + 'S\n';
    // text in solid lines
    out += '[] 0 d\n';
    const text = (p: Pt, h: number, s: string, align?: string, valign?: string, rot?: number) => {
      // DXF / SVG text height = cap height; Helvetica cap height is 0.718 em
      const size = (h / 0.718) * k;
      const w = textWidth(s, size);
      const dx = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
      const dy = valign === 'middle' ? -h * k / 2 : valign === 'top' ? -h * k : 0;
      const a = ((rot ?? 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      const x = p[0] * k + dx * c - dy * sn, y = p[1] * k + dx * sn + dy * c;
      out += `BT /F1 ${n(size)} Tf ${n(c)} ${n(sn)} ${n(-sn)} ${n(c)} ${n(x)} ${n(y)} Tm (${winAnsi(s)}) Tj ET\n`;
    };
    for (const e of es) {
      if (e.t === 'text') text(e.p, e.h, e.s, e.align, e.valign, e.rot);
      else if (e.t === 'dim') { const g2 = dimGeometry(e); text(g2.textPos, e.h, g2.text, 'center', 'base', g2.textRot); }
    }
    out += 'Q\n';
  }
  return out;
}

const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };

export function toPdf(pages: PdfPageSpec[], meta: { title?: string; author?: string } = {}): Uint8Array {
  const imgs: Img[] = [];
  const cache = new Map<string, Img>();
  const contents = pages.map((pg) => pageContent(pg, imgs, cache));
  const objs: (string | Uint8Array)[][] = [];
  const add = (...parts: (string | Uint8Array)[]) => { objs.push(parts); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const imgIds = imgs.map((im) => add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? 'DeviceGray' : im.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode${im.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream'));
  const xobj = imgs.length ? ` /XObject << ${imgs.map((im, i) => `/${im.name} ${imgIds[i]} 0 R`).join(' ')} >>` : '';
  const pageIds: number[] = [];
  pages.forEach((pg, i) => {
    const c = latin1(contents[i]);
    const cid = add(`<< /Length ${c.length} >>\nstream\n`, c, '\nendstream');
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(pg.paper[0] * PT)} ${n(pg.paper[1] * PT)}] /Resources << /Font << /F1 ${font} 0 R >>${xobj} >> /Contents ${cid} 0 R >>`));
  });
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`];
  objs[pagesObj - 1] = [`<< /Type /Pages /Kids [${pageIds.map((x) => `${x} 0 R`).join(' ')}] /Count ${pageIds.length} >>`];
  const esc = (s: string) => winAnsi(s);
  const info = add(`<< /Title (${esc(meta.title ?? 'DORSCH drawing')}) /Author (${esc(meta.author ?? '')}) /Producer (DORSCH - Door Schedule Solutions) /Creator (DORSCH) >>`);
  const chunks: Uint8Array[] = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let off = chunks[0].length;
  const xref: number[] = [];
  objs.forEach((parts, i) => {
    xref.push(off);
    const head = latin1(`${i + 1} 0 obj\n`);
    chunks.push(head); off += head.length;
    for (const p of parts) { const b = typeof p === 'string' ? latin1(p) : p; chunks.push(b); off += b.length; }
    const tail = latin1('\nendobj\n');
    chunks.push(tail); off += tail.length;
  });
  const xr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  chunks.push(latin1(xr));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
