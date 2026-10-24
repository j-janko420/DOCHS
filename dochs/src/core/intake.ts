import type { HardwareCategory, HardwareItem, HardwareSet, Project } from './types.js';
import { blankProject, uid } from './defaults.js';
import { autoMapping, csvRows, findHeaderRow, importRows, type ImportReport, type Target } from './importer.js';
import { readXlsx } from './xlsx-read.js';
import { readPdfText, pageLines, pageTable } from './pdf-read.js';
import { readDocx } from './docx-read.js';
import { dwgVersion, readDxf } from '../cad/dxf-read.js';

// New-project intake. The three fundamental inputs are door layouts (floor-wise
// or complete), the master door schedule and the hardware / ironmongery sets,
// in PDF, Excel, CSV, Word, text, DXF, DWG or image form. Each file is read in
// the browser where its format allows; everything extracted carries its source
// and nothing missing is invented. Images, scans and DWG are reported as not
// readable here (AI reading via the DORSCH server, or convert the file).

export type Role = 'layout' | 'schedule' | 'hardware';
export type Kind = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'text' | 'dxf' | 'dwg' | 'image' | 'other';
export interface Cell { x: number; s: string }
export interface Line { cells: Cell[] }
export interface IntakeDoc {
  name: string;
  role: Role;
  kind: Kind;
  pages: Line[][];
  tables: { name: string; rows: string[][] }[];
  notes: string[];
  textFound: boolean;
  needsAi: boolean;
}

export const ACCEPT = '.pdf,.xlsx,.xlsm,.csv,.txt,.tsv,.docx,.dxf,.dwg,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff';

export function kindOf(name: string): Kind {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx') return 'docx';
  if (ext === 'txt' || ext === 'tsv' || ext === 'md') return 'text';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'dwg') return 'dwg';
  if (/^(png|jpe?g|webp|gif|bmp|tiff?|heic)$/.test(ext)) return 'image';
  return 'other';
}

const rowsToLines = (rows: string[][]): Line[] => rows.map((r) => ({ cells: r.map((s, i) => ({ x: i * 100, s: s.trim() })).filter((c) => c.s) })).filter((l) => l.cells.length);
const textLines = (t: string): Line[] => t.split(/\r\n|\r|\n/).map((ln) => ({ cells: ln.split(/\t| {2,}/).map((s, i) => ({ x: i * 100, s: s.trim() })).filter((c) => c.s) })).filter((l) => l.cells.length);

export async function readDoc(name: string, bytes: Uint8Array, role: Role): Promise<IntakeDoc> {
  const kind = kindOf(name);
  const doc: IntakeDoc = { name, role, kind, pages: [], tables: [], notes: [], textFound: false, needsAi: false };
  try {
    switch (kind) {
      case 'pdf': {
        const r = await readPdfText(bytes);
        doc.pages = r.pages.map((pg) => pageLines(pg).map((l) => ({ cells: l.cells.map((c) => ({ x: c.x, s: c.s })) })));
        // marks on plans are often rotated with the wall: keep vertical text as single-cell lines too
        // markup notes stay separate lines so they are not merged with plan text under them
        r.pages.forEach((pg, i) => { for (const it of pg.items.filter((x) => x.vertical || x.note)) doc.pages[i].push({ cells: [{ x: it.x, s: it.s }] }); });
        if (role !== 'layout') doc.tables = r.pages.map((pg, i) => ({ name: `page ${i + 1}`, rows: pageTable(pg) }));
        const n = r.pages.reduce((a, p) => a + p.items.length, 0);
        doc.textFound = n > 0;
        doc.notes.push(`PDF, ${r.pages.length} page(s), ${n} text items${r.producer ? `, made by ${r.producer}` : ''}.`);
        if (!n) { doc.needsAi = true; doc.notes.push('No text layer: this is a scanned / image-only PDF. Use AI reading (DORSCH server) or upload the native file.'); }
        break;
      }
      case 'xlsx': {
        const sheets = await readXlsx(bytes);
        doc.tables = sheets.map((s) => ({ name: s.name, rows: s.rows }));
        doc.pages = sheets.map((s) => rowsToLines(s.rows));
        doc.textFound = sheets.some((s) => s.rows.length);
        doc.notes.push(`Excel, ${sheets.length} sheet(s): ${sheets.map((s) => `${s.name} (${s.rows.length} rows)`).join(', ')}.`);
        break;
      }
      case 'csv': {
        const rows = csvRows(new TextDecoder().decode(bytes));
        doc.tables = [{ name, rows }];
        doc.pages = [rowsToLines(rows)];
        doc.textFound = rows.length > 0;
        doc.notes.push(`CSV, ${rows.length} rows.`);
        break;
      }
      case 'text': {
        const t = new TextDecoder().decode(bytes);
        doc.pages = [textLines(t)];
        if (/\t/.test(t)) doc.tables = [{ name, rows: t.split(/\r\n|\r|\n/).filter((l) => l.trim()).map((l) => l.split('\t')) }];
        doc.textFound = doc.pages[0].length > 0;
        doc.notes.push(`Text, ${doc.pages[0].length} lines.`);
        break;
      }
      case 'docx': {
        const r = await readDocx(bytes);
        doc.tables = r.tables.map((rows, i) => ({ name: `table ${i + 1}`, rows }));
        doc.pages = [textLines(r.lines.join('\n'))];
        doc.textFound = r.lines.length > 0;
        doc.notes.push(`Word, ${r.lines.length} lines, ${r.tables.length} table(s).`);
        break;
      }
      case 'dxf': {
        const r = readDxf(new TextDecoder().decode(bytes));
        doc.pages = [r.texts.map((t) => ({ cells: [{ x: t.p[0], s: t.s.replace(/\n/g, ' ') }] }))];
        doc.textFound = r.texts.length > 0;
        doc.notes.push(`DXF, ${r.entities.length} entities, ${r.texts.length} texts (units ${r.units}).`);
        break;
      }
      case 'dwg': {
        const v = dwgVersion(bytes);
        doc.notes.push(`DWG${v ? ` (${v})` : ''} received. DWG is a closed Autodesk format that cannot be read in the browser: in AutoCAD use SAVEAS → DXF (or the free ODA File Converter), or plot to PDF, and upload that.`);
        break;
      }
      case 'image': {
        doc.needsAi = true;
        doc.notes.push('Image received. Text in images needs AI reading (DORSCH server); without it, enter or upload the data as PDF / Excel.');
        break;
      }
      default: doc.notes.push('Unsupported file type. Use PDF, Excel, CSV, Word (.docx), text, DXF, DWG or an image. Old .doc / .xls: save as .docx / .xlsx first.');
    }
  } catch (e) {
    doc.notes.push(`Could not read: ${(e as Error).message}`);
  }
  return doc;
}

// A document from transcribed text (AI reading of an image or scan): same
// extraction as any text file, marked with where the text came from.
export function docFromText(name: string, role: Role, kind: Kind, text: string, note: string): IntakeDoc {
  const pages = [textLines(text)];
  const tables = /\t/.test(text) ? [{ name: 'transcribed', rows: text.split(/\r\n|\r|\n/).filter((l) => l.trim()).map((l) => l.split('\t')) }] : [];
  return { name, role, kind, pages, tables, notes: [note, `${pages[0].length} lines transcribed.`], textFound: pages[0].length > 0, needsAi: false };
}

// ---------- project details ----------

export type InfoKey = 'name' | 'number' | 'client' | 'consultant' | 'location' | 'date' | 'revision';
export type Info = Partial<Record<InfoKey, { value: string; source: string }>>;

const LABELS: [InfoKey, RegExp][] = [
  ['number', /^(project|job|contract)\s*(no\.?|nr\.?|number|#|ref\.?|code)$/],
  ['name', /^(project(\s*(name|title))?|job(\s*(name|title))?|scheme|development)$/],
  ['client', /^(client|employer|owner|developer)$/],
  ['consultant', /^(consultant|architect|interior designer|designer|lead consultant|engineer)$/],
  ['location', /^(location|site|address|project location|city)$/],
  ['date', /^(date|issue date|date of issue)$/],
  ['revision', /^(rev\.?|revision|rev no\.?)$/],
];

const labelOf = (s: string): InfoKey | null => {
  const n = s.toLowerCase().replace(/[:.\s]+$/, '').replace(/\s+/g, ' ').trim();
  for (const [k, re] of LABELS) if (re.test(n)) return k;
  return null;
};

export function extractInfo(docs: IntakeDoc[]): Info {
  const out: Info = {};
  const set = (k: InfoKey, v: string, src: string) => {
    const value = v.replace(/^[:\-\s]+/, '').trim();
    if (!value || out[k] || labelOf(value) || value.length > 120 || /:$/.test(value) || /^(sl\.?\s*no\.?|no\.?|by|description|drwn|chkd|checked|drawn|approved|notes?|remarks?|title|scale|n\/?a|-+)$/i.test(value)) return;
    out[k] = { value, source: src };
  };
  for (const d of docs) d.pages.forEach((lines, pi) => {
    const src = `${d.name}${d.pages.length > 1 ? ` p.${pi + 1}` : ''}`;
    lines.forEach((l, li) => l.cells.forEach((c, ci) => {
      const inline = /^([A-Za-z][A-Za-z .#]{1,24}?)\s*:\s*(.+)$/.exec(c.s);
      if (inline) { const k = labelOf(inline[1]); if (k) { set(k, inline[2], src); return; } }
      const k = labelOf(c.s);
      if (!k) return;
      const right = l.cells[ci + 1];
      if (right) { set(k, right.s, src); return; }
      const below = lines[li + 1]?.cells.find((x) => Math.abs(x.x - c.x) < 60);
      if (below) set(k, below.s, src);
    }));
  });
  return out;
}

// ---------- master schedule ----------

export interface ScheduleFound { rows: string[][]; headerRow: number; mapping: Target[]; source: string; score: number }

// The best door-schedule table across the schedule files. Multi-page PDF
// schedules are joined: later pages whose rows have the same width are appended
// and their repeated header rows dropped.
export function findSchedule(docs: IntakeDoc[]): ScheduleFound | null {
  let best: ScheduleFound | null = null;
  for (const d of docs.filter((x) => x.role === 'schedule')) {
    d.tables.forEach((t, ti) => {
      const hr = findHeaderRow(t.rows);
      if (hr < 0) return;
      const mapping = autoMapping(t.rows[hr]);
      if (!mapping.includes('mark')) return;
      let rows = t.rows.slice();
      if (d.kind === 'pdf') {
        const head = t.rows[hr].join('|');
        for (const nt of d.tables.slice(ti + 1)) {
          const nh = findHeaderRow(nt.rows);
          const body = nt.rows.slice(nh >= 0 && nt.rows[nh].join('|') === head ? nh + 1 : 0);
          if (body.length && body[0].length === t.rows[hr].length) rows = rows.concat(body);
        }
      }
      const score = mapping.filter(Boolean).length * 1000 + rows.length;
      if (!best || score > best.score) best = { rows, headerRow: hr, mapping, source: `${d.name} / ${t.name}`, score };
    });
  }
  return best;
}

// ---------- hardware sets ----------

const CAT_RULES: [HardwareCategory, RegExp][] = [
  ['panic', /panic|exit device|push ?bar|touch ?bar|crash bar|vertical rod|rim device/i],
  ['protection', /kick|armou?r|mop plate|protector|protection|edge guard|stretcher plate/i],
  ['access-control', /reader|keypad|door contact|position switch|\brex\b|request to exit|break ?glass|camera|controller|i\/o board|intercom/i],
  ['electrical', /power ?supply|\bpsu\b|harness|power ?transfer|transfer hinge|wiring|loop/i],
  ['cylinder', /cylinder|\bcore\b|thumb ?turn/i],
  ['flush-bolt', /flush ?bolt|dust ?proof|dustproof/i],
  ['coordinator', /coordinator|co-ordinator|selector/i],
  ['closer', /closer|floor spring|operator/i],
  ['pivot', /pivot/i],
  ['hinge', /hinge|\bbutts?\b/i],
  ['lock', /lock|latch|deadbolt|strike|mortice|mortise|keep\b/i],
  ['pull', /pull|push ?plate|finger plate/i],
  ['handle', /lever|knob|handle/i],
  ['seal', /seal|gasket|weather ?strip|sweep|drop ?seal|brush/i],
  ['threshold', /threshold|saddle|\bsill\b/i],
  ['stop', /stop|holder|buffer|bumper/i],
  ['sliding-gear', /track|sliding|damper|floor guide|hanger/i],
];

export function hardwareCategory(text: string): HardwareCategory {
  for (const [c, re] of CAT_RULES) if (re.test(text)) return c;
  return 'other';
}

const FINISH = /^(US\s?\d{1,2}[A-Z]?|6\d\d|SSS|PSS|SSE|SAA|SCP|PCP|SNP|PB|SC|SS|BLK|MB|PVD\b.*|matt?e?\s*black|black|white|satin\s+(stainless|chrome|nickel|brass|alumin(i)?um)|polished\s+(stainless|chrome|brass)|stainless\s+steel|chrome|brass|bronze|anodi[sz]ed.*|RAL\s?\d{4})$/i;
const isFinish = (s: string) => FINISH.test(s.trim());
const isMfr = (s: string) => /^[A-Za-z][A-Za-z&.'\-]{1,14}$/.test(s) && !isFinish(s);

export function normSet(code: string): string {
  return code.toUpperCase()
    .replace(/^(HARDWARE|IRONMONGERY|DOOR)?\s*(SET|GROUP)?\s*(NO\.?|NUMBER|#)?\s*[:\-]?\s*/, '')
    .replace(/^(HW|HS|IS|IR|IM)(?=[\s\-_.]?\d)/, '')
    .replace(/[^A-Z0-9.]/g, '').replace(/^0+(?=\d)/, '');
}

const SET_HEAD = /^(?:(?:door\s+)?(?:hardware|ironmongery)\s*(?:set|group|schedule)?|hw\s*set|set|group|heading)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-\/]*)\s*(.*)$/i;
const CODE_ONLY = /^(?:HW|HS|IS|IR|IM)[\s\-_.]?\d+[A-Z0-9.\-]*$/i;

export interface SetFound extends HardwareSet { doors: string[]; source: string }

function itemFrom(cells: string[], qty: number, single: boolean): HardwareItem {
  const per = /\bper\s+leaf\b/i.test(cells.join(' '));
  if (single) {
    const t = cells.join(' ');
    const fin = t.split(/\s+/).find((w) => isFinish(w)) ?? (/(matt?e? black|satin stainless|polished stainless|satin chrome|PVD [a-z]+)/i.exec(t)?.[1] ?? '');
    return { id: uid('hi'), catalogueId: '', item: t, qty, basis: per ? 'per-leaf' : 'per-door', manufacturer: '', model: '', finish: fin };
  }
  const item = cells[0] ?? '';
  const toks = cells.slice(1).join('  ').split(/\s+/).filter(Boolean);
  let manufacturer = '', finish = '';
  if (toks.length >= 2 && isMfr(toks[toks.length - 1])) manufacturer = toks.pop()!;
  if (toks.length >= 1 && isFinish(toks[toks.length - 1])) finish = toks.pop()!;
  else if (toks.length >= 2 && isFinish(toks.slice(-2).join(' '))) finish = toks.splice(-2).join(' ');
  return { id: uid('hi'), catalogueId: '', item, qty, basis: per ? 'per-leaf' : 'per-door', manufacturer, model: toks.join(' '), finish };
}

// Hardware sets from text lines (PDF / Word / text): set headings, "Doors:" and
// "Description:" lines, and item lines starting with a quantity.
export function setsFromLines(lines: Line[], source: string): SetFound[] {
  const sets: SetFound[] = [];
  let cur: SetFound | null = null;
  let inNotes = false;
  let pending: string[] = [];
  let setX = 0, modelX = Infinity;
  for (const l of lines) {
    const cells = l.cells.map((c) => c.s);
    const t = cells.join('  ').trim();
    const head = SET_HEAD.exec(cells[0] ?? '');
    if ((head && /\d/.test(head[1]) && !/^\d+(\.\d+)?$/.test(cells[0])) || CODE_ONLY.test(cells[0] ?? '')) {
      const code = head ? head[1] : cells[0];
      const rest = head ? [head[2], ...cells.slice(1)].filter(Boolean).join(' ') : cells.slice(1).join(' ');
      cur = { code: code.replace(/[:\s]+$/, ''), description: rest, items: [], doors: [], source };
      sets.push(cur);
      inNotes = false;
      pending = [];
      setX = Infinity;
      modelX = Infinity;
      continue;
    }
    if (!cur) continue;
    setX = Math.min(setX, l.cells[0]?.x ?? 0);
    const kv = /^(doors?|openings?|description|desc\.?)\s*:\s*(.*)$/i.exec(t);
    if (kv) {
      if (/^door|^open/i.test(kv[1])) cur.doors.push(...kv[2].split(/[,;]\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean));
      else cur.description = kv[2].trim();
      continue;
    }
    if (/^(note|notes|operational narrative|remarks?)\b/i.test(t)) { inNotes = true; continue; }
    if (inNotes) continue;
    const q = /^(\d+(?:\.\d+)?)\s*(?:no\.?|nos\.?|x|pcs?|pr\.?|pairs?|sets?|ea\.?)?$/i.exec(cells[0] ?? '');
    const qm = !q && cells.length > 1 ? /^(\d+(?:\.\d+)?)\s*(?:no\.?|nos\.?|x|pcs?|pr\.?|pairs?|sets?|ea\.?)?\s+([A-Za-z].*)$/i.exec(cells[0]) : null;
    if ((q || qm) && cells.length > 1) {
      const it = itemFrom(qm ? [qm[2], ...cells.slice(1)] : cells.slice(1), Number((q ?? qm)![1]), false);
      if (pending.length) { it.model = `${pending.join(' ')} ${it.model}`.trim(); pending = []; }
      cur.items.push(it);
      modelX = (qm ? l.cells[0].x + 17 : l.cells[1]?.x ?? Infinity) + 20;
      continue;
    }
    const q2 = /^(\d+(?:\.\d+)?)\s*(?:no\.?|nos\.?|x|pcs?|pr\.?|pairs?|sets?|ea\.?)?\s+(.+)$/i.exec(t);
    if (q2 && cells.length === 1) { cur.items.push(itemFrom([q2[2]], Number(q2[1]), true)); continue; }
    // wrapped model text: before the first item it heads the next item, after that it continues the last one
    const last = cur.items[cur.items.length - 1];
    // (only text sitting in the model column: page headers and notes start further left)
    const x0 = l.cells[0]?.x ?? 0;
    if (t.length < 60 && !/^-/.test(t)) {
      if (last) { if (x0 >= modelX) last.model = `${last.model} ${t}`.trim(); } else if (x0 > setX + 50) pending.push(t);
      else if (cur.description && x0 <= setX + 5) cur.description += ` ${t}`;
    }
  }
  return sets.filter((s) => s.items.length || s.doors.length);
}

// Hardware sets from a table with a header row (Excel / CSV / Word table).
export function setsFromTable(rows: string[][], source: string): SetFound[] | null {
  const hi = rows.slice(0, 15).findIndex((r) => r.some((c) => /^(qty|quantity|nos?\.?)$/i.test(c.trim())) && r.some((c) => /item|description|product|component/i.test(c)));
  if (hi < 0) return null;
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const cSet = col(/^(hardware |hw |ironmongery )?(set|group)( no\.?| code| ref)?$|^hw set|^set no/);
  const cQty = col(/^(qty|quantity|nos?\.?)$/);
  const cItem = col(/item|description|product|component/);
  const cMfr = col(/manufacturer|mfr|make|brand|supplier/);
  const cModel = col(/model|ref|code|catalog|article/);
  const cFin = col(/finish/);
  const cDoors = col(/^doors?$|door marks?|openings?/);
  const sets: SetFound[] = [];
  let cur: SetFound | null = null;
  for (const r of rows.slice(hi + 1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const code = cell(cSet);
    const first = (r.find((c) => c.trim()) ?? '').trim();
    const head = !code && SET_HEAD.exec(first);
    if (code && (!cur || normSet(code) !== normSet(cur.code))) { cur = { code, description: '', items: [], doors: [], source }; sets.push(cur); } else if (head && /\d/.test(head[1]) && !cell(cQty)) {
      cur = { code: head[1], description: head[2], items: [], doors: [], source }; sets.push(cur); continue;
    }
    if (!cur) continue;
    if (cell(cDoors)) cur.doors.push(...cell(cDoors).split(/[,;]\s*/).filter(Boolean));
    const q = Number(cell(cQty).replace(/[^\d.]/g, ''));
    if (!cell(cItem) || !q) continue;
    cur.items.push({ id: uid('hi'), catalogueId: '', item: cell(cItem), qty: q, basis: /per\s+leaf/i.test(r.join(' ')) ? 'per-leaf' : 'per-door', manufacturer: cell(cMfr), model: cell(cModel), finish: cell(cFin) });
  }
  return sets.length ? sets : null;
}

export function findHardware(docs: IntakeDoc[]): SetFound[] {
  const out: SetFound[] = [];
  for (const d of docs.filter((x) => x.role === 'hardware')) {
    let got: SetFound[] = [];
    if (d.kind !== 'pdf') for (const t of d.tables) got.push(...(setsFromTable(t.rows, `${d.name} / ${t.name}`) ?? []));
    if (!got.length) {
      // sets run over page breaks: read the pages as one stream without the repeating page header / footer lines
      const key = (l: Line) => l.cells.map((c) => c.s).join(' ').replace(/\d+/g, '#');
      const seen = new Map<string, number>();
      for (const pg of d.pages) for (const k of new Set(pg.map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
      const structural = (k: string) => /^(set|group|hw|hardware|ironmongery|heading)\b|^#|^(doors?|description)\s*:/i.test(k);
      const rep = d.pages.length >= 3 ? new Set([...seen].filter(([k, n]) => n >= Math.max(3, d.pages.length * 0.6) && !structural(k)).map(([k]) => k)) : new Set<string>();
      got = setsFromLines(d.pages.flatMap((pg) => pg.filter((l) => !rep.has(key(l)))), d.name);
    }
    // a set continued over a page break appears twice: merge by code
    const merged: SetFound[] = [];
    for (const s of got) {
      const m = merged.find((x) => normSet(x.code) === normSet(s.code));
      if (m) { m.items.push(...s.items); m.doors.push(...s.doors); if (!m.description) m.description = s.description; } else merged.push(s);
    }
    got = merged;
    out.push(...got);
  }
  return out;
}

// ---------- layouts ----------

const MARK_RE = /^(?=[A-Z0-9.\-\/]*\d)[A-Z]{0,4}[-.\/]?\d{1,4}(?:[-.\/]?[A-Z0-9]{1,4}){0,4}$/;

export function markFamily(mark: string): string {
  const m = /^([A-Z]*)(.*)$/.exec(mark.toUpperCase().trim())!;
  return m[1] + m[2].replace(/\d/g, '9').replace(/[A-Z]/g, 'A').replace(/[-.\/]?A+$/, '');
}

// T-32-025.A, T-32-025 A and T-32-025A are the same door
export const normMark = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/[.\-](?=[A-Z]{1,2}$)/, '');

export interface LayoutFound { doc: string; floor: string; marks: string[]; legendTotal: number | null; legendParts: { label: string; n: number }[] }

export function floorLabel(text: string): string {
  const m = /\b(?:level|lvl|floor|flr)[\s\-_]*([0-9]{1,3}|[A-Z]{1,2}\d?|ground|basement\s*\d*|mezzanine|roof)\b/i.exec(text) ?? /\b(ground|first|second|third|basement|mezzanine|roof)\s+floor\b/i.exec(text) ?? /(?:^|[\s_\-])L(\d{1,3})(?=[\s_\-.]|$)/.exec(text);
  if (!m) return '';
  const v = m[1];
  if (/^\d+$/.test(v)) return `Level ${Number(v)}`;
  return v.replace(/\b\w/g, (c) => c.toUpperCase()) + (/floor/i.test(m[0]) && !/level/i.test(m[0]) ? ' Floor' : '');
}

export function findLayouts(docs: IntakeDoc[], scheduleMarks: string[]): LayoutFound[] {
  const fams = new Set(scheduleMarks.map(markFamily));
  const known = new Set(scheduleMarks.map(normMark));
  return docs.filter((d) => d.role === 'layout').map((d) => {
    const tokens: string[] = [];
    const parts: { label: string; n: number }[] = [];
    let legendTotal: number | null = null;
    const head: string[] = [d.name];
    for (const pg of d.pages) for (const l of pg) {
      const t = l.cells.map((c) => c.s).join('  ');
      if (head.length < 40) head.push(t);
      // legend lines: "LEGEND - 46 DOORS", "60 MIN FIRE RATED - 5 Drs"
      for (const m of t.matchAll(/(?<![\d\-.\/])(\d{1,4})\s*(?:no\.?\s*)?(?:DOORS?|Doors?|doors?|DRS?\.?|Drs?\.?)(?![a-z])/g)) {
        if (/legend|total|summary/i.test(t)) legendTotal = Number(m[1]);
        else parts.push({ label: t.slice(0, m.index).replace(/[\s\-–:]+$/, '').trim(), n: Number(m[1]) });
      }
      const toks = t.toUpperCase().split(/[\s,;:()]+/);
      toks.forEach((tok, i) => {
        const k = tok.replace(/[.\-]+$/, '');
        if (k.length >= 3 && k.length <= 18 && MARK_RE.test(k)) {
          tokens.push(k);
          // "T-32-313 A": a suffix letter set apart from the mark
          if (/^[A-Z]$/.test(toks[i + 1] ?? '') && /\d$/.test(k)) tokens.push(k + toks[i + 1]);
        }
      });
    }
    let marks: string[];
    if (scheduleMarks.length) marks = tokens.filter((t) => known.has(t) || fams.has(markFamily(t)));
    else {
      // no schedule yet: keep the dominant mark families (letter prefix + digits, seen 3+ times)
      const count = new Map<string, number>();
      for (const t of tokens) if (/^[A-Z]/.test(t)) count.set(markFamily(t), (count.get(markFamily(t)) ?? 0) + 1);
      const top = [...count].filter(([, n]) => n >= 3).map(([f]) => f);
      marks = tokens.filter((t) => top.includes(markFamily(t)));
    }
    const uniq = parts.filter((p, i) => parts.findIndex((q) => q.label === p.label && q.n === p.n) === i);
    return { doc: d.name, floor: floorLabel(head.join(' ')), marks: [...new Set(marks)].sort(), legendTotal, legendParts: uniq };
  });
}

// ---------- cross-check ----------

export type Sev = 'error' | 'warning' | 'info' | 'ok';
export interface Finding { sev: Sev; area: 'Inputs' | 'Layouts' | 'Schedule' | 'Hardware' | 'Project'; text: string }

export interface CrossInput {
  docs: IntakeDoc[];
  schedule: { marks: string[]; sets: string[]; rows: number } | null;
  layouts: LayoutFound[];
  hardware: SetFound[];
  info: Info;
}

const list = (xs: string[], n = 12) => xs.slice(0, n).join(', ') + (xs.length > n ? ` … (+${xs.length - n})` : '');

export function crossCheck(x: CrossInput): Finding[] {
  const f: Finding[] = [];
  const has = (r: Role) => x.docs.some((d) => d.role === r);
  for (const r of ['layout', 'schedule', 'hardware'] as Role[]) if (!has(r)) f.push({ sev: 'warning', area: 'Inputs', text: `No ${r === 'layout' ? 'door layout' : r === 'schedule' ? 'master schedule' : 'hardware set'} file uploaded: the checks that need it are skipped.` });
  for (const d of x.docs) if (!d.textFound) f.push({ sev: d.kind === 'dwg' || d.needsAi ? 'warning' : 'error', area: 'Inputs', text: `${d.name}: ${d.notes[d.notes.length - 1] ?? 'nothing readable'}` });
  if (!x.info.name) f.push({ sev: 'warning', area: 'Project', text: 'Project name not found in the files: enter it before creating the project.' });

  if (has('schedule') && !x.schedule) f.push({ sev: 'error', area: 'Schedule', text: 'No door schedule table found (no header with a door mark / number column). Check the file or use Import schedule to map columns by hand.' });
  const sched = x.schedule;
  if (sched) {
    f.push({ sev: 'ok', area: 'Schedule', text: `${sched.marks.length} door marks read from ${sched.rows} schedule rows.` });
    const dup = sched.marks.filter((m, i) => sched.marks.indexOf(m) !== i);
    if (dup.length) f.push({ sev: 'warning', area: 'Schedule', text: `Duplicate marks in the schedule: ${list([...new Set(dup)])}.` });
  }

  if (sched && x.layouts.length) {
    const onPlans = new Set(x.layouts.flatMap((l) => l.marks.map(normMark)));
    const inSched = new Set(sched.marks.map(normMark));
    const missing = sched.marks.filter((m) => !onPlans.has(normMark(m)));
    const extra = [...onPlans].filter((m) => !inSched.has(m));
    const found = sched.marks.length - missing.length;
    f.push({ sev: missing.length ? 'warning' : 'ok', area: 'Layouts', text: `${found} of ${sched.marks.length} scheduled doors found on the layouts.${missing.length ? ` Not found: ${list(missing)}.` : ''}` });
    if (extra.length) f.push({ sev: 'warning', area: 'Layouts', text: `On the layouts but not in the schedule: ${list(extra)}.` });
    for (const l of x.layouts) {
      if (l.legendTotal !== null) {
        const sum = l.legendParts.reduce((a, p) => a + p.n, 0);
        // a complete layout is compared with the whole schedule, a floor-wise one with the marks read on it
        const whole = x.layouts.length === 1;
        const against = whole ? sched.marks.length : l.marks.length;
        f.push({ sev: l.legendTotal === against ? 'ok' : 'warning', area: 'Layouts', text: `${l.doc}: legend states ${l.legendTotal} doors; ${whole ? `the schedule has ${against}` : `${against} door marks read on this layout`}.` });
        if (l.legendParts.length && sum !== l.legendTotal) f.push({ sev: 'warning', area: 'Layouts', text: `${l.doc}: legend categories add up to ${sum}, not the stated ${l.legendTotal} (${l.legendParts.map((p) => `${p.label} ${p.n}`).join('; ')}).` });
        else if (l.legendParts.length) f.push({ sev: 'ok', area: 'Layouts', text: `${l.doc}: legend categories add up to the stated ${l.legendTotal}.` });
      }
    }
  } else if (x.layouts.length) {
    for (const l of x.layouts) f.push({ sev: 'info', area: 'Layouts', text: `${l.doc}: ${l.marks.length} door marks read${l.floor ? ` (${l.floor})` : ''}.` });
  }

  if (x.hardware.length) {
    f.push({ sev: 'ok', area: 'Hardware', text: `${x.hardware.length} hardware sets, ${x.hardware.reduce((a, s) => a + s.items.length, 0)} item lines read.` });
    const empty = x.hardware.filter((s) => !s.items.length).map((s) => s.code);
    if (empty.length) f.push({ sev: 'warning', area: 'Hardware', text: `Sets with no item lines read: ${list(empty)}.` });
  }
  if (sched && x.hardware.length) {
    const codes = new Set(x.hardware.map((s) => normSet(s.code)));
    const viaLists = x.hardware.filter((s) => s.doors.some((d) => sched.marks.some((m) => normMark(m) === normMark(d)))).map((s) => s.code);
    const used = [...new Set([...sched.sets.filter(Boolean), ...viaLists])];
    const undefinedSets = used.filter((c) => !codes.has(normSet(c)));
    const unused = x.hardware.filter((s) => !used.some((c) => normSet(c) === normSet(s.code))).map((s) => s.code);
    if (undefinedSets.length) f.push({ sev: 'warning', area: 'Hardware', text: `Sets used in the schedule but not defined in the hardware file: ${list(undefinedSets)}.` });
    if (unused.length) f.push({ sev: 'info', area: 'Hardware', text: `Sets defined but not used by any scheduled door: ${list(unused)}.` });
    if (!undefinedSets.length && used.length) f.push({ sev: 'ok', area: 'Hardware', text: `All ${used.length} hardware sets used in the schedule are defined.` });
    const inSched = new Set(sched.marks.map(normMark));
    const listed = x.hardware.flatMap((s) => s.doors.map(normMark)).filter((m) => MARK_RE.test(m));
    const covered = sched.marks.filter((m) => listed.includes(normMark(m)));
    if (listed.length) f.push({ sev: covered.length === sched.marks.length ? 'ok' : 'info', area: 'Hardware', text: `${covered.length} of ${sched.marks.length} scheduled doors are listed against a hardware set in the hardware file.` });
    const conflicts = sched.marks.map((m, i) => ({ m, set: sched.sets[i] })).filter((r) => r.set).flatMap((r) => {
      const hs = x.hardware.find((s) => s.doors.some((d) => normMark(d) === normMark(r.m)));
      return hs && normSet(hs.code) !== normSet(r.set) ? [`${r.m}: schedule ${r.set}, hardware file ${hs.code}`] : [];
    });
    if (conflicts.length) f.push({ sev: 'warning', area: 'Hardware', text: `Hardware set differs between schedule and hardware file: ${list(conflicts, 8)}.` });
    const notInSched = [...new Set(x.hardware.flatMap((s) => s.doors).filter((m) => MARK_RE.test(normMark(m)) && !inSched.has(normMark(m))))];
    if (listed.length && notInSched.length) f.push({ sev: 'info', area: 'Hardware', text: `Doors listed against hardware sets but not in the schedule: ${list(notInSched)}.` });
  } else if (sched && has('hardware') && !x.hardware.length) f.push({ sev: 'warning', area: 'Hardware', text: 'No hardware sets recognised in the hardware file (expected "Set: …" / "Hardware set …" headings with quantity lines, or a table with Set / Qty / Item columns).' });
  return f;
}

// ---------- build the project ----------

export interface IntakeResult { project: Project; report: ImportReport | null }

export function buildProject(info: Record<InfoKey, string>, sched: ScheduleFound | null, sets: SetFound[], layouts: LayoutFound[]): IntakeResult {
  let p = blankProject(info.name || 'New project');
  p = { ...p, number: info.number, client: info.client, consultant: info.consultant, location: info.location, revision: info.revision || p.revision, date: info.date || p.date };
  // hardware sets take the schedule's spelling of the code when they match
  const schedSets = sched ? (() => { const c = sched.mapping.indexOf('hardwareSet'); return c < 0 ? [] : [...new Set(sched.rows.slice(sched.headerRow + 1).map((r) => (r[c] ?? '').trim()).filter(Boolean))]; })() : [];
  p.hardwareSets = sets.map((s) => ({ code: schedSets.find((c) => normSet(c) === normSet(s.code)) ?? s.code, description: s.description, items: s.items }));
  let report: ImportReport | null = null;
  if (sched) {
    const r = importRows(p, sched.rows, { fileName: sched.source, sheetName: '', headerRow: sched.headerRow, mapping: sched.mapping, units: 'auto', buildingId: p.buildings[0].id, defaultFloorId: p.floors[0].id, existing: 'skip' });
    p = r.project;
    report = r.report;
    // no floor column: place doors by the floor-wise layout they were found on
    if (!sched.mapping.includes('floor')) {
      const byMark = new Map<string, string>();
      for (const l of layouts) if (l.floor) for (const m of l.marks) byMark.set(normMark(m), byMark.has(normMark(m)) && byMark.get(normMark(m)) !== l.floor ? '' : l.floor);
      const floors = [...new Set([...byMark.values()].filter(Boolean))];
      if (floors.length) {
        const ids = new Map(floors.map((name, i) => [name, { id: uid('flr'), buildingId: p.buildings[0].id, name, order: i + 1 }]));
        p.floors = [...p.floors, ...ids.values()];
        p.doors = p.doors.map((d) => { const fl = byMark.get(normMark(d.mark)); return fl ? { ...d, floorId: ids.get(fl)!.id } : d; });
      }
    }
    // no set column: take the set from the hardware file's "Doors:" lists
    const setOf = new Map<string, string>();
    for (const st of p.hardwareSets) for (const m of sets.find((x) => x.code === st.code || normSet(x.code) === normSet(st.code))?.doors ?? []) setOf.set(normMark(m), st.code);
    if (setOf.size) p.doors = p.doors.map((d) => (d.hardwareSet || !setOf.has(normMark(d.mark)) ? d : { ...d, hardwareSet: setOf.get(normMark(d.mark))! }));
    p.floors = p.floors.filter((fl) => p.doors.some((d) => d.floorId === fl.id) || p.floors.length === 1);
    // a single default floor takes the level named in the project title ("… Level 32 …")
    if (p.floors.length === 1 && p.floors[0].name === 'Ground Floor' && floorLabel(p.name)) p.floors = [{ ...p.floors[0], name: floorLabel(p.name) }];
    if (!p.floors.length) p.floors = blankProject().floors.map((fl) => ({ ...fl, buildingId: p.buildings[0].id }));
  }
  return { project: p, report };
}

export function scheduleMarks(s: ScheduleFound): { marks: string[]; sets: string[]; rows: number } {
  const body = s.rows.slice(s.headerRow + 1).filter((r) => r.some((c) => c.trim()));
  const cm = s.mapping.indexOf('mark'), cs = s.mapping.indexOf('hardwareSet');
  const marks = body.map((r) => (r[cm] ?? '').trim()).filter(Boolean).filter((m) => !/^(sub\s*)?total/i.test(m));
  return { marks, sets: cs < 0 ? [] : body.map((r) => (r[cs] ?? '').trim()), rows: body.length };
}
