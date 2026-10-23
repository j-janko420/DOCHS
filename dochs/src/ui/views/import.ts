import { readXlsx, type Sheet } from '../../core/xlsx-read.js';
import { TARGETS, autoMapping, csvRows, findHeaderRow, importRows, mergeMapping, type ImportReport, type Target, type Units } from '../../core/importer.js';
import { toCsv } from '../../core/export.js';
import { CONFIG_LABEL } from '../../core/types.js';
import { floorName } from '../../core/classify.js';
import { download, h, safeName, toast } from '../dom.js';
import { project, setProject, setUi } from '../state.js';
import { aiServer, suggestMapping } from '../ai.js';

let aiBusy = false;
let aiNotes: string[] = [];

// Upload a door schedule (xlsx / csv), check the column matching, preview, import.

interface ImportState {
  fileName: string;
  sheets: Sheet[];
  sheet: number;
  headerRow: number;
  mapping: Target[];
  units: Units;
  floorId: string;
  existing: 'skip' | 'update';
  report: ImportReport | null;
}

let st: ImportState | null = null;

function selectSheet(i: number) {
  if (!st) return;
  const rows = st.sheets[i].rows;
  const hr = Math.max(0, findHeaderRow(rows));
  st = { ...st, sheet: i, headerRow: hr, mapping: autoMapping(rows[hr] ?? []), report: null };
}

async function load(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let sheets: Sheet[];
  try {
    sheets = /\.csv$/i.test(file.name) ? [{ name: file.name.replace(/\.csv$/i, ''), rows: csvRows(new TextDecoder().decode(buf)) }] : await readXlsx(buf);
  } catch (e) { toast((e as Error).message, 'err'); return; }
  if (!sheets.length) { toast('No sheets found in the file', 'err'); return; }
  const p = project();
  st = { fileName: file.name, sheets, sheet: 0, headerRow: 0, mapping: [], units: 'auto', floorId: p.floors.slice().sort((a, b) => a.order - b.order)[0]?.id ?? '', existing: 'skip', report: null };
  // start on the sheet whose header matches best
  let best = 0, score = -1;
  sheets.forEach((s, i) => { const hr = findHeaderRow(s.rows); const n = hr >= 0 ? autoMapping(s.rows[hr]).filter(Boolean).length : 0; if (n > score) { score = n; best = i; } });
  selectSheet(best);
  aiNotes = [];
  setUi({});
}

function options() {
  const p = project();
  const floor = p.floors.find((f) => f.id === st!.floorId) ?? p.floors[0];
  return { fileName: st!.fileName, sheetName: st!.sheets[st!.sheet].name, headerRow: st!.headerRow, mapping: st!.mapping, units: st!.units, buildingId: floor?.buildingId ?? p.buildings[0]?.id ?? '', defaultFloorId: floor?.id ?? '', existing: st!.existing };
}

function reportView(r: ImportReport, title: string): HTMLElement {
  const ok = r.dataRows === r.imported + r.updated + r.skipped.length;
  return h('section', { class: 'card' }, h('h3', {}, title),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, String(r.dataRows)), h('span', {}, 'Data rows in file')),
      h('div', { class: 'kpi' }, h('b', {}, String(r.imported)), h('span', {}, 'New doors')),
      h('div', { class: 'kpi' }, h('b', {}, String(r.updated)), h('span', {}, 'Updated doors')),
      h('div', { class: `kpi ${r.skipped.length ? 'sev-warning' : ''}` }, h('b', {}, String(r.skipped.length)), h('span', {}, 'Skipped (with reason)')),
      h('div', { class: `kpi ${r.warnings.length ? 'sev-warning' : ''}` }, h('b', {}, String(r.warnings.length)), h('span', {}, 'Row warnings'))),
    h('p', { class: ok ? 'ok-text' : 'alert err' }, ok ? `Reconciled: ${r.imported} + ${r.updated} + ${r.skipped.length} = ${r.dataRows} rows. No row is lost silently.` : 'Row count does not reconcile.'),
    r.notes.map((n) => h('div', { class: 'alert info' }, n)),
    r.createdFloors.length ? h('p', {}, h('b', {}, 'New floors: '), r.createdFloors.join(', ')) : null,
    r.unmapped.length ? h('p', { class: 'muted small' }, `Columns not imported: ${r.unmapped.join(', ')}`) : null,
    r.skipped.length || r.warnings.length ? h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
      h('thead', {}, h('tr', {}, ['Row', 'Mark', 'Type', 'Detail'].map((x) => h('th', {}, x)))),
      h('tbody', {}, [...r.skipped.map((s) => ({ ...s, kind: 'Skipped' })), ...r.warnings.map((w) => ({ ...w, kind: 'Warning' }))].sort((a, b) => a.row - b.row).map((x) =>
        h('tr', {}, h('td', { class: 'num' }, String(x.row)), h('td', { class: 'mono' }, x.mark || '-'), h('td', {}, h('span', { class: `badge ${x.kind === 'Skipped' ? 'sev-warning' : 'sev-info'}` }, x.kind)), h('td', { class: 'small' }, x.text)))))) : null,
    h('button', { class: 'btn sm', onclick: () => download(`${safeName(r === st?.report ? st.fileName : 'import')}_import_report.csv`, toCsv({ name: 'Import report', columns: ['Row', 'Mark', 'Type', 'Detail'], rows: [...r.skipped.map((s) => [s.row, s.mark, 'Skipped', s.text]), ...r.warnings.map((w) => [w.row, w.mark, 'Warning', w.text])] }), 'text/csv') }, 'Download report (CSV)'));
}

export function importView(): HTMLElement {
  const p = project();
  const file = h('input', { type: 'file', accept: '.xlsx,.csv', class: 'hidden', onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void load(f); } }) as HTMLInputElement;
  const head = h('div', { class: 'view-head' },
    h('div', {}, h('h1', {}, 'Import door schedule'), h('p', { class: 'muted' }, 'Upload an Excel (.xlsx) or CSV door schedule. Columns are matched automatically; check them, preview, then import. The file is read in your browser and is not uploaded anywhere.')),
    h('div', { class: 'row gap' }, h('button', { class: 'btn primary', onclick: () => file.click() }, st ? 'Choose another file' : 'Choose file'), file));
  if (!st) {
    return h('div', { class: 'view' }, head,
      h('div', { class: 'card empty dropzone', ondragover: (e: DragEvent) => e.preventDefault(), ondrop: (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void load(f); } },
        h('p', {}, h('b', {}, 'Drop a .xlsx or .csv door schedule here'), ' or use Choose file.'),
        h('p', { class: 'muted small' }, 'Minimum: one column with the door number. Recognised columns include type, quantity, level, location, from / to room, single/double/sliding, number of leaves, fire rating, acoustic rating, widths and heights (mm, inches or feet-inches), material, finish, hardware set, drawing reference and remarks.')));
  }
  const sheet = st.sheets[st.sheet];
  const rows = sheet.rows;
  const header = rows[st.headerRow] ?? [];
  const samples = (c: number) => rows.slice(st!.headerRow + 1).map((r) => (r[c] ?? '').trim()).filter(Boolean).slice(0, 3).join(' | ');
  const markMapped = st.mapping.includes('mark');
  let preview: { project: typeof p; report: ImportReport } | null = null;
  let error = '';
  if (markMapped) { try { preview = importRows(p, rows, options()); } catch (e) { error = (e as Error).message; } }
  const newDoors = preview ? preview.project.doors.filter((d) => !p.doors.some((x) => x.id === d.id)).slice(0, 12) : [];
  const set = (patch: Partial<ImportState>) => { st = { ...st!, ...patch, report: null }; setUi({}); };
  return h('div', { class: 'view' }, head,
    h('section', { class: 'card' }, h('h3', {}, `1. File: ${st.fileName}`),
      h('div', { class: 'row gap' },
        h('label', { class: 'fld inline' }, h('span', {}, 'Sheet'), h('select', { id: 'imp-sheet', onchange: (e: Event) => { selectSheet(Number((e.target as HTMLSelectElement).value)); setUi({}); } },
          st.sheets.map((s, i) => h('option', { value: String(i), selected: i === st!.sheet }, `${s.name} (${s.rows.length} rows)`)))),
        h('label', { class: 'fld inline' }, h('span', {}, 'Header row'), h('select', { id: 'imp-hr', onchange: (e: Event) => { const hr = Number((e.target as HTMLSelectElement).value); set({ headerRow: hr, mapping: autoMapping(rows[hr] ?? []) }); } },
          rows.slice(0, 20).map((r, i) => h('option', { value: String(i), selected: i === st!.headerRow }, `Row ${i + 1}: ${r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60)}`)))))),
    h('section', { class: 'card' }, h('div', { class: 'row gap' }, h('h3', { class: 'grow' }, '2. Column matching'),
        aiServer() ? h('button', { class: 'btn sm', disabled: aiBusy, title: 'Ask the DOCHS AI server to suggest the matching; you review it before importing', onclick: async () => {
          const srv = aiServer();
          if (!srv || !st) return;
          aiBusy = true; setUi({});
          try {
            const r = await suggestMapping(srv, header, rows.slice(st.headerRow + 1).filter((x) => x.some((c) => c.trim())).slice(0, 5));
            const before = st.mapping;
            const merged = mergeMapping(st.mapping, r.mapping);
            st = { ...st, mapping: merged, report: null };
            aiNotes = r.notes;
            const changed = merged.filter((m, i) => m !== (before[i] ?? '')).length;
            toast(`AI suggestion applied: ${changed} column(s) changed. Review before importing.`, 'ok');
          } catch (e) { toast(`AI suggestion failed: ${(e as Error).message}`, 'err'); }
          aiBusy = false; setUi({});
        } }, aiBusy ? 'Asking AI...' : 'AI suggest') : h('span', { class: 'muted small' }, 'AI suggestions: connect a DOCHS server under Project data')),
      markMapped ? null : h('div', { class: 'alert warn' }, 'Choose which column holds the door number.'),
      aiNotes.length ? h('div', { class: 'alert info' }, h('b', {}, 'AI notes: '), aiNotes.join(' ')) : null,
      h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense edit' },
        h('thead', {}, h('tr', {}, ['Column in file', 'Sample values', 'Import as'].map((x) => h('th', {}, x)))),
        h('tbody', {}, header.map((col, i) => h('tr', { class: st!.mapping[i] ? '' : 'muted-row' },
          h('td', {}, h('b', {}, col || `(column ${i + 1})`)), h('td', { class: 'small' }, samples(i)),
          h('td', {}, h('select', { id: `imp-map-${i}`, onchange: (e: Event) => { const m = [...st!.mapping]; m[i] = (e.target as HTMLSelectElement).value as Target; set({ mapping: m }); } },
            TARGETS.map((t) => h('option', { value: t.key, selected: (st!.mapping[i] ?? '') === t.key }, t.label)))))))))),
    h('section', { class: 'card' }, h('h3', {}, '3. Options'),
      h('div', { class: 'row gap' },
        h('label', { class: 'fld inline' }, h('span', {}, st.mapping.includes('floor') ? 'Floor when blank' : 'Import to floor'), h('select', { id: 'imp-floor', onchange: (e: Event) => set({ floorId: (e.target as HTMLSelectElement).value }) },
          p.floors.slice().sort((a, b) => a.order - b.order).map((f) => h('option', { value: f.id, selected: f.id === st!.floorId }, floorName(p, f.id))))),
        h('label', { class: 'fld inline' }, h('span', {}, 'Size units'), h('select', { id: 'imp-units', onchange: (e: Event) => set({ units: (e.target as HTMLSelectElement).value as Units }) },
          h('option', { value: 'auto', selected: st.units === 'auto' }, 'Auto (mm; inches if marked " or all values <= 150)'), h('option', { value: 'mm', selected: st.units === 'mm' }, 'Millimetres'), h('option', { value: 'inch', selected: st.units === 'inch' }, 'Inches'))),
        h('label', { class: 'fld inline' }, h('span', {}, 'Mark already in project'), h('select', { id: 'imp-existing', onchange: (e: Event) => set({ existing: (e.target as HTMLSelectElement).value as 'skip' | 'update' }) },
          h('option', { value: 'skip', selected: st.existing === 'skip' }, 'Skip it'), h('option', { value: 'update', selected: st.existing === 'update' }, 'Update it with the file values'))))),
    error ? h('div', { class: 'alert err' }, error) : null,
    preview ? reportView(preview.report, '4. Preview (nothing imported yet)') : null,
    newDoors.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense' },
      h('thead', {}, h('tr', {}, ['Mark', 'Floor', 'Type', 'Configuration', 'Qty', 'Fire', 'Acoustic', 'Leaf W x H', 'Location', 'Source'].map((x) => h('th', {}, x)))),
      h('tbody', {}, newDoors.map((d) => h('tr', {}, h('td', { class: 'mono' }, d.mark), h('td', {}, floorName(preview!.project, d.floorId)), h('td', {}, d.doorType), h('td', {}, d.configuration ? CONFIG_LABEL[d.configuration] : h('span', { class: 'badge sev-warning' }, 'not set')),
        h('td', { class: 'num' }, String(d.quantity ?? '')), h('td', {}, d.fireRating || '-'), h('td', {}, d.acousticRating || '-'),
        h('td', {}, d.leafWidth1 ? `${d.leafWidth1}${d.leafWidth2 ? '+' + d.leafWidth2 : ''} x ${d.leafHeight ?? '?'}` : '-'), h('td', { class: 'small' }, d.location), h('td', { class: 'small' }, d.sourceRef)))))) : null,
    preview ? h('div', { class: 'row gap' },
      h('button', { class: 'btn primary', disabled: !(preview.report.imported + preview.report.updated), onclick: () => {
        const r = importRows(project(), rows, options());
        setProject(r.project);
        st = { ...st!, report: r.report };
        toast(`Imported ${r.report.imported} new and updated ${r.report.updated} door(s); ${r.report.skipped.length} skipped with reasons`, 'ok');
        setUi({});
      } }, `Import ${preview.report.imported} new${preview.report.updated ? ` + update ${preview.report.updated}` : ''} door(s)`),
      h('span', { class: 'muted small' }, 'Imported doors are Draft. Missing sizes and frame data are flagged in QA; nothing is filled in by assumption.')) : null,
    st.report ? reportView(st.report, 'Import result') : null,
    st.report ? h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => setUi({ view: 'doors' }) }, 'Open door register'), h('button', { class: 'btn', onclick: () => setUi({ view: 'qa' }) }, 'Open QA checks')) : null,
  );
}
