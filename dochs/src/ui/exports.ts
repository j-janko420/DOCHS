import type { Door, Project } from '../core/types.js';
import { allClassifications, buildingName, floorName } from '../core/classify.js';
import { doorSchedule, hardwareTable, issuesTable, productTable, quantitySummary } from '../core/schedule.js';
import { toCsv, xlsx, zip, type ZipEntry } from '../core/export.js';
import { drawable } from '../core/validate.js';
import { exportProject } from '../core/project-ops.js';
import { materialSchedule } from '../core/materials.js';
import { composeSet, composeSheet, type Sheet } from '../cad/sheet.js';
import { toDxf } from '../cad/dxf.js';
import { toPdf, type PdfPageSpec } from '../cad/pdf.js';
import { download, safeName, toast } from './dom.js';
import { ui } from './state.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function scopeLabel(p: Project): string {
  const f = ui.filter;
  const parts = [f.buildingId ? buildingName(p, f.buildingId) : '', f.floorId ? floorName(p, f.floorId) : 'All floors'];
  const cls = allClassifications(p);
  for (const k of f.categoryKeys ?? []) parts.push(cls.find((c) => c.key === k)?.label ?? k);
  if (f.status) parts.push(f.status);
  if (f.search) parts.push(`"${f.search}"`);
  return parts.filter(Boolean).join(' - ');
}

export function sheetFor(p: Project, d: Door): Sheet {
  return composeSheet(p, d, { size: ui.sheetSize, mainScale: ui.mainScale || undefined, titleBlock: p.titleBlock });
}

export function doorDxf(p: Project, d: Door): string {
  const s = sheetFor(p, d);
  return toDxf(s.entities, { ltscale: s.S, title: s.drawingNo });
}

export function exportDoorDxf(p: Project, d: Door) {
  const gate = drawable(d, p);
  if (!gate.ok) { toast(`${d.mark}: ${gate.errors.length} error(s) block DXF export. See QA.`, 'err'); return; }
  const s = sheetFor(p, d);
  download(`${safeName(s.drawingNo)}.dxf`, toDxf(s.entities, { ltscale: s.S, title: s.drawingNo }), 'application/dxf');
  toast(`DXF exported: ${s.drawingNo}`, 'ok');
}

function split(p: Project, doors: Door[]) {
  const ok: Door[] = [];
  const blocked: { d: Door; reasons: string[] }[] = [];
  for (const d of doors) {
    const g = drawable(d, p);
    if (g.ok) ok.push(d); else blocked.push({ d, reasons: g.errors.map((e) => `${e.ruleId} ${e.message}`) });
  }
  return { ok, blocked };
}

export function setDxf(p: Project, doors: Door[]): { dxf: string; ok: Door[]; blocked: { d: Door; reasons: string[] }[] } {
  const { ok, blocked } = split(p, doors);
  const sheets = ok.map((d) => sheetFor(p, d));
  const dxf = toDxf(composeSet(sheets), { ltscale: Math.max(...sheets.map((s) => s.S), 1), title: scopeLabel(p) });
  return { dxf, ok, blocked };
}

const pdfPage = (s: Sheet): PdfPageSpec => ({ entities: s.entities, paper: s.paper, S: s.S });

export function sheetPdf(p: Project, doors: Door[]): { bytes: Uint8Array; ok: Door[]; blocked: { d: Door; reasons: string[] }[] } {
  const { ok, blocked } = split(p, doors);
  return { bytes: ok.length ? toPdf(ok.map((d) => pdfPage(sheetFor(p, d))), { title: `${p.name} - door drawings`, author: p.preparedBy }) : new Uint8Array(), ok, blocked };
}

export function exportDoorPdf(p: Project, d: Door) {
  const gate = drawable(d, p);
  if (!gate.ok) { toast(`${d.mark}: ${gate.errors.length} error(s) block issue. See QA.`, 'err'); return; }
  const s = sheetFor(p, d);
  download(`${safeName(s.drawingNo)}.pdf`, toPdf([pdfPage(s)], { title: s.drawingNo, author: p.preparedBy }), 'application/pdf');
  toast(`PDF exported: ${s.drawingNo} (${s.size}, true scale)`, 'ok');
}

export function exportSetPdf(p: Project, doors: Door[]) {
  const r = sheetPdf(p, doors);
  if (!r.ok.length) { toast('No drawable doors in scope (all have errors)', 'err'); return; }
  download(`${safeName(p.name)}_${safeName(scopeLabel(p))}_drawings.pdf`, r.bytes, 'application/pdf');
  toast(`Drawing set PDF: ${r.ok.length} sheets${r.blocked.length ? `, ${r.blocked.length} withheld` : ''}`, 'ok');
}

export function scheduleTables(p: Project, doors: Door[]) {
  return [doorSchedule(p, doors), quantitySummary(p, doors), hardwareTable(p, doors), productTable(p, doors), materialSchedule(p, doors), issuesTable(p, doors)];
}

export function exportXlsx(p: Project, doors: Door[]) {
  download(`${safeName(p.name)}_${safeName(scopeLabel(p))}_schedule.xlsx`, xlsx(scheduleTables(p, doors)), XLSX);
  toast('Excel schedule exported', 'ok');
}

export function exportCsv(p: Project, doors: Door[], which: number) {
  const t = scheduleTables(p, doors)[which];
  download(`${safeName(p.name)}_${safeName(t.name)}.csv`, toCsv(t), 'text/csv');
}

export function buildPackage(p: Project, doors: Door[]): { bytes: Uint8Array; ok: Door[]; blocked: { d: Door; reasons: string[] }[] } {
  const scope = scopeLabel(p);
  const root = `${safeName(p.name)}_${safeName(scope)}`;
  const tables = scheduleTables(p, doors);
  const { dxf, ok, blocked } = doors.length ? setDxf(p, doors) : { dxf: '', ok: [], blocked: [] };
  const entries: ZipEntry[] = [
    { name: `${root}/schedule.xlsx`, data: xlsx(tables) },
    ...tables.map((t) => ({ name: `${root}/${safeName(t.name)}.csv`, data: toCsv(t) })),
  ];
  for (const d of ok) {
    const s = sheetFor(p, d);
    entries.push({ name: `${root}/dxf/${safeName(s.drawingNo)}.dxf`, data: toDxf(s.entities, { ltscale: s.S, title: s.drawingNo }) });
  }
  if (ok.length) {
    entries.push({ name: `${root}/${safeName(scope)}_SET.dxf`, data: dxf });
    entries.push({ name: `${root}/${safeName(scope)}_drawings.pdf`, data: toPdf(ok.map((d) => pdfPage(sheetFor(p, d))), { title: `${p.name} - door drawings`, author: p.preparedBy }) });
  }
  entries.push({ name: `${root}/project-backup.json`, data: exportProject(p) });
  entries.push({
    name: `${root}/MANIFEST.txt`,
    data: [
      'DORSCH - Door Schedule Solutions: issue package (Designed by i3 Design)',
      `Project: ${p.name} ${p.number}`.trim(),
      `Revision: ${p.revision}   Date: ${p.date}   Status: ${p.status}`,
      `Scope: ${scope}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      `Doors in scope: ${doors.length}`,
      `Drawings issued (DXF R12 + PDF, mm, sheet ${ui.sheetSize}${p.titleBlock ? `, title block ${p.titleBlock.name}` : ''}): ${ok.length}`,
      `Unverified hardware products in scope: ${productTable(p, doors).rows.filter((r) => r[5] === 'No').length}`,
      ...ok.map((d) => `  ${d.mark}  ${floorName(p, d.floorId)}  ${d.status}`),
      `Drawings withheld (hard errors): ${blocked.length}`,
      ...blocked.map((b) => `  ${b.d.mark}: ${b.reasons.join('; ')}`),
      '',
      'Notes: DXF files are editable CAD (AutoCAD R12 / AC1009, units mm). Schedules come from the same',
      'door records as the drawings. DWG is not produced. Compliance (fire, acoustic, access, egress)',
      'is not assessed by DORSCH and must be confirmed by the responsible consultants.',
      p.isSample ? '\nWARNING: built from SAMPLE DATA, not project data.' : '',
    ].join('\r\n'),
  });
  return { bytes: zip(entries), ok, blocked };
}

export function exportPackage(p: Project, doors: Door[]) {
  if (!doors.length) { toast('No doors in the current filter', 'err'); return; }
  const r = buildPackage(p, doors);
  download(`${safeName(p.name)}_${safeName(scopeLabel(p))}_package.zip`, r.bytes, 'application/zip');
  toast(`Package exported: ${r.ok.length} drawings${r.blocked.length ? `, ${r.blocked.length} withheld (errors)` : ''}`, r.blocked.length ? 'info' : 'ok');
}
