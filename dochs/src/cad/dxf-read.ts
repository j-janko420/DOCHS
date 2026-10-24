import type { Entity, Pt } from './entities.js';

// DXF reader for title blocks and layout drawings: lines, polylines (incl.
// bulges flattened), arcs, circles, TEXT / MTEXT, block INSERTs with their
// ATTRIB values. Output is our Entity model on one layer plus all text found.
// DWG is a closed binary format and is not read here: see dwgVersion().

export interface DxfRead {
  entities: Entity[];
  texts: { s: string; p: Pt; h: number }[];
  extents: { x0: number; y0: number; x1: number; y1: number } | null;
  units: string;
  skipped: Record<string, number>;
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) { i--; continue; }
    out.push([code, lines[i + 1]]);
  }
  return out;
}

interface RawEnt { type: string; g: Pair[] }

function split(ps: Pair[]): RawEnt[] {
  const out: RawEnt[] = [];
  let cur: RawEnt | null = null;
  for (const p of ps) {
    if (p[0] === 0) { cur = { type: p[1].trim(), g: [] }; out.push(cur); } else if (cur) cur.g.push(p);
  }
  return out;
}

const num = (e: RawEnt, c: number, d = 0) => { const p = e.g.find((x) => x[0] === c); return p ? Number(p[1]) : d; };
const str = (e: RawEnt, c: number) => e.g.find((x) => x[0] === c)?.[1] ?? '';

export function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n').replace(/\\[~]/g, ' ')
    .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;^#/]*)[\^#/]([^;]*);/g, '$1/$2')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '')
    .replace(/[{}]/g, '').trim();
}

const INS_UNITS: Record<number, string> = { 0: 'unitless', 1: 'inches', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'm' };

type Xf = (p: Pt) => Pt;

export function readDxf(text: string, layer: Entity['layer'] = 'A-TITLE'): DxfRead {
  const ps = pairs(text);
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 0 && ps[i][1].trim() === 'SECTION' && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1][1].trim();
      let j = i + 2;
      while (j < ps.length && !(ps[j][0] === 0 && ps[j][1].trim() === 'ENDSEC')) j++;
      sections.set(name, ps.slice(i + 2, j));
      i = j;
    }
  }
  const header = sections.get('HEADER') ?? [];
  let units = 'unitless';
  const iu = header.findIndex((p) => p[0] === 9 && p[1].trim() === '$INSUNITS');
  if (iu >= 0) units = INS_UNITS[Number(header[iu + 1]?.[1])] ?? 'unitless';

  // blocks
  const blocks = new Map<string, { base: Pt; ents: RawEnt[] }>();
  let curBlock: { name: string; base: Pt; ents: RawEnt[] } | null = null;
  for (const e of split(sections.get('BLOCKS') ?? [])) {
    if (e.type === 'BLOCK') curBlock = { name: str(e, 2).trim(), base: [num(e, 10), num(e, 20)], ents: [] };
    else if (e.type === 'ENDBLK') { if (curBlock) blocks.set(curBlock.name, curBlock); curBlock = null; } else curBlock?.ents.push(e);
  }

  const entities: Entity[] = [];
  const texts: DxfRead['texts'] = [];
  const skipped: Record<string, number> = {};

  const emit = (raws: RawEnt[], xf: Xf, sc: number, rotDeg: number, depth: number) => {
    for (let i = 0; i < raws.length; i++) {
      const e = raws[i];
      switch (e.type) {
        case 'LINE': entities.push({ t: 'line', layer, a: xf([num(e, 10), num(e, 20)]), b: xf([num(e, 11), num(e, 21)]) }); break;
        case 'LWPOLYLINE': {
          const pts: Pt[] = [], bul: number[] = [];
          for (const g of e.g) {
            if (g[0] === 10) { pts.push([Number(g[1]), 0]); bul.push(0); } else if (g[0] === 20 && pts.length) pts[pts.length - 1][1] = Number(g[1]);
            else if (g[0] === 42 && bul.length) bul[bul.length - 1] = Number(g[1]);
          }
          const closed = (num(e, 70) & 1) === 1;
          entities.push({ t: 'poly', layer, closed, pts: flatten(pts, bul, closed).map(xf) });
          break;
        }
        case 'POLYLINE': {
          const pts: Pt[] = [], bul: number[] = [];
          const closed = (num(e, 70) & 1) === 1;
          let j = i + 1;
          for (; j < raws.length && raws[j].type === 'VERTEX'; j++) { pts.push([num(raws[j], 10), num(raws[j], 20)]); bul.push(num(raws[j], 42)); }
          if (raws[j]?.type === 'SEQEND') j++;
          i = j - 1;
          if (pts.length > 1) entities.push({ t: 'poly', layer, closed, pts: flatten(pts, bul, closed).map(xf) });
          break;
        }
        case 'CIRCLE': entities.push({ t: 'circle', layer, c: xf([num(e, 10), num(e, 20)]), r: num(e, 40) * sc }); break;
        case 'ARC': entities.push({ t: 'arc', layer, c: xf([num(e, 10), num(e, 20)]), r: num(e, 40) * sc, a0: num(e, 50) + rotDeg, a1: num(e, 51) + rotDeg }); break;
        case 'TEXT': case 'ATTRIB': case 'MTEXT': {
          const s = e.type === 'MTEXT' ? cleanMText(e.g.filter((g) => g[0] === 3).map((g) => g[1]).join('') + str(e, 1)) : cleanMText(str(e, 1));
          if (!s) break;
          if (e.type === 'ATTRIB' && (num(e, 70) & 1)) break; // invisible attribute
          const h = num(e, 40, 2.5) * sc;
          const ha = num(e, 72), hasAlign = e.g.some((g) => g[0] === 11) && (ha !== 0 || num(e, 73) !== 0);
          const p = xf(hasAlign && e.type !== 'MTEXT' ? [num(e, 11), num(e, 21)] : [num(e, 10), num(e, 20)]);
          const align = e.type === 'MTEXT' ? (([0, 'left', 'center', 'right'] as const)[((num(e, 71, 1) - 1) % 3) + 1] as 'left' | 'center' | 'right') : ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left';
          const rot = (e.type === 'MTEXT' ? num(e, 50) : num(e, 50)) + rotDeg;
          const lines = s.split('\n');
          lines.forEach((ln, k) => {
            const pp: Pt = k ? [p[0] + Math.sin((rot * Math.PI) / 180) * h * 1.5 * k, p[1] - Math.cos((rot * Math.PI) / 180) * h * 1.5 * k] : p;
            entities.push({ t: 'text', layer, p: pp, h, s: ln, align, valign: e.type === 'MTEXT' && k === 0 ? 'top' : 'base', rot: rot || undefined });
          });
          texts.push({ s, p, h });
          break;
        }
        case 'INSERT': {
          const blk = blocks.get(str(e, 2).trim());
          if (!blk || depth > 6) { skipped.INSERT = (skipped.INSERT ?? 0) + 1; break; }
          const ip: Pt = [num(e, 10), num(e, 20)], sx = num(e, 41, 1), sy = num(e, 42, sx), r = (num(e, 50) * Math.PI) / 180;
          const inner: Xf = (q) => {
            const x = (q[0] - blk.base[0]) * sx, y = (q[1] - blk.base[1]) * sy;
            return xf([ip[0] + x * Math.cos(r) - y * Math.sin(r), ip[1] + x * Math.sin(r) + y * Math.cos(r)]);
          };
          // block-defined text (ATTDEF) is a prompt, not a value: the ATTRIBs that follow carry the values
          emit(blk.ents.filter((x) => x.type !== 'ATTDEF'), inner, sc * Math.abs(sx), rotDeg + num(e, 50), depth + 1);
          break;
        }
        case 'ATTDEF': case 'SEQEND': case 'VERTEX': break;
        default: skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      }
    }
  };
  emit(split(sections.get('ENTITIES') ?? []), (p) => p, 1, 0, 0);
  return { entities, texts, extents: extentsOf(entities), units, skipped };
}

function flatten(pts: Pt[], bul: number[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    out.push(pts[i]);
    const b = bul[i];
    if (!b || (!closed && i === n - 1)) continue;
    const a = pts[i], c = pts[(i + 1) % n];
    const th = 4 * Math.atan(b), d = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!d) continue;
    // sagitta s and signed radius R; centre lies on the chord's left normal at R - s
    const sag = (b * d) / 2, R = (d * d / 4 + sag * sag) / (2 * sag);
    const ux = (c[0] - a[0]) / d, uy = (c[1] - a[1]) / d;
    const cx = (a[0] + c[0]) / 2 - uy * (R - sag), cy = (a[1] + c[1]) / 2 + ux * (R - sag);
    const a0 = Math.atan2(a[1] - cy, a[0] - cx), rr = Math.abs(R);
    const steps = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18)));
    for (let k = 1; k < steps; k++) out.push([cx + rr * Math.cos(a0 + (th * k) / steps), cy + rr * Math.sin(a0 + (th * k) / steps)]);
  }
  return out;
}

export function extentsOf(es: Entity[]): DxfRead['extents'] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Pt) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const e of es) {
    if (e.t === 'line') { add(e.a); add(e.b); } else if (e.t === 'poly') e.pts.forEach(add);
    else if (e.t === 'circle' || e.t === 'arc') { add([e.c[0] - e.r, e.c[1] - e.r]); add([e.c[0] + e.r, e.c[1] + e.r]); } else if (e.t === 'text') add(e.p);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

const DWG_VERSIONS: Record<string, string> = {
  AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018',
};

// DWG files start with an "AC10xx" version tag; the content is a proprietary
// compressed format that DORSCH does not decode in the browser.
export function dwgVersion(b: Uint8Array): string | null {
  const tag = String.fromCharCode(...b.subarray(0, 6));
  if (!/^AC10\d\d$/.test(tag)) return null;
  return DWG_VERSIONS[tag] ?? tag;
}
