import { allClassifications, filterDoors } from '../core/classify.js';
import type { Door } from '../core/types.js';
import { h } from './dom.js';
import { project, setUi, ui } from './state.js';

// Floor and category filters are shared by the register, schedules, drawings and
// QA, so a selection defines exactly which doors go into each output.
export function filteredDoors(): Door[] {
  return filterDoors(project(), ui.filter);
}

export function filterBar(opts: { status?: boolean; search?: boolean } = {}): HTMLElement {
  const p = project();
  const f = ui.filter;
  const floors = p.floors.filter((x) => !f.buildingId || x.buildingId === f.buildingId).sort((a, b) => a.order - b.order);
  const cls = allClassifications(p);
  const groups = [...new Set(cls.map((c) => c.group))];
  const set = (patch: Partial<typeof f>) => setUi({ filter: { ...f, ...patch } });
  const keys = new Set(f.categoryKeys ?? []);
  const sel = (id: string, label: string, value: string, options: [string, string][], on: (v: string) => void) =>
    h('label', { class: 'fld' }, h('span', {}, label),
      h('select', { id, onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
        options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))));
  const n = filteredDoors().length;
  return h('div', { class: 'filterbar' },
    h('div', { class: 'filter-row' },
      p.buildings.length > 1 ? sel('flt-bld', 'Building', f.buildingId ?? '', [['', 'All buildings'], ...p.buildings.map((b) => [b.id, b.name] as [string, string])], (v) => set({ buildingId: v || undefined, floorId: undefined })) : null,
      sel('flt-floor', 'Floor', f.floorId ?? '', [['', 'All floors'], ...floors.map((x) => [x.id, p.buildings.length > 1 ? `${x.name} (${p.buildings.find((b) => b.id === x.buildingId)?.name})` : x.name] as [string, string])], (v) => set({ floorId: v || undefined })),
      opts.status ? sel('flt-status', 'Status', f.status ?? '', [['', 'Any status'], ['draft', 'Draft'], ['for-review', 'For review'], ['approved', 'Approved'], ['on-hold', 'On hold']], (v) => set({ status: v || undefined })) : null,
      opts.search ? h('label', { class: 'fld grow' }, h('span', {}, 'Search'), h('input', { id: 'flt-q', type: 'search', placeholder: 'Mark, room, type, HW set', value: f.search ?? '', onchange: (e: Event) => set({ search: (e.target as HTMLInputElement).value || undefined }) })) : null,
      h('div', { class: 'filter-count' }, h('b', {}, String(n)), ` door record${n === 1 ? '' : 's'}`),
      (f.floorId || f.buildingId || keys.size || f.status || f.search) ? h('button', { class: 'btn ghost sm', onclick: () => setUi({ filter: {} }) }, 'Clear filters') : null,
    ),
    h('div', { class: 'chips' },
      h('span', { class: 'chips-label' }, 'Categories'),
      groups.map((g) => h('span', { class: 'chip-group' },
        cls.filter((c) => c.group === g).map((c) => h('button', {
          class: `chip ${keys.has(c.key) ? 'on' : ''}`,
          title: `${g}: ${c.label}`,
          'aria-pressed': keys.has(c.key) ? 'true' : 'false',
          onclick: () => { keys.has(c.key) ? keys.delete(c.key) : keys.add(c.key); set({ categoryKeys: [...keys] }); },
        }, c.label)))),
    ),
  );
}
