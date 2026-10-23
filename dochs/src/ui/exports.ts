import type { Door, Project } from '../core/types.js';
import { allClassifications, buildingName, floorName } from '../core/classify.js';
import { doorSchedule, hardwareTable, issuesTable, quantitySummary } from '../core/schedule.js';
import { toCsv, xlsx, zip, type ZipEntry } from '../core/export.js';
import { drawable } from '../core/validate.js';
import { exportProject } from '../core/project-ops.js';
import { composeSet, composeSheet, type Sheet } from '../cad/sheet.js';
import { toDxf } from '../cad/dxf.js';
import { toSvg } from '../cad/svg.js';
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
  return composeSheet(p, d, { size: ui.sheetSize, mainScale: ui.mainScale || undefined });
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

export function scheduleTables(p: Project, doors: Door[]) {
  return [doorSchedule(p, doors), quantitySummary(p, doors), hardwareTable(p, doors), issuesTable(p, doors)];
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
  if (ok.length) entries.push({ name: `${root}/${safeName(scope)}_SET.dxf`, data: dxf });
  entries.push({ name: `${root}/project-backup.json`, data: exportProject(p) });
  entries.push({
    name: `${root}/MANIFEST.txt`,
    data: [
      'DOCHS - DoorChisolution issue package',
      `Project: ${p.name} ${p.number}`.trim(),
      `Revision: ${p.revision}   Date: ${p.date}   Status: ${p.status}`,
      `Scope: ${scope}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      `Doors in scope: ${doors.length}`,
      `Drawings issued (DXF R12, mm, sheet ${ui.sheetSize}): ${ok.length}`,
      ...ok.map((d) => `  ${d.mark}  ${floorName(p, d.floorId)}  ${d.status}`),
      `Drawings withheld (hard errors): ${blocked.length}`,
      ...blocked.map((b) => `  ${b.d.mark}: ${b.reasons.join('; ')}`),
      '',
      'Notes: DXF files are editable CAD (AutoCAD R12 / AC1009, units mm). Schedules come from the same',
      'door records as the drawings. DWG is not produced. Compliance (fire, acoustic, access, egress)',
      'is not assessed by DOCHS and must be confirmed by the responsible consultants.',
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

export function printSheet(p: Project, d: Door) {
  const s = sheetFor(p, d);
  const svg = toSvg(s.entities, { width: s.paper[0] * s.S, height: s.paper[1] * s.S, S: s.S, paperMm: s.paper, background: '#ffffff' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${s.drawingNo}</title><style>@page{size:${s.paper[0]}mm ${s.paper[1]}mm;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${svg}<script>window.onload=()=>{setTimeout(()=>window.print(),200)}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    download(`${safeName(s.drawingNo)}.svg`, svg, 'image/svg+xml');
    toast('Pop-up blocked: downloaded the sheet as SVG instead', 'info');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
