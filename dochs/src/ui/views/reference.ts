import { HARDWARE_CATEGORIES, MATERIAL_KINDS, type HardwareCategory, type MaterialKind } from '../../core/types.js';
import { DOOR_STYLES, HARDWARE_FUNCTIONS, HARDWARE_TYPES, REFERENCE_MATERIALS, installReference } from '../../core/reference.js';
import { h, toast } from '../dom.js';
import { project, setProject, setUi } from '../state.js';
import { openDesigner, presetStyle } from '../designer.js';

let tab = 0;
let q = '';

const match = (...s: string[]) => !q || s.join(' ').toLowerCase().includes(q.toLowerCase());

function doorTypes(): HTMLElement {
  const groups = [...new Set(DOOR_STYLES.map((s) => s.group))];
  return h('div', { class: 'stack' }, groups.map((g) => {
    const list = DOOR_STYLES.filter((s) => s.group === g && match(s.name, s.description, s.leaf, s.facing, s.finish));
    if (!list.length) return null;
    return h('section', { class: 'card' }, h('h3', {}, g),
      h('div', { class: 'ref-grid' }, list.map((s) => h('article', { class: 'ref-card' },
        h('b', {}, s.name), h('p', { class: 'small' }, s.description),
        h('dl', { class: 'ref-dl' },
          h('dt', {}, 'Performance'), h('dd', {}, s.performance.map((x) => ({ 'non-fr': 'Non-FR', fr: 'FR', acoustic: 'Acoustic', 'fr-acoustic': 'FR + acoustic' })[x]).join(', ')),
          h('dt', {}, 'Construction'), h('dd', {}, `${s.leaf} / ${s.core} / ${s.facing}`),
          h('dt', {}, 'Typical finish'), h('dd', {}, s.finish),
          h('dt', {}, 'Frame'), h('dd', {}, `${s.frame}, ${s.frameFinish}`),
          h('dt', {}, 'Glass'), h('dd', {}, s.glazed === 'full' ? 'Fully glazed' : s.glazed === 'optional' ? 'Vision panel optional' : 'Not glazed')),
        h('button', { class: 'btn sm primary', onclick: () => { presetStyle(s.key); openDesigner(); } }, 'Design this door')))));
  }));
}

function materials(): HTMLElement {
  const kinds = Object.keys(MATERIAL_KINDS) as MaterialKind[];
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, `${REFERENCE_MATERIALS.length} generic materials and finishes. Adding them creates unverified library entries to complete with manufacturer data.`), h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => { const r = installReference(project(), { materials: true }); setProject(r.project); toast(r.added ? `Added ${r.added} item(s) to the material library` : 'All reference materials are already in the library', 'ok'); } }, 'Add all to project library')),
    kinds.map((k) => {
      const list = REFERENCE_MATERIALS.filter((m) => m.kind === k && match(m.name, m.note));
      if (!list.length) return null;
      return h('section', { class: 'card' }, h('h3', {}, MATERIAL_KINDS[k]),
        h('table', { class: 'grid dense' }, h('tbody', {}, list.map((m) => {
          const inLib = project().materials.some((x) => x.kind === m.kind && x.name.toLowerCase() === m.name.toLowerCase());
          return h('tr', {}, h('td', { class: 'nowrap' }, h('b', {}, m.name)), h('td', { class: 'small' }, m.note), h('td', { class: 'small nowrap' }, inLib ? h('span', { class: 'ok-text' }, 'in library') : ''));
        }))));
    }));
}

function hardware(): HTMLElement {
  const cats = Object.keys(HARDWARE_CATEGORIES) as HardwareCategory[];
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, `${HARDWARE_TYPES.length} hardware types with their function. Adding them creates unverified catalogue entries to complete with manufacturer data.`), h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => { const r = installReference(project(), { hardware: true }); setProject(r.project); toast(r.added ? `Added ${r.added} type(s) to the hardware catalogue` : 'All reference types are already in the catalogue', 'ok'); } }, 'Add all to hardware catalogue')),
    h('section', { class: 'card' }, h('h3', {}, 'Hardware functions (typical sets)'),
      h('div', { class: 'ref-grid' }, HARDWARE_FUNCTIONS.filter((f) => f.lines.length && match(f.name, f.description, ...f.lines.map((l) => l.type))).map((f) => h('article', { class: 'ref-card' },
        h('b', {}, f.name), h('p', { class: 'small' }, f.description),
        h('ul', { class: 'plain small' }, f.lines.map((l) => h('li', {}, `${l.qty} x ${l.type} (${l.basis === 'per-leaf' ? 'per leaf' : 'per door'})`))))))),
    cats.map((c) => {
      const list = HARDWARE_TYPES.filter((t) => t.category === c && match(t.name, t.func, HARDWARE_CATEGORIES[c]));
      if (!list.length) return null;
      return h('section', { class: 'card' }, h('h3', {}, HARDWARE_CATEGORIES[c]),
        h('table', { class: 'grid dense' }, h('tbody', {}, list.map((t) => h('tr', {},
          h('td', { class: 'nowrap' }, h('b', {}, t.name)), h('td', { class: 'small' }, t.func), h('td', { class: 'small nowrap' }, t.powered ? h('span', { class: 'badge sev-info' }, 'powered') : ''))))));
    }));
}

export function referenceView(): HTMLElement {
  const tabs = ['Door types', 'Materials and finishes', 'Hardware types'];
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Door library'), h('p', { class: 'muted' }, 'Reference of door types (FR, non-FR, acoustic, glass, timber, aluminium, steel, stone), materials, finishes and hardware with what each does. Generic types only: no manufacturer data.')),
      h('button', { class: 'btn primary', onclick: () => openDesigner() }, 'Design your door')),
    h('div', { class: 'toolbar' }, h('label', { class: 'fld inline grow' }, h('span', {}, 'Search'), h('input', { id: 'ref-q', type: 'search', value: q, placeholder: 'e.g. veneer, intumescent, panic, pivot', onchange: (e: Event) => { q = (e.target as HTMLInputElement).value.trim(); setUi({}); } }))),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map((name, i) => h('button', { role: 'tab', 'aria-selected': i === tab ? 'true' : 'false', class: `tab ${i === tab ? 'on' : ''}`, onclick: () => { tab = i; setUi({}); } }, name))),
    [doorTypes, materials, hardware][tab]());
}
