import type { Project } from '../../core/types.js';
import { leafCount } from '../../core/types.js';
import { blankProject, sampleProject, uid } from '../../core/defaults.js';
import { floorName, isRated } from '../../core/classify.js';
import { counts, validateDoor, validateScope } from '../../core/validate.js';
import { hardwareTakeoff } from '../../core/schedule.js';
import { exportProject, importProject, removeBuilding, removeCategory, removeFloor } from '../../core/project-ops.js';
import { confirmButton, download, h, safeName, sevBadge, toast } from '../dom.js';
import { addProject, allProjects, deleteProject, project, setProject, setUi, storageAvailable, switchProject } from '../state.js';

const guard = (f: () => void) => { try { f(); } catch (e) { toast((e as Error).message, 'err'); } };

function textInput(id: string, value: string, on: (v: string) => void, attrs: Record<string, unknown> = {}) {
  return h('input', { id, type: 'text', value, onchange: (e: Event) => on((e.target as HTMLInputElement).value.trim()), ...attrs });
}

// ---------- dashboard ----------
export function dashboardView(): HTMLElement {
  const p = project();
  const all = validateScope(p, p.doors);
  const c = counts(all);
  const qty = p.doors.reduce((s, d) => s + (d.quantity ?? 0), 0);
  const leaves = p.doors.reduce((s, d) => s + (d.quantity ?? 0) * (d.configuration ? leafCount(d.configuration) : 0), 0);
  const floors = p.floors.slice().sort((a, b) => a.order - b.order);
  const top = all.filter((i) => i.severity === 'error').slice(0, 8);
  const hw = hardwareTakeoff(p, p.doors);
  return h('div', { class: 'view' },
    p.isSample ? h('div', { class: 'alert info' }, h('b', {}, 'Sample data. '), 'This project is illustrative sample data for trying the workflow. Create a new project or import a backup under Project data to start real work.') : null,
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, p.name), h('p', { class: 'muted' }, [p.number, p.client, p.location].filter(Boolean).join(' - ') || 'Project details not entered')),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => setUi({ view: 'doors' }) }, 'Door register'), h('button', { class: 'btn primary', onclick: () => setUi({ view: 'drawings' }) }, 'Drawing studio'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, String(p.doors.length)), h('span', {}, 'Door records')),
      h('div', { class: 'kpi' }, h('b', {}, String(qty)), h('span', {}, 'Doors (qty)')),
      h('div', { class: 'kpi' }, h('b', {}, String(leaves)), h('span', {}, 'Leaves')),
      h('div', { class: 'kpi' }, h('b', {}, String(p.doors.filter((d) => d.status === 'approved').length)), h('span', {}, 'Approved records')),
      h('div', { class: 'kpi sev-error' }, h('b', {}, String(c.error)), h('span', {}, 'Errors')),
      h('div', { class: 'kpi sev-warning' }, h('b', {}, String(c.warning)), h('span', {}, 'Warnings')),
    ),
    h('div', { class: 'cols' },
      h('section', { class: 'card' }, h('h3', {}, 'Floor-wise status'),
        h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
          h('thead', {}, h('tr', {}, ['Floor', 'Records', 'Qty', 'Fire-rated', 'Approved', 'Errors', 'Warnings'].map((x) => h('th', {}, x)))),
          h('tbody', {}, floors.map((f) => {
            const ds = p.doors.filter((d) => d.floorId === f.id);
            const fc = counts(ds.flatMap((d) => validateDoor(d, p)));
            return h('tr', { onclick: () => setUi({ view: 'schedule', filter: { floorId: f.id } }) },
              h('td', {}, f.name, p.buildings.length > 1 ? h('span', { class: 'muted small' }, ` ${p.buildings.find((b) => b.id === f.buildingId)?.name ?? ''}`) : null),
              h('td', { class: 'num' }, String(ds.length)), h('td', { class: 'num' }, String(ds.reduce((s, d) => s + (d.quantity ?? 0), 0))),
              h('td', { class: 'num' }, String(ds.filter((d) => isRated(d.fireRating)).length)),
              h('td', { class: 'num' }, String(ds.filter((d) => d.status === 'approved').length)),
              h('td', { class: 'num' }, fc.error ? h('span', { class: 'badge sev-error' }, String(fc.error)) : '0'),
              h('td', { class: 'num' }, fc.warning ? h('span', { class: 'badge sev-warning' }, String(fc.warning)) : '0'));
          })))),
        h('p', { class: 'muted small' }, 'Select a floor to open its schedule.')),
      h('section', { class: 'card' }, h('h3', {}, 'Blocking errors'),
        top.length ? h('ul', { class: 'issues' }, top.map((i) => h('li', { onclick: () => setUi({ view: 'doors', selectedDoorId: i.doorId }) }, sevBadge(i.severity), ' ', h('b', { class: 'mono' }, i.mark), ' ', i.message))) : h('p', { class: 'ok-text' }, 'No blocking errors.'),
        hw.unresolved.length ? h('div', {}, h('h4', {}, 'Hardware not resolved'), h('ul', { class: 'plain' }, hw.unresolved.map((u) => h('li', {}, u)))) : null),
      h('section', { class: 'card' }, h('h3', {}, 'Workflow'),
        h('ol', { class: 'steps' },
          h('li', {}, h('b', {}, 'Project setup'), ' - buildings, floors, categories, title block data.'),
          h('li', {}, h('b', {}, 'Door register'), ' - enter or import door data; blanks are flagged, never assumed.'),
          h('li', {}, h('b', {}, 'Classify and validate'), ' - automatic categories plus project categories; QA rules.'),
          h('li', {}, h('b', {}, 'Schedules'), ' - floor / category scoped door, quantity and hardware schedules.'),
          h('li', {}, h('b', {}, '2D CAD'), ' - dimensioned DXF sheets for the same scope.'),
          h('li', {}, h('b', {}, 'Issue'), ' - ZIP package: Excel, CSV, DXF per door, set DXF, manifest, backup.'))),
      h('section', { class: 'card' }, h('h3', {}, 'Integration status'),
        h('table', { class: 'kv' },
          h('tr', {}, h('th', {}, 'Storage'), h('td', {}, storageAvailable() ? 'Browser storage (this device only). Use backups.' : 'Browser storage unavailable - export a backup before closing.')),
          h('tr', {}, h('th', {}, 'DXF output'), h('td', {}, 'Available (AutoCAD R12 ASCII, mm)')),
          h('tr', {}, h('th', {}, 'DWG output'), h('td', {}, 'Not available - needs a licensed DWG engine')),
          h('tr', {}, h('th', {}, 'Drawing extraction (OCR)'), h('td', {}, 'Not configured - manual entry / JSON import')),
          h('tr', {}, h('th', {}, '3D viewer'), h('td', {}, 'Not in this release (phase 5)')),
          h('tr', {}, h('th', {}, 'Team database / login'), h('td', {}, 'Not configured (phase 6)')),
        )),
    ),
  );
}

// ---------- project setup ----------
export function projectView(): HTMLElement {
  const p = project();
  const set = (patch: Partial<Project>) => setProject({ ...project(), ...patch });
  const meta: [keyof Project, string][] = [['name', 'Project name'], ['number', 'Project number'], ['client', 'Client'], ['consultant', 'Consultant'], ['location', 'Location'], ['drawingPrefix', 'Drawing no. prefix'], ['revision', 'Project revision'], ['date', 'Issue date'], ['status', 'Design status'], ['preparedBy', 'Prepared by'], ['checkedBy', 'Checked by'], ['approvedBy', 'Approved by']];
  const floorsSorted = (bid: string) => p.floors.filter((f) => f.buildingId === bid).sort((a, b) => a.order - b.order);
  const move = (id: string, dir: -1 | 1) => {
    const f = p.floors.find((x) => x.id === id)!;
    const list = floorsSorted(f.buildingId);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    set({ floors: p.floors.map((x) => (x.id === a.id ? { ...x, order: b.order } : x.id === b.id ? { ...x, order: a.order } : x)) });
  };
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Project setup'), h('p', { class: 'muted' }, 'Title block data, buildings, floors and project categories.'))),
    h('div', { class: 'cols' },
      h('section', { class: 'card' }, h('h3', {}, 'Project and title block'),
        h('div', { class: 'fields' }, meta.map(([k, label]) => h('label', { class: 'fld' }, h('span', {}, label), textInput(`p-${String(k)}`, String(p[k] ?? ''), (v) => set({ [k]: v } as Partial<Project>), k === 'date' ? { type: 'date' } : {}))))),
      h('section', { class: 'card' }, h('h3', {}, 'Buildings and floors'),
        p.buildings.map((b) => h('div', { class: 'block' },
          h('div', { class: 'row gap' }, textInput(`b-${b.id}`, b.name, (v) => set({ buildings: p.buildings.map((x) => (x.id === b.id ? { ...x, name: v || x.name } : x)) })),
            h('button', { class: 'btn ghost sm', onclick: () => guard(() => setProject(removeBuilding(project(), b.id))) }, 'Remove building')),
          h('ul', { class: 'floors' }, floorsSorted(b.id).map((f) => h('li', { class: 'row gap' },
            textInput(`f-${f.id}`, f.name, (v) => set({ floors: p.floors.map((x) => (x.id === f.id ? { ...x, name: v || x.name } : x)) })),
            h('span', { class: 'muted small' }, `${p.doors.filter((d) => d.floorId === f.id).length} doors`),
            h('button', { class: 'btn ghost sm', 'aria-label': 'Move up', onclick: () => move(f.id, -1) }, 'Up'),
            h('button', { class: 'btn ghost sm', 'aria-label': 'Move down', onclick: () => move(f.id, 1) }, 'Down'),
            h('button', { class: 'btn ghost sm', onclick: () => guard(() => setProject(removeFloor(project(), f.id))) }, 'Remove')))),
          h('button', { class: 'btn sm', onclick: () => {
            const list = floorsSorted(b.id);
            set({ floors: [...p.floors, { id: uid('flr'), buildingId: b.id, name: `Level ${list.length}`, order: (list[list.length - 1]?.order ?? -1) + 1 }] });
          } }, '+ Add floor'))),
        h('button', { class: 'btn', onclick: () => set({ buildings: [...p.buildings, { id: uid('bld'), name: `Building ${String.fromCharCode(65 + p.buildings.length)}` }] }) }, '+ Add building')),
      h('section', { class: 'card' }, h('h3', {}, 'Project categories'),
        h('p', { class: 'muted small' }, 'Automatic classifications (leaf, operation, material, glazed, fire-rated, acoustic, access-controlled) are derived from door data. Add project-specific categories here and assign them per door.'),
        h('ul', { class: 'floors' }, p.categories.map((c) => h('li', { class: 'row gap' },
          textInput(`cat-${c.id}`, c.name, (v) => set({ categories: p.categories.map((x) => (x.id === c.id ? { ...x, name: v || x.name } : x)) })),
          h('span', { class: 'muted small' }, `${p.doors.filter((d) => d.categoryIds.includes(c.id)).length} doors`),
          h('button', { class: 'btn ghost sm', onclick: () => setProject(removeCategory(project(), c.id)) }, 'Remove')))),
        h('button', { class: 'btn sm', onclick: () => set({ categories: [...p.categories, { id: uid('cat'), name: 'New category' }] }) }, '+ Add category')),
      h('section', { class: 'card' }, h('h3', {}, 'Revision register'),
        h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ['Rev', 'Date', 'Description', 'By', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, p.revisions.map((r, i) => h('tr', {},
            ...(['rev', 'date', 'description', 'by'] as const).map((k) => h('td', {}, textInput(`rev-${i}-${k}`, r[k], (v) => set({ revisions: p.revisions.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })))),
            h('td', {}, h('button', { class: 'btn ghost sm', onclick: () => set({ revisions: p.revisions.filter((_, j) => j !== i) }) }, 'Remove')))))),
        h('button', { class: 'btn sm', onclick: () => set({ revisions: [...p.revisions, { rev: p.revision, date: new Date().toISOString().slice(0, 10), description: '', by: p.preparedBy }] }) }, '+ Add revision')),
    ),
  );
}

// ---------- data ----------
export function dataView(): HTMLElement {
  const p = project();
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const imported = importProject(await f.text());
      const replaced = allProjects().some((x) => x.id === imported.id);
      addProject(imported);
      toast(`${replaced ? 'Replaced' : 'Imported'} ${imported.name}: ${imported.doors.length} doors`, 'ok');
    } catch (err) { toast((err as Error).message, 'err'); }
  } }) as HTMLInputElement;
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Project data'), h('p', { class: 'muted' }, 'Projects are stored in this browser. Export a JSON backup to keep or share a project.'))),
    h('div', { class: 'cols' },
      h('section', { class: 'card' }, h('h3', {}, 'Projects'),
        h('table', { class: 'grid' }, h('tbody', {}, allProjects().map((x) => h('tr', { class: x.id === p.id ? 'sel' : '' },
          h('td', {}, x.name, x.isSample ? h('span', { class: 'tag' }, 'sample') : null), h('td', { class: 'num' }, `${x.doors.length} doors`),
          h('td', { class: 'nowrap' }, x.id === p.id ? h('span', { class: 'muted small' }, 'current') : h('button', { class: 'btn sm', onclick: () => switchProject(x.id) }, 'Open'), ' ',
            confirmButton('Delete', 'btn ghost sm', () => deleteProject(x.id), 'Confirm delete')))))),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn primary', onclick: () => { addProject(blankProject('New project')); setUi({ view: 'project' }); toast('New project created: set its name in Project setup', 'ok'); } }, '+ New blank project'),
          h('button', { class: 'btn', onclick: () => addProject(sampleProject()) }, 'Load sample project'))),
      h('section', { class: 'card' }, h('h3', {}, 'Backup and restore'),
        h('p', {}, h('button', { class: 'btn', onclick: () => download(`${safeName(p.name)}_backup_${new Date().toISOString().slice(0, 10)}.json`, exportProject(p), 'application/json') }, 'Export JSON backup (current project)')),
        h('p', {}, h('button', { class: 'btn', onclick: () => file.click() }, 'Import JSON backup'), file),
        h('p', { class: 'muted small' }, 'Imports accept DOCHS backups. Fields added in later versions are filled as blank and flagged by QA.')),
      h('section', { class: 'card' }, h('h3', {}, 'Reference drawing extraction'),
        h('div', { class: 'alert warn' }, h('b', {}, 'Not configured. '), 'OCR / table extraction from PDF or images needs a server-side extraction service, which is not connected in this release. DOCHS does not simulate extraction. Enter doors manually or import a JSON backup.')),
      h('section', { class: 'card' }, h('h3', {}, 'Open doors by floor'),
        h('ul', { class: 'plain' }, p.floors.slice().sort((a, b) => a.order - b.order).map((f) => h('li', {}, `${floorName(p, f.id)}: ${p.doors.filter((d) => d.floorId === f.id && d.status !== 'approved').length} not approved`)))),
    ),
  );
}
