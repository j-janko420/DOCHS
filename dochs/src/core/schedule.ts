import type { Door, Project } from './types.js';
import { CONFIG_LABEL, leafCount } from './types.js';
import { buildingName, classify, floorName, isRated } from './classify.js';
import { frameFit } from './geometry.js';
import { counts, validateDoor } from './validate.js';

export type Cell = string | number;
export interface Table {
  name: string;
  columns: string[];
  rows: Cell[][];
}

const v = (x: number | null) => (x == null ? '' : x);

export function drawingNumber(p: Project, d: Door): string {
  return `${p.drawingPrefix || 'DR'}-${d.mark || d.id}`;
}

export const SCHEDULE_COLUMNS = [
  'Door mark', 'Building', 'Floor', 'Room', 'Location', 'Door type', 'Configuration', 'Handing', 'Qty', 'Leaves',
  'S.O. width', 'S.O. height', 'Leaf 1 width', 'Leaf 2 width', 'Leaf height', 'Leaf thickness', 'Clear width (nominal)',
  'Leaf material', 'Core', 'Finish side 1', 'Finish side 2', 'Frame material', 'Frame finish', 'Frame profile',
  'Fire rating', 'Acoustic rating', 'Smoke seal', 'Vision panel', 'Kick plate', 'Access control', 'Hardware set',
  'Threshold', 'Classifications', 'Status', 'Errors', 'Warnings', 'Drawing no.', 'Source ref', 'Remarks',
];

export function scheduleRow(p: Project, d: Door): Cell[] {
  const fit = frameFit(d);
  const c = counts(validateDoor(d, p));
  const yn = (b: boolean) => (b ? 'Yes' : 'No');
  return [
    d.mark, buildingName(p, d.buildingId), floorName(p, d.floorId), d.room, d.location, d.doorType,
    d.configuration ? CONFIG_LABEL[d.configuration] : '', d.handing, v(d.quantity), d.configuration ? leafCount(d.configuration) : '',
    v(d.openingWidth), v(d.openingHeight), v(d.leafWidth1), leafCount(d.configuration) === 2 ? v(d.leafWidth2) : '', v(d.leafHeight), v(d.leafThickness),
    fit.complete && d.leafThickness != null && leafCount(d.configuration) === 1 ? fit.nominalClearWidth : '',
    d.leafMaterial, d.leafCore, d.finishSide1, d.finishSide2, d.frameMaterial, d.frameFinish, d.frameProfile,
    d.fireRating, d.acousticRating, yn(d.smokeSeal),
    d.visionPanel ? `${v(d.vpWidth)}x${v(d.vpHeight)}` : 'No', d.kickPlate ? `${v(d.kickPlateHeight)} high` : 'No', yn(d.accessControl), d.hardwareSet,
    d.threshold, classify(d, p).map((x) => x.label).join('; '), d.status, c.error, c.warning, drawingNumber(p, d), d.sourceRef, d.remarks,
  ];
}

export function doorSchedule(p: Project, doors: Door[]): Table {
  return { name: 'Door Schedule', columns: SCHEDULE_COLUMNS, rows: doors.map((d) => scheduleRow(p, d)) };
}

const qty = (d: Door) => d.quantity ?? 0;

export function quantitySummary(p: Project, doors: Door[]): Table {
  const rows: Cell[][] = [];
  const floors = [...new Set(doors.map((d) => d.floorId))];
  for (const fid of floors) {
    const fd = doors.filter((d) => d.floorId === fid);
    const configs = [...new Set(fd.map((d) => d.configuration))];
    for (const c of configs) {
      const cd = fd.filter((d) => d.configuration === c);
      rows.push([
        floorName(p, fid) || '(unassigned)',
        c ? CONFIG_LABEL[c] : '(unspecified)',
        cd.length,
        cd.reduce((s, d) => s + qty(d), 0),
        cd.reduce((s, d) => s + qty(d) * (c ? leafCount(c) : 0), 0),
        cd.filter((d) => isRated(d.fireRating)).reduce((s, d) => s + qty(d), 0),
        cd.filter((d) => isRated(d.acousticRating)).reduce((s, d) => s + qty(d), 0),
      ]);
    }
  }
  rows.push(['TOTAL', '', doors.length, doors.reduce((s, d) => s + qty(d), 0), doors.reduce((s, d) => s + qty(d) * (d.configuration ? leafCount(d.configuration) : 0), 0),
    doors.filter((d) => isRated(d.fireRating)).reduce((s, d) => s + qty(d), 0), doors.filter((d) => isRated(d.acousticRating)).reduce((s, d) => s + qty(d), 0)]);
  return { name: 'Quantity Summary', columns: ['Floor', 'Configuration', 'Door records', 'Door qty', 'Leaves', 'Fire-rated qty', 'Acoustic qty'], rows };
}

export interface TakeoffLine {
  set: string;
  item: string;
  manufacturer: string;
  model: string;
  finish: string;
  quantity: number;
  basis: string;
  doors: string[];
}

// Hardware quantities: per-door items x door qty; per-leaf items x door qty x leaves.
export function hardwareTakeoff(p: Project, doors: Door[]): { lines: TakeoffLine[]; unresolved: string[] } {
  const lines: TakeoffLine[] = [];
  const unresolved: string[] = [];
  const bySet = new Map<string, Door[]>();
  for (const d of doors) {
    const k = d.hardwareSet.trim();
    if (!k) { unresolved.push(`${d.mark}: no hardware set`); continue; }
    if (!p.hardwareSets.some((h) => h.code === k)) { unresolved.push(`${d.mark}: set ${k} not in library`); continue; }
    bySet.set(k, [...(bySet.get(k) ?? []), d]);
  }
  for (const [code, ds] of bySet) {
    const set = p.hardwareSets.find((h) => h.code === code)!;
    for (const it of set.items) {
      let total = 0;
      const parts: string[] = [];
      for (const d of ds) {
        const leaves = d.configuration ? leafCount(d.configuration) : 1;
        const q = it.basis === 'per-leaf' ? it.qty * qty(d) * leaves : it.qty * qty(d);
        total += q;
        parts.push(it.basis === 'per-leaf' ? `${d.mark}: ${it.qty}x${qty(d)}x${leaves}L` : `${d.mark}: ${it.qty}x${qty(d)}`);
      }
      lines.push({ set: code, item: it.item, manufacturer: it.manufacturer, model: it.model, finish: it.finish, quantity: total, basis: `${it.qty} ${it.basis} | ${parts.join(', ')}`, doors: ds.map((d) => d.mark) });
    }
  }
  return { lines, unresolved };
}

export function hardwareTable(p: Project, doors: Door[]): Table {
  const { lines, unresolved } = hardwareTakeoff(p, doors);
  const rows: Cell[][] = lines.map((l) => [l.set, l.item, l.manufacturer, l.model, l.finish, l.quantity, l.basis]);
  for (const u of unresolved) rows.push(['UNRESOLVED', u, '', '', '', '', '']);
  return { name: 'Hardware Takeoff', columns: ['Set', 'Item', 'Manufacturer', 'Model', 'Finish', 'Quantity', 'Calculation basis'], rows };
}

export function issuesTable(p: Project, doors: Door[]): Table {
  const rows: Cell[][] = [];
  for (const d of doors) for (const i of validateDoor(d, p)) rows.push([i.mark, floorName(p, d.floorId), i.severity, i.ruleId, i.message, i.check, i.source, i.action]);
  return { name: 'QA Issues', columns: ['Door', 'Floor', 'Severity', 'Rule', 'Message', 'Check', 'Source', 'Action'], rows };
}
