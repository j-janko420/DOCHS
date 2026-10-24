import type { CatalogueItem, HardwareCategory, HardwareItem, HardwareSet, Project } from '../../core/types.js';
import { HARDWARE_CATEGORIES } from '../../core/types.js';
import { uid } from '../../core/defaults.js';
import { toCsv } from '../../core/export.js';
import { catalogueFromCsv, catalogueTable, itemLabel, takeoff, validateHardwareSet } from '../../core/hardware.js';
import { confirmButton, download, h, safeName, sevBadge, toast } from '../dom.js';
import { project, setProject, setUi } from '../state.js';

let tab = 0;
let catFilter: HardwareCategory | '' = '';

const save = (patch: Partial<Project>) => setProject({ ...project(), ...patch });

function text(id: string, value: string, on: (v: string) => void, attrs: Record<string, unknown> = {}) {
  return h('input', { id, type: 'text', value, onchange: (e: Event) => on((e.target as HTMLInputElement).value.trim()), ...attrs });
}

function categorySelect(id: string, value: string, on: (v: HardwareCategory) => void, blank?: string) {
  return h('select', { id, onchange: (e: Event) => on((e.target as HTMLSelectElement).value as HardwareCategory) },
    blank ? h('option', { value: '', selected: !value }, blank) : null,
    (Object.entries(HARDWARE_CATEGORIES) as [HardwareCategory, string][]).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
}

const productName = (c: CatalogueItem) => [c.description, [c.manufacturer, c.model].filter(Boolean).join(' ')].filter(Boolean).join(' - ');

// ---------- catalogue ----------
function catalogueTab(p: Project): HTMLElement {
  const upd = (id: string, patch: Partial<CatalogueItem>) => save({ catalogue: p.catalogue.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const usage = (id: string) => p.hardwareSets.filter((s) => s.items.some((it) => it.catalogueId === id)).map((s) => s.code);
  const list = p.catalogue.filter((c) => !catFilter || c.category === catFilter);
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'hidden', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = catalogueFromCsv(await f.text());
    if (r.items.length) save({ catalogue: [...project().catalogue, ...r.items] });
    toast(`Imported ${r.items.length} product(s)${r.errors.length ? `; skipped ${r.errors.length}: ${r.errors.slice(0, 3).join('; ')}` : ''}`, r.errors.length ? 'info' : 'ok');
  } }) as HTMLInputElement;
  const verified = p.catalogue.filter((c) => c.verified).length;
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' },
      h('label', { class: 'fld inline' }, h('span', {}, 'Category'), categorySelect('cat-filter', catFilter, (v) => { catFilter = v; setUi({}); }, 'All categories')),
      h('span', { class: 'muted small' }, `${p.catalogue.length} products, ${verified} verified`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => download(`${safeName(p.name)}_hardware_catalogue.csv`, toCsv(catalogueTable(p.catalogue)), 'text/csv') }, 'Export CSV'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Import CSV'), file,
      h('button', { class: 'btn primary', onclick: () => save({ catalogue: [...p.catalogue, { id: uid('cat'), category: catFilter || 'other', manufacturer: '', model: '', description: 'New product', finish: '', dimensions: '', mounting: '', fireRated: '', powered: false, sourceRef: '', verified: false, notes: '' }] }) }, '+ Add product')),
    h('p', { class: 'muted small' }, 'Enter manufacturer data only from a datasheet or approved submittal, and record it in Source. Tick Verified once checked. CSV columns: category, manufacturer, model, description, finish, dimensions, mounting, fireRated (yes/no/blank), powered, sourceRef, verified, notes.'),
    list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense edit' },
      h('thead', {}, h('tr', {}, ['Category', 'Description', 'Manufacturer', 'Model', 'Finish', 'Dimensions', 'Mounting', 'Fire rated', 'Powered', 'Source ref', 'Verified', 'Notes', 'Used in', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((c) => {
        const used = usage(c.id);
        return h('tr', { class: c.verified ? '' : 'unverified' },
          h('td', {}, categorySelect(`c-${c.id}-cat`, c.category, (v) => upd(c.id, { category: v }))),
          ...(['description', 'manufacturer', 'model', 'finish', 'dimensions', 'mounting'] as const).map((k) => h('td', {}, text(`c-${c.id}-${k}`, c[k], (v) => upd(c.id, { [k]: v }), k === 'description' ? { class: 'desc' } : {}))),
          h('td', {}, h('select', { id: `c-${c.id}-fr`, onchange: (e: Event) => upd(c.id, { fireRated: (e.target as HTMLSelectElement).value as CatalogueItem['fireRated'] }) },
            h('option', { value: '', selected: c.fireRated === '' }, 'not stated'), h('option', { value: 'yes', selected: c.fireRated === 'yes' }, 'yes'), h('option', { value: 'no', selected: c.fireRated === 'no' }, 'no'))),
          h('td', { class: 'center' }, h('input', { id: `c-${c.id}-pw`, type: 'checkbox', checked: c.powered, 'aria-label': 'Powered', onchange: (e: Event) => upd(c.id, { powered: (e.target as HTMLInputElement).checked }) })),
          h('td', {}, text(`c-${c.id}-src`, c.sourceRef, (v) => upd(c.id, { sourceRef: v }), { placeholder: 'datasheet / submittal' })),
          h('td', { class: 'center' }, h('input', { id: `c-${c.id}-ver`, type: 'checkbox', checked: c.verified, 'aria-label': 'Verified', onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            if (on && !c.sourceRef.trim()) { toast('Enter the source reference before marking a product verified', 'err'); setUi({}); return; }
            upd(c.id, { verified: on });
          } })),
          h('td', {}, text(`c-${c.id}-notes`, c.notes, (v) => upd(c.id, { notes: v }), { placeholder: 'compatibility notes' })),
          h('td', { class: 'small nowrap' }, used.join(', ') || '-'),
          h('td', {}, used.length ? h('span', { class: 'muted small', title: 'Remove it from sets first' }, 'in use') : confirmButton('Remove', 'btn ghost sm', () => save({ catalogue: project().catalogue.filter((x) => x.id !== c.id), incompatibilities: project().incompatibilities.filter((r) => r.a !== c.id && r.b !== c.id) }), 'Confirm')));
      })))) : h('div', { class: 'card empty' }, 'No products in this category.'),
  );
}

// ---------- sets ----------
function setsTab(p: Project): HTMLElement {
  const setSets = (sets: HardwareSet[]) => save({ hardwareSets: sets });
  const updItem = (si: number, ii: number, patch: Partial<HardwareItem>) => setSets(p.hardwareSets.map((s, j) => (j === si ? { ...s, items: s.items.map((x, k) => (k === ii ? { ...x, ...patch } : x)) } : s)));
  const products = p.catalogue.slice().sort((a, b) => a.category.localeCompare(b.category) || a.description.localeCompare(b.description));
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' },
      h('span', { class: 'muted small' }, 'Link each line to a catalogue product. Quantity rule: qty x door qty (per door) or qty x door qty x leaves (per leaf). Doors can override a line with a recorded reason.'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => setSets([...p.hardwareSets, { code: `HW-${String(p.hardwareSets.length + 1).padStart(2, '0')}`, description: '', items: [] }]) }, '+ Add set')),
    p.hardwareSets.map((s, si) => {
      const issues = validateHardwareSet(s, p);
      const doors = p.doors.filter((d) => d.hardwareSet.trim() === s.code.trim());
      return h('section', { class: 'card' },
        h('div', { class: 'row gap' },
          h('label', { class: 'fld inline' }, h('span', {}, 'Code'), text(`hws-${si}-code`, s.code, (v) => {
            const old = s.code;
            const cur = project();
            // renaming a set keeps the doors that use it attached
            setProject({ ...cur, hardwareSets: cur.hardwareSets.map((x, j) => (j === si ? { ...x, code: v } : x)), doors: cur.doors.map((d) => (old && d.hardwareSet.trim() === old ? { ...d, hardwareSet: v } : d)) });
          })),
          h('label', { class: 'fld inline grow' }, h('span', {}, 'Description'), text(`hws-${si}-desc`, s.description, (v) => setSets(p.hardwareSets.map((x, j) => (j === si ? { ...x, description: v } : x))))),
          h('span', { class: 'muted small' }, `Doors: ${doors.map((d) => d.mark).join(', ') || 'none'}`),
          doors.length ? null : confirmButton('Remove set', 'btn ghost sm', () => setSets(project().hardwareSets.filter((_, j) => j !== si)), 'Confirm remove')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense edit' },
          h('thead', {}, h('tr', {}, ['Catalogue product', 'Line text (if not linked)', 'Qty', 'Basis', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, s.items.map((it, ii) => h('tr', {},
            h('td', {}, h('select', { id: `hw-${si}-${ii}-cat`, onchange: (e: Event) => {
              const id = (e.target as HTMLSelectElement).value;
              const c = p.catalogue.find((x) => x.id === id);
              updItem(si, ii, { catalogueId: id, item: c ? c.description : it.item });
            } },
              h('option', { value: '', selected: !it.catalogueId }, '- not linked -'),
              products.map((c) => h('option', { value: c.id, selected: c.id === it.catalogueId }, `${HARDWARE_CATEGORIES[c.category]}: ${productName(c)}${c.verified ? '' : ' (unverified)'}`)))),
            h('td', {}, it.catalogueId ? h('span', { class: 'muted small' }, itemLabel(p, it)) : text(`hw-${si}-${ii}-item`, it.item, (v) => updItem(si, ii, { item: v }), { placeholder: 'item description' })),
            h('td', {}, h('input', { id: `hw-${si}-${ii}-qty`, type: 'number', min: 0, step: 1, value: it.qty, class: 'qty', onchange: (e: Event) => updItem(si, ii, { qty: Number((e.target as HTMLInputElement).value) || 0 }) })),
            h('td', {}, h('select', { id: `hw-${si}-${ii}-basis`, onchange: (e: Event) => updItem(si, ii, { basis: (e.target as HTMLSelectElement).value as HardwareItem['basis'] }) },
              h('option', { value: 'per-door', selected: it.basis === 'per-door' }, 'per door'), h('option', { value: 'per-leaf', selected: it.basis === 'per-leaf' }, 'per leaf'))),
            h('td', {}, confirmButton('Remove', 'btn ghost sm', () => setSets(project().hardwareSets.map((x, j) => (j === si ? { ...x, items: x.items.filter((_, k) => k !== ii) } : x))), 'Confirm'))))))),
        h('button', { class: 'btn sm', onclick: () => setSets(p.hardwareSets.map((x, j) => (j === si ? { ...x, items: [...x.items, { id: uid('hwi'), catalogueId: '', item: '', qty: 1, basis: 'per-door', manufacturer: '', model: '', finish: '' }] } : x))) }, '+ Add line'),
        issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', {}, sevBadge(i.severity), ' ', h('b', {}, i.ruleId), ' ', i.message, h('div', { class: 'muted small' }, `Check: ${i.check}. Action: ${i.action}.`)))) : h('p', { class: 'ok-text small' }, 'No set issues.'));
    }));
}

// ---------- incompatibility rules ----------
function rulesTab(p: Project): HTMLElement {
  const upd = (id: string, patch: Partial<Project['incompatibilities'][number]>) => save({ incompatibilities: p.incompatibilities.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const pick = (id: string, value: string, on: (v: string) => void) => h('select', { id, onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
    h('option', { value: '', selected: !value }, '- product -'), p.catalogue.map((c) => h('option', { value: c.id, selected: c.id === value }, productName(c))));
  return h('div', { class: 'stack' },
    h('div', { class: 'alert info' }, 'DORSCH never assumes two products are compatible or incompatible. Record each known incompatibility here with its source (manufacturer note, consultant comment, RFI). Any set containing both products is flagged.'),
    p.incompatibilities.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid dense edit' },
      h('thead', {}, h('tr', {}, ['Product A', 'Product B', 'Reason', 'Source', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, p.incompatibilities.map((r) => h('tr', {},
        h('td', {}, pick(`r-${r.id}-a`, r.a, (v) => upd(r.id, { a: v }))),
        h('td', {}, pick(`r-${r.id}-b`, r.b, (v) => upd(r.id, { b: v }))),
        h('td', {}, text(`r-${r.id}-reason`, r.reason, (v) => upd(r.id, { reason: v }))),
        h('td', {}, text(`r-${r.id}-src`, r.source, (v) => upd(r.id, { source: v }), { placeholder: 'e.g. RFI-012, datasheet p.3' })),
        h('td', {}, confirmButton('Remove', 'btn ghost sm', () => save({ incompatibilities: project().incompatibilities.filter((x) => x.id !== r.id) }), 'Confirm'))))))) : h('div', { class: 'card empty' }, 'No incompatibility rules recorded.'),
    h('div', {}, h('button', { class: 'btn primary', onclick: () => save({ incompatibilities: [...p.incompatibilities, { id: uid('inc'), a: '', b: '', reason: '', source: '' }] }) }, '+ Add rule')));
}

// ---------- takeoff ----------
function takeoffTab(p: Project): HTMLElement {
  const tk = takeoff(p, p.doors);
  const overrides = p.doors.flatMap((d) => d.hardwareOverrides.map((o) => ({ d, o })));
  return h('div', { class: 'stack' },
    h('section', { class: 'card' }, h('h3', {}, 'By product (all doors)'),
      h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
        h('thead', {}, h('tr', {}, ['Category', 'Item', 'Manufacturer', 'Model', 'Finish', 'Verified', 'Quantity', 'Sets'].map((x) => h('th', {}, x)))),
        h('tbody', {}, tk.products.map((x) => h('tr', {}, h('td', {}, x.category || '-'), h('td', {}, x.item), h('td', {}, x.manufacturer || '-'), h('td', {}, x.model || '-'), h('td', {}, x.finish || '-'),
          h('td', {}, x.verified ? h('span', { class: 'ok-text' }, 'Yes') : h('span', { class: 'badge sev-warning' }, 'no')), h('td', { class: 'num' }, String(x.quantity)), h('td', { class: 'small' }, x.sets.join(',')))))))),
    h('section', { class: 'card' }, h('h3', {}, 'By set, with calculation basis'),
      h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
        h('thead', {}, h('tr', {}, ['Set', 'Item', 'Quantity', 'Calculation basis'].map((x) => h('th', {}, x)))),
        h('tbody', {}, tk.lines.map((l) => h('tr', {}, h('td', { class: 'mono' }, l.set), h('td', {}, l.item), h('td', { class: 'num' }, String(l.quantity)), h('td', { class: 'small' }, l.basis)))))),
      tk.unresolved.length ? h('div', { class: 'alert warn' }, h('b', {}, 'Unresolved: '), tk.unresolved.join('; ')) : null),
    h('section', { class: 'card' }, h('h3', {}, `Quantity overrides (${overrides.length})`),
      overrides.length ? h('ul', { class: 'plain' }, overrides.map(({ d, o }) => {
        const it = p.hardwareSets.find((s) => s.code === d.hardwareSet.trim())?.items.find((x) => x.id === o.itemId);
        return h('li', { onclick: () => setUi({ view: 'doors', selectedDoorId: d.id }), class: 'link-row' }, h('b', { class: 'mono' }, d.mark), ` ${it ? itemLabel(p, it) : '(item not in set)'}: ${o.qty} - ${o.reason || 'NO REASON'} `, h('span', { class: 'muted small' }, `${o.by || 'user'}, ${o.at.slice(0, 10)}`));
      })) : h('p', { class: 'muted' }, 'No overrides. Set quantities apply to every door.')));
}

export function hardwareView(): HTMLElement {
  const p = project();
  const tabs = ['Catalogue', 'Sets', 'Incompatibility rules', 'Takeoff'];
  const body = [catalogueTab, setsTab, rulesTab, takeoffTab][tab](p);
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Hardware library'), h('p', { class: 'muted' }, 'Product catalogue, hardware sets, incompatibility rules and takeoff. Product data is entered from manufacturer sources; DORSCH does not invent specifications or assume compatibility.'))),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map((name, i) => h('button', { role: 'tab', 'aria-selected': i === tab ? 'true' : 'false', class: `tab ${i === tab ? 'on' : ''}`, onclick: () => { tab = i; setUi({}); } }, name))),
    body);
}
