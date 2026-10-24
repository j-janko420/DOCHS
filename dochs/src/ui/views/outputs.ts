import type { Table } from '../../core/schedule.js';
import { floorName } from '../../core/classify.js';
import { counts, drawable, validateScope, type Severity } from '../../core/validate.js';
import { LAYERS } from '../../cad/entities.js';
import { MAIN_SCALE_OPTIONS, SHEETS, type SheetSize } from '../../cad/sheet.js';
import { toSvg } from '../../cad/svg.js';
import { h, sevBadge } from '../dom.js';
import { filterBar, filteredDoors } from '../filters.js';
import { project, setUi, ui } from '../state.js';
import { exportCsv, exportDoorDxf, exportDoorPdf, exportPackage, exportSetPdf, exportXlsx, scheduleTables, scopeLabel, setDxf, sheetFor } from '../exports.js';
import { titleBlockPanel } from '../titleblock-ui.js';
import { download, safeName, toast } from '../dom.js';

let tab = 0;

function tableEl(t: Table, opts: { onRow?: (i: number) => void } = {}): HTMLElement {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense' },
    h('thead', {}, h('tr', {}, t.columns.map((c) => h('th', {}, c)))),
    h('tbody', {}, t.rows.map((r, i) => h('tr', { class: r[0] === 'TOTAL' || r[0] === 'UNRESOLVED' ? 'strong' : '', onclick: opts.onRow ? () => opts.onRow!(i) : undefined }, r.map((c) => h('td', { class: typeof c === 'number' ? 'num' : '' }, String(c))))))));
}

export function scheduleView(): HTMLElement {
  const p = project();
  const doors = filteredDoors();
  const tables = scheduleTables(p, doors);
  const t = tables[tab];
  const tabs = ['Door schedule', 'Quantity summary', 'Hardware by set', 'Hardware by product', 'Materials', 'QA issues'];
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Door schedule'), h('p', { class: 'muted' }, `Scope: ${scopeLabel(p)}. Generated live from the door register; the drawings use the same records.`)),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn', onclick: () => exportCsv(p, doors, tab) }, `CSV (${tabs[tab].toLowerCase()})`),
        h('button', { class: 'btn', onclick: () => exportXlsx(p, doors) }, 'Excel (.xlsx, 6 sheets)'),
        h('button', { class: 'btn primary', onclick: () => exportPackage(p, doors) }, 'Issue package (.zip)'))),
    filterBar({ status: true, search: true }),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map((name, i) => h('button', { role: 'tab', 'aria-selected': i === tab ? 'true' : 'false', class: `tab ${i === tab ? 'on' : ''}`, onclick: () => { tab = i; setUi({}); } }, name))),
    doors.length ? tableEl(t, tab === 0 ? { onRow: (i) => setUi({ view: 'doors', selectedDoorId: doors[i].id }) } : {}) : h('div', { class: 'card empty' }, 'No doors match the filters.'),
  );
}

// ---------- drawing studio ----------
let vb: { x: number; y: number; w: number; h: number } | null = null;
let vbKey = '';

export function drawingsView(): HTMLElement {
  const p = project();
  const doors = filteredDoors();
  const d = doors.find((x) => x.id === ui.selectedDoorId) ?? doors[0];
  const head = h('div', { class: 'view-head' },
    h('div', {}, h('h1', {}, '2D drawings'), h('p', { class: 'muted' }, 'A3 door sheets from the door register with your title block. PDF at true scale for issue; DXF (AutoCAD R12, mm) for editing in CAD.')),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn', onclick: () => doors.length && exportSetPdf(p, doors) }, `Drawing set PDF (${doors.length})`),
      h('button', { class: 'btn', onclick: () => {
        if (!doors.length) return;
        const r = setDxf(p, doors);
        if (!r.ok.length) { toast('No drawable doors in scope (all have errors)', 'err'); return; }
        download(`${safeName(p.name)}_${safeName(scopeLabel(p))}_SET.dxf`, r.dxf, 'application/dxf');
        toast(`Set DXF: ${r.ok.length} sheets${r.blocked.length ? `, ${r.blocked.length} withheld` : ''}`, 'ok');
      } }, `Set DXF (${doors.length} in scope)`),
      h('button', { class: 'btn primary', onclick: () => exportPackage(p, doors) }, 'Issue package (.zip)')));
  if (!d) return h('div', { class: 'view' }, head, titleBlockPanel(), filterBar({ status: true }), h('div', { class: 'card empty' }, 'No doors match the filters.'));
  const gate = drawable(d, p);
  const s = sheetFor(p, d);
  const W = s.paper[0] * s.S, H = s.paper[1] * s.S;
  const key = `${d.id}|${s.size}|${s.S}`;
  if (!vb || vbKey !== key) { vb = { x: 0, y: 0, w: W, h: H }; vbKey = key; }
  const host = h('div', { class: 'sheet-host', tabindex: 0, 'aria-label': 'Drawing preview: drag to pan, wheel to zoom', html: toSvg(s.entities, { width: W, height: H, S: s.S, hiddenLayers: new Set(ui.hiddenLayers), background: '#ffffff' }) });
  const svg = host.querySelector('svg')!;
  const apply = () => svg.setAttribute('viewBox', `${vb!.x} ${vb!.y} ${vb!.w} ${vb!.h}`);
  apply();
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const mx = vb!.x + ((e.clientX - r.left) / r.width) * vb!.w, my = vb!.y + ((e.clientY - r.top) / r.height) * vb!.h;
    vb = { x: mx - (mx - vb!.x) * k, y: my - (my - vb!.y) * k, w: vb!.w * k, h: vb!.h * k };
    apply();
  }, { passive: false });
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  host.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: vb!.x, vy: vb!.y }; host.setPointerCapture(e.pointerId); });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    vb!.x = drag.vx - ((e.clientX - drag.x) / r.width) * vb!.w;
    vb!.y = drag.vy - ((e.clientY - drag.y) / r.height) * vb!.h;
    apply();
  });
  host.addEventListener('pointerup', () => { drag = null; });
  const fit = () => { vb = { x: 0, y: 0, w: W, h: H }; apply(); };
  return h('div', { class: 'view' }, head, titleBlockPanel(), filterBar({ status: true }),
    h('div', { class: 'studio' },
      h('aside', { class: 'card studio-list' },
        h('h3', {}, 'Doors in scope'),
        h('ul', { class: 'pick' }, doors.map((x) => {
          const ok = drawable(x, p).ok;
          return h('li', {}, h('button', { class: x.id === d.id ? 'on' : '', onclick: () => setUi({ selectedDoorId: x.id }) },
            h('span', { class: 'mono' }, x.mark || '(no mark)'), h('span', { class: 'muted small' }, floorName(p, x.floorId)), ok ? h('span', { class: 'ok-text small' }, 'ready') : h('span', { class: 'badge sev-error' }, 'blocked')));
        }))),
      h('div', { class: 'studio-main' },
        h('div', { class: 'toolbar' },
          h('label', { class: 'fld inline' }, h('span', {}, 'Sheet'), h('select', { id: 'sheet-size', onchange: (e: Event) => setUi({ sheetSize: (e.target as HTMLSelectElement).value as SheetSize }) },
            (Object.keys(SHEETS) as SheetSize[]).map((k) => h('option', { value: k, selected: k === ui.sheetSize }, `${k} landscape`)))),
          h('label', { class: 'fld inline' }, h('span', {}, 'Scale'), h('select', { id: 'sheet-scale', onchange: (e: Event) => setUi({ mainScale: Number((e.target as HTMLSelectElement).value) }) },
            [h('option', { value: '0', selected: !ui.mainScale }, `Auto (1:${s.S})`), ...MAIN_SCALE_OPTIONS.map((k) => h('option', { value: String(k), selected: ui.mainScale === k }, `1:${k}`))])),
          h('button', { class: 'btn sm', onclick: fit }, 'Fit'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', disabled: !gate.ok, title: gate.ok ? 'Download this sheet as PDF (true scale)' : 'Fix errors first', onclick: () => exportDoorPdf(p, d) }, 'PDF'),
          h('button', { class: 'btn primary', disabled: !gate.ok, title: gate.ok ? 'Download editable DXF' : 'Fix errors first', onclick: () => exportDoorDxf(p, d) }, 'DXF'),
        ),
        gate.ok ? null : h('div', { class: 'alert err' }, h('b', {}, `${d.mark}: DXF export blocked by ${gate.errors.length} error(s). `), gate.errors.map((e) => `${e.ruleId} ${e.message}`).join('; ')),
        d.status !== 'approved' && gate.ok ? h('div', { class: 'alert info' }, `Status is ${d.status}: the sheet carries a NOT FOR CONSTRUCTION banner until the door is approved.`) : null,
        host,
        h('div', { class: 'layers' }, h('span', { class: 'muted small' }, 'Layers:'), LAYERS.map((l) => h('label', { class: 'layer' },
          h('input', { type: 'checkbox', checked: !ui.hiddenLayers.includes(l.name), onchange: (e: Event) => setUi({ hiddenLayers: (e.target as HTMLInputElement).checked ? ui.hiddenLayers.filter((x) => x !== l.name) : [...ui.hiddenLayers, l.name] }) }),
          h('i', { style: { background: l.svg } }), l.name))),
        h('p', { class: 'muted small' }, `Sheet ${s.size} at 1:${s.S}, details 1:${s.detailScale}. ${s.entities.length} entities. Drawing ${s.drawingNo}. Layers, linetypes and dimensions are written as real DXF objects.`),
      ),
    ),
  );
}

// ---------- QA ----------
let sevFilter: Severity | '' = '';

export function qaView(): HTMLElement {
  const p = project();
  const doors = filteredDoors();
  const all = validateScope(p, doors).map((i) => {
    const d = p.doors.find((x) => x.id === i.doorId);
    return { ...i, floor: d ? floorName(p, d.floorId) : 'Hardware set' };
  });
  const c = counts(all);
  const list = all.filter((i) => !sevFilter || i.severity === sevFilter);
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Checks'), h('p', { class: 'muted' }, 'Rule-based checks. Errors block DXF issue; warnings and info need review. Code and life-safety compliance is never decided by DORSCH.'))),
    filterBar({ status: true }),
    h('div', { class: 'kpis' },
      (['error', 'warning', 'info'] as Severity[]).map((s) => h('button', { class: `kpi sev-${s} ${sevFilter === s ? 'on' : ''}`, onclick: () => { sevFilter = sevFilter === s ? '' : s; setUi({}); } }, h('b', {}, String(c[s])), h('span', {}, s === 'error' ? 'Errors' : s === 'warning' ? 'Warnings' : 'Info')))),
    list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense' },
      h('thead', {}, h('tr', {}, ['Door / set', 'Floor', 'Severity', 'Rule', 'Finding', 'Check performed', 'Source', 'Corrective action'].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((i) => h('tr', { onclick: () => setUi(i.doorId ? { view: 'doors', selectedDoorId: i.doorId } : { view: 'hardware' }) },
        h('td', { class: 'mono' }, i.mark), h('td', {}, i.floor), h('td', {}, sevBadge(i.severity)), h('td', { class: 'mono' }, i.ruleId), h('td', {}, i.message), h('td', { class: 'small' }, i.check), h('td', { class: 'small' }, i.source), h('td', { class: 'small' }, i.action)))))) : h('div', { class: 'card empty' }, 'No findings for this filter.'),
  );
}
