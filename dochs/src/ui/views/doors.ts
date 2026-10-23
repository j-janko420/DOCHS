import type { Door } from '../../core/types.js';
import { CONFIG_LABEL } from '../../core/types.js';
import { blankDoor } from '../../core/defaults.js';
import { classify, floorName } from '../../core/classify.js';
import { frameFit } from '../../core/geometry.js';
import { counts, validateDoor } from '../../core/validate.js';
import { duplicateDoor, patchDoor } from '../../core/project-ops.js';
import { composeSheet } from '../../cad/sheet.js';
import { toSvg } from '../../cad/svg.js';
import { confirmButton, h, sevBadge, toast } from '../dom.js';
import { filterBar, filteredDoors } from '../filters.js';
import { project, setProject, setUi, ui } from '../state.js';

type FieldType = 'text' | 'num' | 'bool' | 'select' | 'area';
interface Field { key: keyof Door; label: string; type: FieldType; unit?: string; options?: () => [string, string][]; wide?: boolean }

const opt = (o: Record<string, string>): (() => [string, string][]) => () => [['', '- not specified -'], ...Object.entries(o)];

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Identity', fields: [
    { key: 'mark', label: 'Door mark', type: 'text' },
    { key: 'doorType', label: 'Door type code', type: 'text' },
    { key: 'buildingId', label: 'Building', type: 'select', options: () => [['', '- select -'], ...project().buildings.map((b) => [b.id, b.name] as [string, string])] },
    { key: 'floorId', label: 'Floor', type: 'select', options: () => [['', '- select -'], ...project().floors.slice().sort((a, b) => a.order - b.order).map((f) => [f.id, f.name] as [string, string])] },
    { key: 'room', label: 'Room', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'num' },
    { key: 'status', label: 'Status', type: 'select', options: () => [['draft', 'Draft'], ['for-review', 'For review'], ['approved', 'Approved'], ['on-hold', 'On hold']] },
  ] },
  { title: 'Configuration', fields: [
    { key: 'configuration', label: 'Configuration', type: 'select', options: opt(CONFIG_LABEL) },
    { key: 'handing', label: 'Handing (viewed from outside)', type: 'select', options: opt({ LH: 'LH', RH: 'RH', LHR: 'LHR (reverse)', RHR: 'RHR (reverse)' }) },
    { key: 'openingAngle', label: 'Opening angle', type: 'num', unit: 'deg' },
    { key: 'pivotOffset', label: 'Pivot offset (pivot doors)', type: 'num', unit: 'mm' },
  ] },
  { title: 'Opening and leaf', fields: [
    { key: 'openingWidth', label: 'S.O. width', type: 'num', unit: 'mm' },
    { key: 'openingHeight', label: 'S.O. height', type: 'num', unit: 'mm' },
    { key: 'leafWidth1', label: 'Leaf 1 width (left)', type: 'num', unit: 'mm' },
    { key: 'leafWidth2', label: 'Leaf 2 width (pairs)', type: 'num', unit: 'mm' },
    { key: 'leafHeight', label: 'Leaf height', type: 'num', unit: 'mm' },
    { key: 'leafThickness', label: 'Leaf thickness', type: 'num', unit: 'mm' },
    { key: 'undercut', label: 'Undercut', type: 'num', unit: 'mm' },
    { key: 'requiredClearWidth', label: 'Required clear width (project)', type: 'num', unit: 'mm' },
  ] },
  { title: 'Frame and wall', fields: [
    { key: 'frameMaterial', label: 'Frame material', type: 'text' },
    { key: 'frameFinish', label: 'Frame finish', type: 'text' },
    { key: 'frameProfile', label: 'Frame profile', type: 'text' },
    { key: 'frameWidth', label: 'Frame face width (incl. stop)', type: 'num', unit: 'mm' },
    { key: 'frameDepth', label: 'Frame depth', type: 'num', unit: 'mm' },
    { key: 'rebateDepth', label: 'Rebate depth', type: 'num', unit: 'mm' },
    { key: 'installGap', label: 'Install gap (S.O. to frame)', type: 'num', unit: 'mm' },
    { key: 'edgeGap', label: 'Leaf edge / meeting gap', type: 'num', unit: 'mm' },
    { key: 'wallThickness', label: 'Wall thickness', type: 'num', unit: 'mm' },
    { key: 'wallType', label: 'Wall type', type: 'text' },
    { key: 'framePosition', label: 'Frame position in wall', type: 'select', options: opt({ centre: 'Centred', 'flush-outside': 'Flush outside', 'flush-inside': 'Flush inside' }) },
  ] },
  { title: 'Leaf construction and finish', fields: [
    { key: 'leafMaterial', label: 'Leaf material', type: 'text' },
    { key: 'leafCore', label: 'Core', type: 'text' },
    { key: 'leafFacing', label: 'Facing', type: 'text' },
    { key: 'finishSide1', label: 'Finish side 1 (outside)', type: 'text' },
    { key: 'finishSide2', label: 'Finish side 2 (inside)', type: 'text' },
  ] },
  { title: 'Vision panel, louvre, plates', fields: [
    { key: 'visionPanel', label: 'Vision panel', type: 'bool' },
    { key: 'vpWidth', label: 'VP width', type: 'num', unit: 'mm' },
    { key: 'vpHeight', label: 'VP height', type: 'num', unit: 'mm' },
    { key: 'vpFromTop', label: 'VP from top of leaf', type: 'num', unit: 'mm' },
    { key: 'louvre', label: 'Louvre', type: 'bool' },
    { key: 'louvreWidth', label: 'Louvre width', type: 'num', unit: 'mm' },
    { key: 'louvreHeight', label: 'Louvre height', type: 'num', unit: 'mm' },
    { key: 'louvreFromBottom', label: 'Louvre from bottom of leaf', type: 'num', unit: 'mm' },
    { key: 'kickPlate', label: 'Kick plate', type: 'bool' },
    { key: 'kickPlateHeight', label: 'Kick plate height', type: 'num', unit: 'mm' },
  ] },
  { title: 'Performance', fields: [
    { key: 'fireRating', label: 'Fire rating', type: 'text' },
    { key: 'acousticRating', label: 'Acoustic rating', type: 'text' },
    { key: 'smokeSeal', label: 'Smoke seal', type: 'bool' },
    { key: 'accessControl', label: 'Access controlled', type: 'bool' },
  ] },
  { title: 'Hardware', fields: [
    { key: 'hardwareSet', label: 'Hardware set', type: 'text' },
    { key: 'handleHeight', label: 'Handle height (from FFL)', type: 'num', unit: 'mm' },
    { key: 'backset', label: 'Backset', type: 'num', unit: 'mm' },
    { key: 'hingePositions', label: 'Hinge positions (from leaf bottom, comma list)', type: 'text', wide: true },
  ] },
  { title: 'Installation and references', fields: [
    { key: 'threshold', label: 'Threshold', type: 'text' },
    { key: 'floorFinish', label: 'Floor finish', type: 'text' },
    { key: 'sourceRef', label: 'Source drawing / sheet', type: 'text' },
    { key: 'specRef', label: 'Specification ref', type: 'text' },
    { key: 'revision', label: 'Door revision', type: 'text' },
    { key: 'remarks', label: 'Remarks', type: 'area', wide: true },
  ] },
];

function update(d: Door, patch: Partial<Door>) {
  setProject(patchDoor(project(), d.id, patch));
}

function fieldInput(d: Door, f: Field, flagged: Set<string>): HTMLElement {
  const id = `f-${d.id}-${String(f.key)}`;
  const v = d[f.key];
  const blank = v === null || v === '';
  const cls = `fld${f.wide ? ' wide' : ''}${flagged.has(String(f.key)) ? ' flag' : ''}${blank && f.type !== 'bool' ? ' blank' : ''}`;
  const lab = h('span', {}, f.label, f.unit ? h('em', {}, ` ${f.unit}`) : null);
  if (f.type === 'bool')
    return h('label', { class: `${cls} check` }, h('input', { id, type: 'checkbox', checked: Boolean(v), onchange: (e: Event) => update(d, { [f.key]: (e.target as HTMLInputElement).checked }) }), lab);
  if (f.type === 'select')
    return h('label', { class: cls }, lab, h('select', { id, onchange: (e: Event) => update(d, { [f.key]: (e.target as HTMLSelectElement).value }) },
      f.options!().map(([o, l]) => h('option', { value: o, selected: String(v ?? '') === o }, l))));
  if (f.type === 'area')
    return h('label', { class: cls }, lab, h('textarea', { id, rows: 2, onchange: (e: Event) => update(d, { [f.key]: (e.target as HTMLTextAreaElement).value }) }, String(v ?? '')));
  return h('label', { class: cls }, lab, h('input', {
    id, type: f.type === 'num' ? 'number' : 'text', inputmode: f.type === 'num' ? 'decimal' : undefined, step: 'any', value: v ?? '', placeholder: f.type === 'num' ? 'blank' : '',
    list: f.key === 'hardwareSet' ? 'hw-codes' : undefined,
    onchange: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      if (f.type === 'num') {
        const n = raw === '' ? null : Number(raw);
        if (n !== null && !Number.isFinite(n)) { toast(`${f.label}: not a number`, 'err'); return; }
        update(d, { [f.key]: n });
      } else update(d, { [f.key]: raw });
    },
  }));
}

function editor(d: Door): HTMLElement {
  const p = project();
  const issues = validateDoor(d, p);
  const flagged = new Set(issues.filter((i) => i.severity !== 'info').map((i) => i.field));
  const fit = frameFit(d);
  let preview: HTMLElement;
  try {
    const s = composeSheet(p, d, { size: ui.sheetSize });
    preview = h('div', { class: 'mini-sheet', html: toSvg(s.entities, { width: s.paper[0] * s.S, height: s.paper[1] * s.S, S: s.S, background: '#ffffff' }) });
  } catch (e) {
    preview = h('div', { class: 'empty' }, `Preview unavailable: ${(e as Error).message}`);
  }
  const c = counts(issues);
  const newComment = h('input', { id: `c-${d.id}`, type: 'text', placeholder: 'Add review comment' });
  return h('div', { class: 'editor' },
    h('div', { class: 'editor-head' },
      h('div', {}, h('h2', {}, d.mark || '(no mark)'), h('div', { class: 'muted' }, `${floorName(p, d.floorId) || 'No floor'} - ${d.room || 'no room'} - ${d.configuration ? CONFIG_LABEL[d.configuration] : 'configuration not set'}`)),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn', onclick: () => setUi({ view: 'drawings', selectedDoorId: d.id }) }, 'Open in Drawing Studio'),
        h('button', { class: 'btn', onclick: () => { const r = duplicateDoor(project(), d.id); setProject(r.project); setUi({ selectedDoorId: r.door.id }); toast(`Duplicated as ${r.door.mark}`, 'ok'); } }, 'Duplicate'),
        confirmButton('Delete', 'btn danger', () => { setProject({ ...project(), doors: project().doors.filter((x) => x.id !== d.id) }); setUi({ selectedDoorId: '' }); }, `Delete ${d.mark}?`),
      ),
    ),
    h('div', { class: 'editor-grid' },
      h('div', { class: 'editor-form' },
        GROUPS.map((g) => h('fieldset', {}, h('legend', {}, g.title), h('div', { class: 'fields' }, g.fields.map((f) => fieldInput(d, f, flagged))))),
        p.categories.length ? h('fieldset', {}, h('legend', {}, 'Project categories'), h('div', { class: 'fields' }, p.categories.map((cat) =>
          h('label', { class: 'fld check' }, h('input', { id: `cat-${d.id}-${cat.id}`, type: 'checkbox', checked: d.categoryIds.includes(cat.id), onchange: (e: Event) => update(d, { categoryIds: (e.target as HTMLInputElement).checked ? [...d.categoryIds, cat.id] : d.categoryIds.filter((x) => x !== cat.id) }) }), h('span', {}, cat.name))))) : null,
        h('fieldset', {}, h('legend', {}, 'Review comments'),
          d.comments.length ? h('ul', { class: 'comments' }, d.comments.map((cm, i) => h('li', { class: cm.resolved ? 'resolved' : '' },
            h('span', { class: 'muted' }, `${cm.at.slice(0, 16).replace('T', ' ')} ${cm.by}: `), cm.text, ' ',
            h('button', { class: 'btn ghost sm', onclick: () => update(d, { comments: d.comments.map((x, j) => (j === i ? { ...x, resolved: !x.resolved } : x)) }) }, cm.resolved ? 'Reopen' : 'Resolve')))) : h('p', { class: 'muted' }, 'No comments.'),
          h('div', { class: 'row gap' }, newComment, h('button', { class: 'btn sm', onclick: () => {
            const text = (newComment as HTMLInputElement).value.trim();
            if (text) update(d, { comments: [...d.comments, { at: new Date().toISOString(), by: project().preparedBy || 'user', text, resolved: false }] });
          } }, 'Add'))),
        h('fieldset', {}, h('legend', {}, `Change history (${d.history.length})`),
          d.history.length ? h('ul', { class: 'history' }, d.history.slice(-25).reverse().map((r) => h('li', {}, h('span', { class: 'muted' }, r.at.slice(0, 16).replace('T', ' ')), ` ${r.field}: `, h('s', {}, r.from || 'blank'), ' -> ', r.to || 'blank'))) : h('p', { class: 'muted' }, 'No changes recorded.')),
      ),
      h('aside', { class: 'editor-side' },
        h('section', { class: 'card' }, h('h3', {}, 'Sheet preview'), preview, h('p', { class: 'muted small' }, 'Same geometry as the DXF export.')),
        h('section', { class: 'card' }, h('h3', {}, 'Derived dimensions'),
          fit.complete ? h('table', { class: 'kv' },
            h('tr', {}, h('th', {}, 'Frame outer W x H'), h('td', {}, `${fit.frameOuterWidth} x ${fit.frameOuterHeight}`)),
            h('tr', {}, h('th', {}, 'Aperture (stop to stop)'), h('td', {}, `${fit.apertureWidth} x ${fit.apertureHeight}`)),
            h('tr', {}, h('th', {}, 'Expected leaf total'), h('td', {}, String(fit.expectedLeafTotal))),
            h('tr', {}, h('th', {}, 'Entered leaf total'), h('td', {}, String(fit.actualLeafTotal))),
            h('tr', {}, h('th', {}, 'Expected leaf height'), h('td', {}, String(fit.expectedLeafHeight))),
            h('tr', {}, h('th', {}, 'Nominal clear width'), h('td', {}, String(fit.nominalClearWidth))),
          ) : h('p', { class: 'muted' }, `Frame data incomplete: ${fit.missing.join(', ')}`)),
        h('section', { class: 'card' }, h('h3', {}, `QA checks - ${c.error} errors, ${c.warning} warnings`),
          issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', {}, sevBadge(i.severity), ' ', h('b', {}, i.ruleId), ' ', i.message, h('div', { class: 'muted small' }, `Check: ${i.check}. Action: ${i.action}. Source: ${i.source}.`)))) : h('p', { class: 'ok-text' }, 'No issues.')),
      ),
    ),
  );
}

export function doorsView(): HTMLElement {
  const p = project();
  const doors = filteredDoors();
  const sel = p.doors.find((d) => d.id === ui.selectedDoorId) ?? null;
  const add = () => {
    const f = ui.filter;
    const floor = p.floors.find((x) => x.id === f.floorId) ?? p.floors[0];
    const d = blankDoor({ buildingId: floor?.buildingId ?? p.buildings[0]?.id ?? '', floorId: floor?.id ?? '' });
    setProject({ ...p, doors: [...p.doors, d] });
    setUi({ selectedDoorId: d.id });
  };
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Door register'), h('p', { class: 'muted' }, 'One record per door. Blank fields stay blank and are flagged; nothing is assumed.')),
      h('button', { class: 'btn primary', onclick: add }, '+ Add door')),
    filterBar({ status: true, search: true }),
    h('datalist', { id: 'hw-codes' }, p.hardwareSets.map((s) => h('option', { value: s.code }, s.description))),
    h('div', { class: 'split' },
      h('div', { class: 'list card' },
        doors.length ? h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, ['Mark', 'Floor', 'Room / classes', 'Status', 'QA'].map((x) => h('th', {}, x)))),
          h('tbody', {}, doors.map((d) => {
            const c = counts(validateDoor(d, p));
            return h('tr', { class: d.id === ui.selectedDoorId ? 'sel' : '', tabindex: 0, onclick: () => setUi({ selectedDoorId: d.id }), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') setUi({ selectedDoorId: d.id }); } },
              h('td', { class: 'mono nowrap' }, d.mark || '(no mark)'), h('td', {}, floorName(p, d.floorId)),
              h('td', {}, d.room, h('div', { class: 'tags' }, classify(d, p).filter((x) => x.group !== 'material').map((x) => h('span', { class: 'tag' }, x.label)))),
              h('td', {}, h('span', { class: `status st-${d.status}` }, d.status)),
              h('td', { class: 'nowrap' }, c.error ? h('span', { class: 'badge sev-error' }, String(c.error)) : null, ' ', c.warning ? h('span', { class: 'badge sev-warning' }, String(c.warning)) : null, !c.error && !c.warning ? h('span', { class: 'ok-text' }, 'OK') : null));
          }))) : h('div', { class: 'empty' }, 'No doors match the filters.')),
      sel ? editor(sel) : h('div', { class: 'card empty' }, 'Select a door to edit, or add a new one.'),
    ),
  );
}
