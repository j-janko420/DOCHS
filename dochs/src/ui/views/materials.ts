import type { MaterialItem, MaterialKind, Project } from '../../core/types.js';
import { APPROVAL_LABEL, MATERIAL_KINDS, MATERIAL_SLOTS } from '../../core/types.js';
import { uid } from '../../core/defaults.js';
import { toCsv } from '../../core/export.js';
import { autoLink, materialSchedule, materialTable, materialsFromCsv, validateMaterialLibrary } from '../../core/materials.js';
import { confirmButton, download, h, safeName, sevBadge, toast } from '../dom.js';
import { filterBar, filteredDoors } from '../filters.js';
import { project, setProject, setUi } from '../state.js';

let tab = 0;
let kindFilter: MaterialKind | '' = '';

const save = (patch: Partial<Project>) => setProject({ ...project(), ...patch });

function text(id: string, value: string, on: (v: string) => void, attrs: Record<string, unknown> = {}) {
  return h('input', { id, type: 'text', value, onchange: (e: Event) => on((e.target as HTMLInputElement).value.trim()), ...attrs });
}

function kindSelect(id: string, value: string, on: (v: MaterialKind) => void, blank?: string) {
  return h('select', { id, onchange: (e: Event) => on((e.target as HTMLSelectElement).value as MaterialKind) },
    blank ? h('option', { value: '', selected: !value }, blank) : null,
    (Object.entries(MATERIAL_KINDS) as [MaterialKind, string][]).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
}

function libraryTab(p: Project): HTMLElement {
  const upd = (id: string, patch: Partial<MaterialItem>) => {
    const cur = project();
    const materials = cur.materials.map((m) => (m.id === id ? { ...m, ...patch } : m));
    // a renamed item renames the linked door fields, so schedules stay in step
    const item = materials.find((m) => m.id === id)!;
    const doors = patch.name === undefined ? cur.doors : cur.doors.map((d) => {
      let next = d;
      for (const s of MATERIAL_SLOTS) if (d.materialIds[s.slot] === id) next = { ...next, [s.field]: item.name };
      return next;
    });
    setProject({ ...cur, materials, doors });
  };
  const usage = (id: string) => p.doors.filter((d) => Object.values(d.materialIds).includes(id)).map((d) => d.mark);
  const list = p.materials.filter((m) => !kindFilter || m.kind === kindFilter);
  const issues = validateMaterialLibrary(p);
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'hidden', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = materialsFromCsv(await f.text());
    if (r.items.length) save({ materials: [...project().materials, ...r.items] });
    toast(`Imported ${r.items.length} item(s)${r.errors.length ? `; skipped ${r.errors.length}: ${r.errors.slice(0, 3).join('; ')}` : ''}`, r.errors.length ? 'info' : 'ok');
  } }) as HTMLInputElement;
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' },
      h('label', { class: 'fld inline' }, h('span', {}, 'Kind'), kindSelect('mat-filter', kindFilter, (v) => { kindFilter = v; setUi({}); }, 'All kinds')),
      h('span', { class: 'muted small' }, `${p.materials.length} items, ${p.materials.filter((m) => m.verified).length} verified, ${p.materials.filter((m) => m.approval === 'approved' || m.approval === 'approved-as-noted').length} approved`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', title: 'Link door fields whose text exactly matches a library name', onclick: () => {
        const r = autoLink(project());
        setProject(r.project);
        toast(r.linked ? `Linked ${r.linked} door field(s) by exact name` : 'No unlinked door fields match a library name exactly', r.linked ? 'ok' : 'info');
      } }, 'Link door fields by name'),
      h('button', { class: 'btn', onclick: () => download(`${safeName(p.name)}_material_library.csv`, toCsv(materialTable(p.materials)), 'text/csv') }, 'Export CSV'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Import CSV'), file,
      h('button', { class: 'btn primary', onclick: () => save({ materials: [...p.materials, { id: uid('mat'), kind: kindFilter || 'finish', name: 'New item', manufacturer: '', product: '', code: '', thickness: null, fireRated: '', fireRating: '', acoustic: '', sourceRef: '', approvalRef: '', approval: '', verified: false, notes: '' }] }) }, '+ Add item')),
    h('p', { class: 'muted small' }, 'Enter values from datasheets or approved material submittals and record the source. Linked door fields take the library name. CSV columns: kind, name, manufacturer, product, code, thickness, fireRated, fireRating, acoustic, sourceRef, approvalRef, approval, verified, notes.'),
    issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', {}, sevBadge(i.severity), ' ', h('b', {}, i.ruleId), ' ', i.message))) : null,
    list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense edit' },
      h('thead', {}, h('tr', {}, ['Kind', 'Name', 'Manufacturer', 'Product', 'Code', 'Thk mm', 'Fire rated', 'Fire rating', 'Acoustic', 'Source ref', 'Submittal ref', 'Submittal status', 'Verified', 'Notes', 'Doors', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((m) => {
        const used = usage(m.id);
        return h('tr', { class: m.verified ? '' : 'unverified' },
          h('td', {}, kindSelect(`m-${m.id}-kind`, m.kind, (v) => {
            if (used.length) { toast('Unlink the doors before changing the kind of an item in use', 'err'); setUi({}); return; }
            upd(m.id, { kind: v });
          })),
          h('td', {}, text(`m-${m.id}-name`, m.name, (v) => upd(m.id, { name: v }), { class: 'desc' })),
          ...(['manufacturer', 'product', 'code'] as const).map((k) => h('td', {}, text(`m-${m.id}-${k}`, m[k], (v) => upd(m.id, { [k]: v })))),
          h('td', {}, h('input', { id: `m-${m.id}-thk`, type: 'number', class: 'qty', value: m.thickness ?? '', placeholder: '-', onchange: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value.trim();
            upd(m.id, { thickness: raw === '' ? null : Number(raw) });
          } })),
          h('td', {}, h('select', { id: `m-${m.id}-fr`, onchange: (e: Event) => upd(m.id, { fireRated: (e.target as HTMLSelectElement).value as MaterialItem['fireRated'] }) },
            h('option', { value: '', selected: m.fireRated === '' }, 'not stated'), h('option', { value: 'yes', selected: m.fireRated === 'yes' }, 'yes'), h('option', { value: 'no', selected: m.fireRated === 'no' }, 'no'))),
          ...(['fireRating', 'acoustic', 'sourceRef', 'approvalRef'] as const).map((k) => h('td', {}, text(`m-${m.id}-${k}`, m[k], (v) => upd(m.id, { [k]: v })))),
          h('td', {}, h('select', { id: `m-${m.id}-appr`, onchange: (e: Event) => upd(m.id, { approval: (e.target as HTMLSelectElement).value as MaterialItem['approval'] }) },
            (Object.entries(APPROVAL_LABEL) as [MaterialItem['approval'], string][]).map(([k, l]) => h('option', { value: k, selected: k === m.approval }, l)))),
          h('td', { class: 'center' }, h('input', { id: `m-${m.id}-ver`, type: 'checkbox', checked: m.verified, 'aria-label': 'Verified', onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            if (on && !m.sourceRef.trim()) { toast('Enter the source reference before marking an item verified', 'err'); setUi({}); return; }
            upd(m.id, { verified: on });
          } })),
          h('td', {}, text(`m-${m.id}-notes`, m.notes, (v) => upd(m.id, { notes: v }))),
          h('td', { class: 'small' }, used.join(', ') || '-'),
          h('td', {}, used.length ? h('span', { class: 'muted small', title: 'Unlink the doors first' }, 'in use') : confirmButton('Remove', 'btn ghost sm', () => save({ materials: project().materials.filter((x) => x.id !== m.id) }), 'Confirm')));
      })))) : h('div', { class: 'card empty' }, 'No items of this kind.'),
  );
}

function scheduleTab(p: Project): HTMLElement {
  const doors = filteredDoors();
  const t = materialSchedule(p, doors);
  return h('div', { class: 'stack' },
    filterBar({ status: true }),
    h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, 'Every material and finish used by the doors in scope, with submittal status. Door fields not linked to the library are listed as NOT IN LIBRARY.'), h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => download(`${safeName(p.name)}_material_schedule.csv`, toCsv(t), 'text/csv') }, 'Export CSV')),
    t.rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense' },
      h('thead', {}, h('tr', {}, t.columns.map((c) => h('th', {}, c)))),
      h('tbody', {}, t.rows.map((r) => h('tr', { class: r[6] === 'NOT IN LIBRARY' ? 'unverified' : '' }, r.map((c) => h('td', { class: typeof c === 'number' ? 'num' : '' }, String(c)))))))) : h('div', { class: 'card empty' }, 'No materials recorded for the doors in scope.'));
}

export function materialsView(): HTMLElement {
  const p = project();
  const tabs = ['Library', 'Material schedule'];
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Materials and finishes'), h('p', { class: 'muted' }, 'Leaf systems, cores, facings, finishes, frames and glazing, with source and submittal status. DORSCH does not invent material data or decide fire / acoustic compliance.'))),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map((name, i) => h('button', { role: 'tab', 'aria-selected': i === tab ? 'true' : 'false', class: `tab ${i === tab ? 'on' : ''}`, onclick: () => { tab = i; setUi({}); } }, name))),
    tab === 0 ? libraryTab(p) : scheduleTab(p));
}
