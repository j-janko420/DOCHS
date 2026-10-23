import type { Entity, Pt } from './entities.js';
import { LAYERS, bbox, dimGeometry } from './entities.js';

// ASCII DXF writer, AutoCAD R12 (AC1009): the most widely readable DXF version.
// Produces LINE, POLYLINE, ARC, CIRCLE, TEXT and DIMENSION entities on named
// layers with linetypes; each DIMENSION references its own anonymous *D block.

const n = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

class W {
  out: string[] = [];
  g(code: number, v: string | number) { this.out.push(String(code), typeof v === 'number' ? n(v) : v); }
  pt(p: Pt, base = 10) { this.g(base, p[0]); this.g(base + 10, p[1]); this.g(base + 20, 0); }
  toString() { return this.out.join('\n') + '\n'; }
}

const LTYPES: { name: string; desc: string; pattern: number[] }[] = [
  { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] },
  { name: 'DASHED', desc: '__ __ __ __', pattern: [6, -3] },
  { name: 'HIDDEN', desc: '_ _ _ _ _ _', pattern: [3, -1.5] },
  { name: 'CENTER', desc: '____ _ ____ _', pattern: [12, -3, 3, -3] },
];

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '?');

function entity(w: W, e: Entity, layerOverride?: string) {
  const layer = layerOverride ?? e.layer;
  switch (e.t) {
    case 'line':
      w.g(0, 'LINE'); w.g(8, layer); w.pt(e.a, 10); w.pt(e.b, 11); break;
    case 'poly':
      w.g(0, 'POLYLINE'); w.g(8, layer); w.g(66, 1); w.pt([0, 0], 10); w.g(70, e.closed ? 1 : 0);
      for (const p of e.pts) { w.g(0, 'VERTEX'); w.g(8, layer); w.pt(p, 10); }
      w.g(0, 'SEQEND'); w.g(8, layer); break;
    case 'arc':
      w.g(0, 'ARC'); w.g(8, layer); w.pt(e.c, 10); w.g(40, e.r); w.g(50, e.a0); w.g(51, e.a1); break;
    case 'circle':
      w.g(0, 'CIRCLE'); w.g(8, layer); w.pt(e.c, 10); w.g(40, e.r); break;
    case 'text': {
      const h = e.align === 'center' ? 1 : e.align === 'right' ? 2 : 0;
      const v = e.valign === 'middle' ? 2 : e.valign === 'top' ? 3 : 0;
      w.g(0, 'TEXT'); w.g(8, layer); w.pt(e.p, 10); w.g(40, e.h); w.g(1, clean(e.s));
      if (e.rot) w.g(50, e.rot);
      w.g(7, 'STANDARD');
      if (h || v) { w.g(72, h); w.g(73, v); w.pt(e.p, 11); }
      break;
    }
    case 'dim': case 'hatch':
      throw new Error(`${e.t} must be expanded before writing`);
  }
}

export interface DxfStats { entities: Record<string, number>; layers: string[]; dimensions: number }

export function toDxf(entities: Entity[], opt: { ltscale?: number; title?: string } = {}): string {
  const box = bbox(entities);
  const w = new W();
  // HEADER
  w.g(999, clean(`DOCHS DoorChisolution - Designed by i3 Design - DXF R12 ${opt.title ?? ''}`.trim()));
  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1009');
  w.g(9, '$INSBASE'); w.pt([0, 0], 10);
  w.g(9, '$EXTMIN'); w.pt([box.x0, box.y0], 10);
  w.g(9, '$EXTMAX'); w.pt([box.x1, box.y1], 10);
  w.g(9, '$LIMMIN'); w.g(10, box.x0); w.g(20, box.y0);
  w.g(9, '$LIMMAX'); w.g(10, box.x1); w.g(20, box.y1);
  w.g(9, '$LTSCALE'); w.g(40, opt.ltscale ?? 1);
  w.g(9, '$DIMSCALE'); w.g(40, opt.ltscale ?? 1);
  w.g(9, '$LUNITS'); w.g(70, 2);
  w.g(9, '$LUPREC'); w.g(70, 0);
  w.g(0, 'ENDSEC');
  // TABLES
  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  w.g(0, 'TABLE'); w.g(2, 'LTYPE'); w.g(70, LTYPES.length);
  for (const lt of LTYPES) {
    w.g(0, 'LTYPE'); w.g(2, lt.name); w.g(70, 0); w.g(3, lt.desc); w.g(72, 65); w.g(73, lt.pattern.length);
    w.g(40, lt.pattern.reduce((s, x) => s + Math.abs(x), 0));
    for (const x of lt.pattern) w.g(49, x);
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'LAYER'); w.g(70, LAYERS.length + 1);
  w.g(0, 'LAYER'); w.g(2, '0'); w.g(70, 0); w.g(62, 7); w.g(6, 'CONTINUOUS');
  for (const l of LAYERS) { w.g(0, 'LAYER'); w.g(2, l.name); w.g(70, 0); w.g(62, l.color); w.g(6, l.ltype); }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'STYLE'); w.g(70, 1);
  w.g(0, 'STYLE'); w.g(2, 'STANDARD'); w.g(70, 0); w.g(40, 0); w.g(41, 1); w.g(50, 0); w.g(71, 0); w.g(42, 2.5); w.g(3, 'txt'); w.g(4, '');
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'DIMSTYLE'); w.g(70, 1);
  w.g(0, 'DIMSTYLE'); w.g(2, 'STANDARD'); w.g(70, 0);
  w.g(3, ''); w.g(4, ''); w.g(5, ''); w.g(6, ''); w.g(7, '');
  w.g(40, opt.ltscale ?? 1); w.g(41, 2.5); w.g(42, 1); w.g(43, 3.75); w.g(44, 1.5); w.g(140, 2.5); w.g(141, 2.5); w.g(147, 1);
  w.g(71, 0); w.g(72, 0); w.g(73, 0); w.g(74, 0); w.g(77, 1); w.g(78, 0);
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');
  // BLOCKS: one anonymous block per dimension
  const dims = entities.filter((e): e is Extract<Entity, { t: 'dim' }> => e.t === 'dim');
  w.g(0, 'SECTION'); w.g(2, 'BLOCKS');
  dims.forEach((d, i) => {
    const name = `*D${i + 1}`;
    const g = dimGeometry(d);
    w.g(0, 'BLOCK'); w.g(8, '0'); w.g(2, name); w.g(70, 1); w.pt([0, 0], 10); w.g(3, name); w.g(1, '');
    for (const [a, b] of g.lines) entity(w, { t: 'line', layer: d.layer, a, b });
    entity(w, { t: 'text', layer: d.layer, p: g.textPos, h: d.h, s: g.text, align: 'center', rot: g.textRot || undefined });
    w.g(0, 'ENDBLK'); w.g(8, '0');
  });
  w.g(0, 'ENDSEC');
  // ENTITIES
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  let di = 0;
  for (const e of entities) {
    if (e.t === 'dim') {
      const g = dimGeometry(e);
      di++;
      w.g(0, 'DIMENSION'); w.g(8, e.layer); w.g(2, `*D${di}`);
      w.pt(g.defPoint, 10); w.pt(g.textPos, 11);
      w.g(70, 0); w.g(1, g.text);
      w.pt(e.a, 13); w.pt(e.b, 14);
      w.g(50, e.dir === 'h' ? 0 : 90);
      w.g(3, 'STANDARD');
    } else if (e.t === 'hatch') {
      throw new Error('hatch must be expanded before writing');
    } else entity(w, e);
  }
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.toString();
}

// ---------- minimal reader used by tests and the in-app self check ----------
export interface DxfPair { code: number; value: string }

export function parsePairs(text: string): DxfPair[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2) throw new Error('odd number of DXF lines');
  const out: DxfPair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code at line ${i + 1}: ${lines[i]}`);
    out.push({ code, value: lines[i + 1] });
  }
  return out;
}

export function dxfStats(text: string): DxfStats {
  const pairs = parsePairs(text);
  const entities: Record<string, number> = {};
  const layers: string[] = [];
  let section = '';
  let inTable = '';
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 0 && p.value === 'SECTION') { section = pairs[i + 1].value; continue; }
    if (p.code === 0 && p.value === 'TABLE') { inTable = pairs[i + 1].value; continue; }
    if (section === 'TABLES' && inTable === 'LAYER' && p.code === 0 && p.value === 'LAYER') layers.push(pairs[i + 1].value);
    if (section === 'ENTITIES' && p.code === 0 && !['ENDSEC', 'VERTEX', 'SEQEND', 'EOF'].includes(p.value)) entities[p.value] = (entities[p.value] ?? 0) + 1;
  }
  return { entities, layers, dimensions: entities['DIMENSION'] ?? 0 };
}
