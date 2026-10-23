import type { Configuration, Door, Handing, Project } from './types.js';
import { blankDoor, uid } from './defaults.js';

// Schedule import: a table (from xlsx or csv) -> door records. Columns are
// matched to fields by header text; values are parsed with explicit rules.
// Every data row ends up imported, updated or skipped with a stated reason, so
// the report always reconciles with the source row count.

export type Target =
  | '' | 'mark' | 'doorType' | 'quantity' | 'floor' | 'room' | 'location' | 'fromRoom' | 'toRoom' | 'configuration' | 'performance'
  | 'leaves' | 'description' | 'fireRating' | 'acousticRating' | 'openingWidth' | 'openingHeight' | 'doorWidth' | 'doorHeight' | 'leafThickness'
  | 'leafMaterial' | 'frameMaterial' | 'finish' | 'hardwareSet' | 'handing' | 'sourceRef' | 'remarks';

export const TARGETS: { key: Target; label: string; aliases: string[] }[] = [
  { key: '', label: '- ignore -', aliases: [] },
  { key: 'mark', label: 'Door mark / number', aliases: ['door number', 'door no', 'door nr', 'doornumber', 'no', 'nr', 'mark', 'door mark', 'door tag', 'tag', 'door ref', 'door id', 'opening no', 'opening number'] },
  { key: 'doorType', label: 'Door type', aliases: ['door type', 'type', 'door style', 'style', 'key plan door type'] },
  { key: 'quantity', label: 'Quantity', aliases: ['qty', 'quantity', 'nbr doors', 'no of doors', 'number of doors', 'count'] },
  { key: 'floor', label: 'Floor / level', aliases: ['level', 'floor', 'storey', 'story', 'floor level'] },
  { key: 'room', label: 'Room', aliases: ['room', 'room name', 'room no', 'room number', 'space'] },
  { key: 'location', label: 'Location', aliases: ['door location', 'location'] },
  { key: 'fromRoom', label: 'From room', aliases: ['from room', 'from'] },
  { key: 'toRoom', label: 'To room', aliases: ['to room', 'to'] },
  { key: 'configuration', label: 'Single / double / sliding', aliases: ['single double sliding', 'movement', 'configuration', 'operation', 'leaf type', 'door operation'] },
  { key: 'leaves', label: 'Number of leaves', aliases: ['shutters', 'leaves', 'no of leaves', 'number of leaves', 'leaf count', 'shutters source'] },
  { key: 'description', label: 'Door description (hint)', aliases: ['door description', 'description', 'door description source'] },
  { key: 'performance', label: 'Fire / acoustic (combined)', aliases: ['acoustic fr normal', 'performance', 'rating'] },
  { key: 'fireRating', label: 'Fire rating', aliases: ['fire rating', 'fire', 'fr', 'fire resistance', 'fire rating source'] },
  { key: 'acousticRating', label: 'Acoustic rating', aliases: ['acoustic rating', 'acoustic', 'acoustic rating source', 'stc', 'rw'] },
  { key: 'openingWidth', label: 'S.O. width', aliases: ['opening width', 's o width', 'so width', 'structural opening width'] },
  { key: 'openingHeight', label: 'S.O. height', aliases: ['opening height', 's o height', 'so height', 'structural opening height'] },
  { key: 'doorWidth', label: 'Door (leaf) width', aliases: ['width', 'door width', 'leaf width', 'w'] },
  { key: 'doorHeight', label: 'Door (leaf) height', aliases: ['height', 'door height', 'leaf height', 'h'] },
  { key: 'leafThickness', label: 'Leaf thickness', aliases: ['thickness', 'thk', 'door thickness', 'leaf thickness'] },
  { key: 'leafMaterial', label: 'Leaf material', aliases: ['door material', 'leaf material', 'material'] },
  { key: 'frameMaterial', label: 'Frame material', aliases: ['frame material', 'frame'] },
  { key: 'finish', label: 'Finish', aliases: ['finish', 'door finish', 'leaf finish'] },
  { key: 'hardwareSet', label: 'Hardware set', aliases: ['hardware set', 'hw set', 'hardware', 'hw', 'ironmongery', 'ironmongery set'] },
  { key: 'handing', label: 'Handing', aliases: ['handing', 'hand', 'swing'] },
  { key: 'sourceRef', label: 'Source / drawing ref', aliases: ['sd ref', 'sd ref rev 0', 'drawing ref', 'drawing', 'shop drawing', 'dwg ref', 'source', 'sd reference'] },
  { key: 'remarks', label: 'Remarks (can be several)', aliases: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment', 'review note', 'source remarks'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function guessTarget(header: string): Target {
  const h = norm(header);
  if (!h) return '';
  for (const t of TARGETS) if (t.aliases.includes(h)) return t.key;
  let best: { key: Target; len: number } | null = null;
  for (const t of TARGETS) for (const a of t.aliases) if (a.length > 2 && (h.startsWith(a + ' ') || h.endsWith(' ' + a)) && (!best || a.length > best.len)) best = { key: t.key, len: a.length };
  return best?.key ?? '';
}

export function findHeaderRow(rows: string[][]): number {
  let best = -1, score = 1;
  rows.slice(0, 20).forEach((r, i) => {
    const s = r.filter((c) => guessTarget(c) !== '').length;
    if (s > score) { score = s; best = i; }
  });
  return best;
}

// One target per column; a target other than remarks is used once (first wins).
export function autoMapping(headers: string[]): Target[] {
  const used = new Set<Target>();
  return headers.map((h) => {
    const t = guessTarget(h);
    if (!t || (t !== 'remarks' && used.has(t))) return '';
    used.add(t);
    return t;
  });
}

// ---------- value parsers ----------

export type Units = 'auto' | 'mm' | 'inch';

// Lengths: mm by default; inches (30") and feet-inches (3'-0") are converted.
export function parseLength(raw: string, units: Units): { value: number | null; note?: string; exact?: number } {
  const s = raw.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/''/g, '"');
  if (!s || s === '-') return { value: null };
  const ft = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/.exec(s);
  if (ft) { const e = (Number(ft[1]) * 12 + Number(ft[2] ?? 0)) * 25.4; return { value: Math.round(e), exact: e, note: `${s} converted to mm` }; }
  const inch = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/i.exec(s);
  if (inch) { const e = Number(inch[1]) * 25.4; return { value: Math.round(e), exact: e, note: `${s} converted to mm` }; }
  const mm = /^(\d+(?:\.\d+)?)\s*(mm)?$/i.exec(s);
  if (mm) { const e = units === 'inch' ? Number(mm[1]) * 25.4 : Number(mm[1]); return { value: Math.round(e), exact: e }; }
  const m = /^(\d+(?:\.\d+)?)\s*m$/i.exec(s);
  if (m) return { value: Math.round(Number(m[1]) * 1000) };
  return { value: null, note: `could not read length "${raw}"` };
}

const NONE = /^(|-|n\/?a|none|nil|normal|nfr|non[- ]?fr|non[- ]?rated|not stated|no)$/i;

export function parseFire(raw: string): { value: string; note?: string } {
  const parts = raw.split('/').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const read = parts.map(parseFirePart);
    const hit = read.find((x) => x.value);
    if (hit) return hit;
    return read.find((x) => x.note) ?? { value: '' };
  }
  return parseFirePart(parts[0] ?? '');
}

function parseFirePart(raw: string): { value: string; note?: string } {
  const s = raw.trim();
  if (NONE.test(s)) return { value: '' };
  let m = /(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours|h)\b/i.exec(s);
  if (m) return { value: `${Math.round(Number(m[1]) * 60)} min`, note: /confirm|\?|tbc/i.test(s) ? `fire rating marked to confirm: "${s}"` : undefined };
  m = /(\d+)\s*(?:min|mins|minutes)\b/i.exec(s) ?? /^(?:fr|e|ei|fd)\s*-?\s*(\d+)$/i.exec(s) ?? /^(\d+)$/.exec(s);
  if (m) return { value: `${Number(m[1])} min`, note: /confirm|\?|tbc/i.test(s) ? `fire rating marked to confirm: "${s}"` : undefined };
  if (/\bfr\b|fire/i.test(s)) return { value: '', note: `fire rating without a duration: "${s}"` };
  return { value: '', note: /db|acoustic/i.test(s) ? undefined : `could not read fire rating "${s}"` };
}

export function parseAcoustic(raw: string): { value: string; note?: string } {
  const s = raw.trim();
  const m = /(\d+)\s*db/i.exec(s) ?? /(?:rw|stc)\s*(\d+)/i.exec(s);
  if (m) return { value: `${Number(m[1])} dB` };
  if (/acoustic/i.test(s) && !/non[- ]?acoustic|not stated/i.test(s)) return { value: '', note: `acoustic without a rating: "${s}"` };
  return { value: '' };
}

export function parseConfiguration(raw: string): { value: Configuration | ''; note?: string } {
  const s = raw.trim().toLowerCase();
  if (!s || s === '-') return { value: '' };
  const two = /double|pair|\b2\b|two|bi-?parting|uneven|unequal/.test(s);
  if (/pocket/.test(s)) return { value: 'pocket' };
  if (/slid/.test(s)) return { value: two ? 'sliding-double' : 'sliding-single' };
  if (/pivot/.test(s)) return { value: 'pivot' };
  if (/double[- ]?action|\bda\b|swing both/.test(s)) return { value: two && /pair|\b2\b|double door|double\s+da/.test(s) ? 'double-action-pair' : 'double-action-single' };
  if (/uneven|unequal|leaf and a half|1\s*1\/2/.test(s)) return { value: 'double-unequal' };
  if (two) return { value: 'double-equal' };
  if (/single|\b1\b|one/.test(s)) return { value: 'single' };
  return { value: '', note: `could not read configuration "${raw}"` };
}

export function parseHanding(raw: string): Handing | '' {
  const s = raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (['LH', 'RH', 'LHR', 'RHR'].includes(s)) return s as Handing;
  if (s === 'LEFT' || s === 'LEFTHAND') return 'LH';
  if (s === 'RIGHT' || s === 'RIGHTHAND') return 'RH';
  return '';
}

// ---------- import ----------

export interface ImportOptions {
  fileName: string;
  sheetName: string;
  headerRow: number; // index into rows
  mapping: Target[];
  units: Units;
  buildingId: string;
  defaultFloorId: string; // used when no floor column, or the cell is blank
  existing: 'skip' | 'update';
}

export interface RowNote { row: number; mark: string; text: string }

export interface ImportReport {
  dataRows: number;
  imported: number;
  updated: number;
  skipped: RowNote[];
  warnings: RowNote[];
  createdFloors: string[];
  unmapped: string[];
  notes: string[];
}

const isTotalRow = (cells: string[]) => cells.some((c) => /^\s*(sub\s*)?total\b/i.test(c));

export function importRows(p: Project, rows: string[][], o: ImportOptions): { project: Project; report: ImportReport } {
  const header = rows[o.headerRow] ?? [];
  const col = (t: Target) => o.mapping.indexOf(t);
  const cols = (t: Target) => o.mapping.map((m, i) => (m === t ? i : -1)).filter((i) => i >= 0);
  const report: ImportReport = { dataRows: 0, imported: 0, updated: 0, skipped: [], warnings: [], createdFloors: [], unmapped: header.filter((h, i) => h.trim() && !o.mapping[i]), notes: [] };
  if (col('mark') < 0) throw new Error('Map a column to "Door mark / number" first');
  // a numeric width/height column with all values <= 150 and units auto is almost certainly inches
  let units = o.units;
  if (units === 'auto') {
    const vals = [col('doorWidth'), col('doorHeight'), col('openingWidth'), col('openingHeight')].filter((c) => c >= 0)
      .flatMap((c) => rows.slice(o.headerRow + 1).map((r) => r[c]?.trim() ?? '')).filter((v) => /^\d+(\.\d+)?$/.test(v)).map(Number);
    if (vals.length && vals.every((v) => v <= 150)) { units = 'inch'; report.notes.push('All plain-number sizes are 150 or less: read as inches and converted to mm.'); }
  }
  if (col('quantity') < 0) report.notes.push('No quantity column: each row is read as one door (quantity 1).');
  let project = { ...p, floors: [...p.floors], doors: [...p.doors] };
  const seen = new Set<string>();
  const floorFor = (name: string): string => {
    const n = name.trim();
    if (!n) return o.defaultFloorId;
    const f = project.floors.find((x) => x.buildingId === o.buildingId && norm(x.name) === norm(n));
    if (f) return f.id;
    const order = Math.max(-1, ...project.floors.filter((x) => x.buildingId === o.buildingId).map((x) => x.order)) + 1;
    const nf = { id: uid('flr'), buildingId: o.buildingId, name: n, order };
    project.floors.push(nf);
    report.createdFloors.push(n);
    return nf.id;
  };
  for (let i = o.headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!r.some((c) => c.trim())) continue;
    report.dataRows++;
    const rowNo = i + 1;
    const get = (t: Target) => { const c = col(t); return c >= 0 ? (r[c] ?? '').trim() : ''; };
    const mark = get('mark');
    const skip = (text: string) => report.skipped.push({ row: rowNo, mark, text });
    if (isTotalRow(r)) { skip('total / summary row'); continue; }
    if (!mark) { skip('no door mark'); continue; }
    if (norm(mark) === norm(header[col('mark')] ?? '')) { skip('repeated header row'); continue; }
    const key = mark.toLowerCase();
    if (seen.has(key)) { skip('duplicate mark in the file (first occurrence kept)'); continue; }
    seen.add(key);
    const warn = (text: string) => report.warnings.push({ row: rowNo, mark, text });
    const patch: Partial<Door> = {};
    const setText = (t: Target, field: keyof Door) => { const v = get(t); if (v) (patch as Record<string, unknown>)[field] = v; };
    setText('doorType', 'doorType'); setText('room', 'room'); setText('leafMaterial', 'leafMaterial'); setText('frameMaterial', 'frameMaterial'); setText('hardwareSet', 'hardwareSet'); setText('sourceRef', 'sourceRef');
    const fin = get('finish');
    if (fin) { patch.finishSide1 = fin; patch.finishSide2 = fin; }
    const loc = get('location') || [get('fromRoom'), get('toRoom')].filter(Boolean).join(' to ');
    if (loc) patch.location = loc;
    if (!patch.room && get('toRoom')) patch.room = get('toRoom');
    if (col('quantity') >= 0) {
      const q = get('quantity');
      if (q && /^\d+$/.test(q) && Number(q) > 0) patch.quantity = Number(q);
      else if (q) warn(`quantity "${q}" not read`);
    } else patch.quantity = 1;
    if (col('configuration') >= 0 && get('configuration')) {
      const c = parseConfiguration(get('configuration'));
      if (c.value) patch.configuration = c.value;
      if (c.note) warn(c.note);
    }
    const hint = get('description') ? parseConfiguration(get('description')).value : '';
    if (!patch.configuration && hint) patch.configuration = hint;
    else if (hint === 'double-unequal' && patch.configuration === 'double-equal') patch.configuration = 'double-unequal';
    const lv = get('leaves');
    if (lv) {
      const n = /^\d+$/.test(lv) ? Number(lv) : NaN;
      const c = patch.configuration ?? '';
      if (n === 2) {
        if (c === 'sliding-single') patch.configuration = 'sliding-double';
        else if (c === 'single') { warn(`configuration says single but ${n} leaves stated: read as a pair`); patch.configuration = hint === 'double-unequal' ? 'double-unequal' : 'double-equal'; }
        else if (c === 'double-action-single') patch.configuration = 'double-action-pair';
        else if (!c) patch.configuration = 'double-equal';
      } else if (n === 1) {
        if (c.startsWith('double') || c === 'sliding-double') warn(`configuration ${c} but 1 leaf stated: configuration kept, check the source`);
        else if (!c) patch.configuration = 'single';
      } else warn(`number of leaves "${lv}" not read`);
    }
    if (col('handing') >= 0) {
      const hnd = parseHanding(get('handing'));
      if (hnd) patch.handing = hnd; else if (get('handing')) warn(`handing "${get('handing')}" not read`);
    }
    // fire / acoustic: explicit columns win over the combined column
    const perf = get('performance');
    if (perf) {
      const f = parseFire(perf.replace(/acoustic\s*\d+\s*db/gi, ''));
      const a = parseAcoustic(perf);
      if (f.value) patch.fireRating = f.value;
      if (a.value) patch.acousticRating = a.value;
      [f.note, a.note].filter(Boolean).forEach((n) => warn(n!));
    }
    if (col('fireRating') >= 0 && get('fireRating')) {
      const f = parseFire(get('fireRating'));
      if (f.value) {
        if (patch.fireRating && patch.fireRating !== f.value) warn(`fire rating differs between columns: ${patch.fireRating} vs ${f.value} (fire rating column used)`);
        patch.fireRating = f.value;
      }
      if (f.note) warn(f.note);
    }
    if (col('acousticRating') >= 0 && get('acousticRating')) {
      const a = parseAcoustic(get('acousticRating'));
      if (a.value) {
        if (patch.acousticRating && patch.acousticRating !== a.value) warn(`acoustic rating differs between columns: ${patch.acousticRating} vs ${a.value} (acoustic column used)`);
        patch.acousticRating = a.value;
      }
      if (a.note) warn(a.note);
    }
    const exact: Partial<Record<Target, number>> = {};
    const len = (t: Target, label: string) => {
      const raw = get(t);
      if (!raw) return null;
      const l = parseLength(raw, units);
      if (l.note && l.value === null) warn(`${label}: ${l.note}`);
      if (l.exact !== undefined) exact[t] = l.exact;
      return l.value;
    };
    const ow = len('openingWidth', 'S.O. width'), oh = len('openingHeight', 'S.O. height');
    if (ow !== null) patch.openingWidth = ow;
    if (oh !== null) patch.openingHeight = oh;
    const dw = len('doorWidth', 'door width'), dh = len('doorHeight', 'door height'), th = len('leafThickness', 'thickness');
    if (dh !== null) patch.leafHeight = dh;
    if (th !== null) patch.leafThickness = th;
    if (dw !== null) {
      const conf = patch.configuration ?? p.doors.find((d) => d.mark.toLowerCase() === key)?.configuration ?? '';
      if (conf === 'double-equal' || conf === 'double-action-pair' || conf === 'sliding-double') {
        // split the source value before rounding, so 72" gives 2 x 36" = 2 x 914
        const half = (exact.doorWidth ?? dw) / 2;
        if (Number.isInteger(half) || exact.doorWidth !== dw) { patch.leafWidth1 = Math.round(half); patch.leafWidth2 = Math.round(half); warn(`door width ${get('doorWidth')} read as a pair total, split into 2 x ${Math.round(half)} mm`); }
        else warn(`door width ${dw} for a pair cannot be split into equal whole mm: leaf widths left blank`);
      } else if (conf === 'double-unequal') warn(`door width ${dw} for an unequal pair: split not stated, leaf widths left blank`);
      else patch.leafWidth1 = dw;
    }
    const remarks = cols('remarks').map((c) => (r[c] ?? '').trim()).filter(Boolean);
    const provenance = `[Imported: ${o.fileName} / ${o.sheetName} / row ${rowNo}]`;
    const existing = project.doors.find((d) => d.mark.trim().toLowerCase() === key);
    if (existing) {
      if (o.existing === 'skip') { skip('mark already in the project'); continue; }
      const floorId = col('floor') >= 0 && get('floor') ? floorFor(get('floor')) : existing.floorId;
      const upd: Door = { ...existing, ...patch, floorId, remarks: [existing.remarks, ...remarks, provenance].filter(Boolean).join(' | ') };
      upd.history = [...existing.history, { at: new Date().toISOString(), field: 'import', from: '', to: provenance }];
      project.doors = project.doors.map((d) => (d.id === existing.id ? upd : d));
      report.updated++;
      continue;
    }
    const floorId = col('floor') >= 0 ? floorFor(get('floor')) : o.defaultFloorId;
    const door = blankDoor({ ...patch, mark, buildingId: o.buildingId, floorId, status: 'draft', remarks: [...remarks, provenance].join(' | ') });
    if (!door.sourceRef) door.sourceRef = `${o.fileName} / ${o.sheetName} row ${rowNo}`;
    project.doors.push(door);
    report.imported++;
  }
  return { project, report };
}

// Plain CSV -> grid (reuses the same quoting rules as the catalogue import).
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/^﻿/, '');
  const sep = (t.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (t.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true; // a quote is special only at the start of a field
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

// Combines an AI suggestion with the current matching: a suggestion fills or
// changes a column, an empty suggestion keeps the current choice, and a field
// moved to a new column is cleared from its old one (remarks may repeat).
export function mergeMapping(current: Target[], suggested: Target[]): Target[] {
  const out = current.map((c, i) => suggested[i] || c);
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (!t || t === 'remarks' || !suggested[i]) continue;
    out.forEach((u, j) => { if (j !== i && u === t && !suggested[j]) out[j] = ''; });
  }
  return out;
}
