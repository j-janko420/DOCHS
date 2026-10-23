import type { Configuration, Handing, MaterialKind } from '../core/types.js';
import { CONFIG_LABEL } from '../core/types.js';
import { DOOR_STYLES, HARDWARE_FUNCTIONS, HARDWARE_TYPES, HINGE_CHOICES, REFERENCE_MATERIALS, type Performance } from '../core/reference.js';
import { addDesignedDoor, applyStyle, defaultDesign, designDoor, hardwareLines, withPerformance, type DesignInput, type Vision } from '../core/designer.js';
import { composeSheet } from '../cad/sheet.js';
import { toSvg } from '../cad/svg.js';
import { h, toast } from './dom.js';
import { viewer3d } from './viewer3d.js';
import { project, setProject, setUi } from './state.js';

// "Design your door": a pop-up configurator. State lives here so it survives
// closing and reopening the pop-up during a session.

let input: DesignInput = defaultDesign();
let add = { mark: '', floorId: '', room: '', quantity: 1 };

const PERF_LABEL: Record<Performance, string> = { 'non-fr': 'Non fire-rated', fr: 'Fire-rated', acoustic: 'Acoustic', 'fr-acoustic': 'Fire-rated + acoustic' };
const FIRE = ['30 min', '60 min', '90 min', '120 min'];
const ACOUSTIC = ['30 dB', '35 dB', '40 dB', '45 dB'];
const VISION: Record<Vision, string> = { none: 'No glass', narrow: 'Narrow vision strip', standard: 'Vision panel', full: 'Fully glazed' };

function chips<T extends string>(id: string, options: [T, string][], value: T, on: (v: T) => void, title?: (v: T) => string): HTMLElement {
  return h('div', { class: 'chips', role: 'radiogroup', id },
    options.map(([v, l]) => h('button', { type: 'button', class: `chip ${v === value ? 'on' : ''}`, role: 'radio', 'aria-checked': v === value ? 'true' : 'false', title: title?.(v), onclick: () => on(v) }, l)));
}

function num(id: string, label: string, value: number, on: (v: number) => void, unit = 'mm') {
  return h('label', { class: 'fld' }, h('span', {}, label, h('em', {}, ` ${unit}`)),
    h('input', { id, type: 'number', inputmode: 'decimal', value, min: 0, step: 1, onchange: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 0) on(v); else toast(`${label}: enter a number`, 'err');
    } }));
}

function matSelect(id: string, label: string, kind: MaterialKind, value: string, on: (v: string) => void) {
  const names = [...new Set([...REFERENCE_MATERIALS.filter((m) => m.kind === kind).map((m) => m.name), ...project().materials.filter((m) => m.kind === kind).map((m) => m.name), value].filter(Boolean))];
  return h('label', { class: 'fld' }, h('span', {}, label),
    h('select', { id, onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
      h('option', { value: '', selected: !value }, '- none -'), names.map((n) => h('option', { value: n, selected: n === value }, n))));
}

function section(title: string, ...body: (HTMLElement | null)[]) {
  return h('section', { class: 'dz-sec' }, h('h3', {}, title), ...body);
}

export function designerPanel(rerender: () => void, onDone: () => void): HTMLElement {
  const set = (patch: Partial<DesignInput>) => { input = { ...input, ...patch }; rerender(); };
  const p = project();
  const style = DOOR_STYLES.find((s) => s.key === input.styleKey)!;
  const r = designDoor(input);
  const lines = hardwareLines(input);
  const fn = HARDWARE_FUNCTIONS.find((f) => f.key === input.hardwareFunction);
  if (!add.floorId || !p.floors.some((f) => f.id === add.floorId)) add.floorId = p.floors.slice().sort((a, b) => a.order - b.order)[0]?.id ?? '';
  const sliding = input.configuration.startsWith('sliding') || input.configuration === 'pocket';
  let preview: HTMLElement;
  if (r.errors.length) preview = h('div', { class: 'alert err' }, r.errors.join(' '));
  else {
    const door = { ...r.door, mark: add.mark || 'NEW', floorId: add.floorId, buildingId: p.floors.find((f) => f.id === add.floorId)?.buildingId ?? '' };
    const s = composeSheet(p, door, { size: 'A3' });
    preview = h('div', { class: 'dz-sheet', html: toSvg(s.entities, { width: s.paper[0] * s.S, height: s.paper[1] * s.S, S: s.S, background: '#ffffff' }) });
  }
  const groups = [...new Set(DOOR_STYLES.map((s) => s.group))];
  const options = h('div', { class: 'dz-options' },
    section('1. Structural opening',
      h('div', { class: 'fields' },
        num('dz-w', 'S.O. width', input.soWidth, (v) => set({ soWidth: v })),
        num('dz-h', 'S.O. height', input.soHeight, (v) => set({ soHeight: v })),
        num('dz-t', 'Wall thickness', input.wallThickness, (v) => set({ wallThickness: v })))),
    section('2. Door style',
      ...groups.map((g) => h('div', { class: 'dz-group' }, h('div', { class: 'dz-group-name' }, g),
        h('div', { class: 'dz-cards' }, DOOR_STYLES.filter((s) => s.group === g).map((s) => h('button', { type: 'button', class: `dz-card ${s.key === input.styleKey ? 'on' : ''}`, 'aria-pressed': s.key === input.styleKey ? 'true' : 'false', onclick: () => { input = applyStyle(input, s.key); rerender(); } },
          h('b', {}, s.name), h('span', {}, s.description))))))),
    section('3. Leaves and operation',
      chips('dz-config', style.configurations.map((c) => [c, CONFIG_LABEL[c]] as [Configuration, string]), input.configuration, (v) => {
        input = { ...input, configuration: v, rebateDepth: v.startsWith('sliding') || v === 'pocket' || style.key === 'glass-frameless' ? 0 : input.rebateDepth || 15, hardwareFunction: v.startsWith('sliding') || v === 'pocket' ? 'sliding' : input.hardwareFunction === 'sliding' ? 'passage' : input.hardwareFunction };
        rerender();
      }),
      input.configuration === 'double-unequal' ? chips('dz-ratio', [['0.6', '60 / 40'], ['0.65', '65 / 35'], ['0.7', '70 / 30']], String(input.unequalRatio), (v) => set({ unequalRatio: Number(v) })) : null,
      h('div', { class: 'muted small' }, sliding ? 'Slide direction (viewed from outside)' : 'Handing (viewed from outside): LH / RH open away, LHR / RHR open towards you'),
      chips('dz-hand', (sliding ? [['LH', 'Slides left'], ['RH', 'Slides right']] : [['LH', 'LH'], ['RH', 'RH'], ['LHR', 'LHR'], ['RHR', 'RHR']]) as [Handing, string][], input.handing, (v) => set({ handing: v }))),
    section('4. Fire and acoustic',
      chips('dz-perf', style.performance.map((x) => [x, PERF_LABEL[x]] as [Performance, string]), input.performance, (v) => { input = withPerformance(input, v); rerender(); }),
      input.fireRating ? chips('dz-fr', FIRE.map((x) => [x, `FR ${x}`] as [string, string]), input.fireRating, (v) => set({ fireRating: v })) : null,
      input.acousticRating ? chips('dz-ac', ACOUSTIC.map((x) => [x, x] as [string, string]), input.acousticRating, (v) => set({ acousticRating: v })) : null,
      input.performance !== 'non-fr' ? h('p', { class: 'muted small' }, 'Ratings are targets. Fire and acoustic performance come only from a tested, certified assembly (leaf, frame, glass, seals and hardware together).') : null),
    section('5. Materials and finishes',
      h('div', { class: 'fields' },
        matSelect('dz-leaf', 'Leaf material', 'leaf', input.leafMaterial, (v) => set({ leafMaterial: v })),
        matSelect('dz-core', 'Core', 'core', input.core, (v) => set({ core: v })),
        matSelect('dz-facing', 'Facing (veneer, laminate, ...)', 'facing', input.facing, (v) => set({ facing: v })),
        matSelect('dz-f1', 'Finish side 1 (outside)', 'finish', input.finish1, (v) => set({ finish1: v })),
        matSelect('dz-f2', 'Finish side 2 (inside)', 'finish', input.finish2, (v) => set({ finish2: v })),
        matSelect('dz-frame', 'Frame', 'frame', input.frameMaterial, (v) => set({ frameMaterial: v })),
        matSelect('dz-ff', 'Frame finish', 'finish', input.frameFinish, (v) => set({ frameFinish: v })))),
    section('6. Glass',
      chips('dz-vision', (Object.entries(VISION) as [Vision, string][]).filter(([k]) => style.glazed !== 'none' || k === 'none'), input.vision, (v) => set({ vision: v, glazingType: v === 'none' ? '' : input.fireRating ? 'Fire-resisting glass' : input.acousticRating ? 'Acoustic laminated glass' : input.glazingType || 'Clear toughened glass' })),
      input.vision !== 'none' ? h('div', { class: 'fields' }, matSelect('dz-glz', 'Glazing type', 'glazing', input.glazingType, (v) => set({ glazingType: v }))) : null),
    section('7. Hardware',
      h('div', { class: 'dz-cards' }, HARDWARE_FUNCTIONS.filter((f) => (sliding ? f.key === 'sliding' || f.key === 'none' : f.key !== 'sliding')).map((f) => h('button', { type: 'button', class: `dz-card sm ${f.key === input.hardwareFunction ? 'on' : ''}`, 'aria-pressed': f.key === input.hardwareFunction ? 'true' : 'false', onclick: () => set({ hardwareFunction: f.key }) }, h('b', {}, f.name), h('span', {}, f.description)))),
      !sliding && input.configuration !== 'pivot' && !input.configuration.startsWith('double-action') ? h('div', {}, h('div', { class: 'muted small' }, 'Hinge type'),
        chips('dz-hinge', HINGE_CHOICES.map((x) => [x, x] as [string, string]), input.hinge, (v) => set({ hinge: v }), (v) => HARDWARE_TYPES.find((t) => t.name === v)?.func ?? '')) : null,
      h('label', { class: 'fld check' }, h('input', { id: 'dz-kick', type: 'checkbox', checked: input.kickPlate, onchange: (e: Event) => set({ kickPlate: (e.target as HTMLInputElement).checked }) }), h('span', {}, 'Kick plate')),
      lines.length ? h('table', { class: 'grid dense' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Qty'), h('th', {}, 'What it does'))),
        h('tbody', {}, lines.map((l) => h('tr', {}, h('td', {}, l.type), h('td', { class: 'nowrap' }, `${l.qty} ${l.basis === 'per-leaf' ? 'per leaf' : 'per door'}`), h('td', { class: 'small' }, HARDWARE_TYPES.find((t) => t.name === l.type)?.func ?? ''))))) : h('p', { class: 'muted small' }, fn?.description ?? '')),
    h('details', { class: 'dz-sec' }, h('summary', {}, '8. Frame and gap assumptions (edit to match the chosen system)'),
      h('div', { class: 'fields' },
        num('dz-lt', 'Leaf thickness', input.leafThickness, (v) => set({ leafThickness: v })),
        num('dz-fw', 'Frame face width', input.frameWidth, (v) => set({ frameWidth: v })),
        num('dz-rb', 'Rebate depth', input.rebateDepth, (v) => set({ rebateDepth: v })),
        num('dz-ig', 'Install gap', input.installGap, (v) => set({ installGap: v })),
        num('dz-eg', 'Leaf edge gap', input.edgeGap, (v) => set({ edgeGap: v })),
        num('dz-uc', 'Undercut', input.undercut, (v) => set({ undercut: v })),
        num('dz-hh', 'Handle height (FFL)', input.handleHeight, (v) => set({ handleHeight: v })),
        sliding ? num('dz-ov', 'Sliding overlap per side', input.slidingOverlap, (v) => set({ slidingOverlap: v })) : null),
      h('p', { class: 'muted small' }, 'These are starting values, not manufacturer data. The door is saved as Draft with a note to verify them.')),
  );
  const summary = h('div', { class: 'dz-summary' },
    h('div', { class: 'kv-grid' },
      h('span', {}, 'Style'), h('b', {}, style.name),
      h('span', {}, 'Leaves'), h('b', {}, r.leaves.join(' + ') + ' mm'),
      h('span', {}, 'Leaf height'), h('b', {}, `${r.leafHeight} mm`),
      h('span', {}, 'Leaf thickness'), h('b', {}, `${input.leafThickness} mm`),
      h('span', {}, 'Aperture (stop to stop)'), h('b', {}, `${r.aperture} mm`),
      r.clearWidth != null ? h('span', {}, 'Nominal clear width') : null, r.clearWidth != null ? h('b', {}, `${r.clearWidth} mm`) : null,
      h('span', {}, 'Performance'), h('b', {}, [input.fireRating && `FR ${input.fireRating}`, input.acousticRating].filter(Boolean).join(' / ') || 'Non-rated'),
      h('span', {}, 'Finish'), h('b', {}, `${input.facing} - ${input.finish1}${input.finish2 !== input.finish1 ? ` / ${input.finish2}` : ''}`)),
    r.notes.map((n) => h('p', { class: 'muted small' }, n)));
  const floors = p.floors.slice().sort((a, b) => a.order - b.order);
  const addForm = h('div', { class: 'dz-add' },
    h('div', { class: 'fields' },
      h('label', { class: 'fld' }, h('span', {}, 'Door mark'), h('input', { id: 'dz-mark', type: 'text', value: add.mark, placeholder: 'e.g. D-105', onchange: (e: Event) => { add.mark = (e.target as HTMLInputElement).value.trim(); rerender(); } })),
      h('label', { class: 'fld' }, h('span', {}, 'Floor'), h('select', { id: 'dz-floor', onchange: (e: Event) => { add.floorId = (e.target as HTMLSelectElement).value; rerender(); } },
        floors.map((f) => h('option', { value: f.id, selected: f.id === add.floorId }, p.buildings.length > 1 ? `${f.name} (${p.buildings.find((b) => b.id === f.buildingId)?.name})` : f.name)))),
      h('label', { class: 'fld' }, h('span', {}, 'Room'), h('input', { id: 'dz-room', type: 'text', value: add.room, onchange: (e: Event) => { add.room = (e.target as HTMLInputElement).value.trim(); } })),
      h('label', { class: 'fld' }, h('span', {}, 'Quantity'), h('input', { id: 'dz-qty', type: 'number', min: 1, step: 1, value: add.quantity, onchange: (e: Event) => { add.quantity = Math.max(1, Math.round(Number((e.target as HTMLInputElement).value)) || 1); } }))),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn primary', disabled: r.errors.length > 0, onclick: () => {
        try {
          const floor = p.floors.find((f) => f.id === add.floorId);
          if (!floor) throw new Error('Add a floor in Project setup first');
          const res = addDesignedDoor(project(), input, { mark: add.mark, buildingId: floor.buildingId, floorId: floor.id, room: add.room, quantity: add.quantity });
          setProject(res.project);
          toast(`${res.door.mark} added to ${floor.name} with drawings, schedule and hardware set ${res.door.hardwareSet || '(none)'}`, 'ok');
          add = { ...add, mark: '', room: '' };
          onDone();
          setUi({ view: 'doors', selectedDoorId: res.door.id });
        } catch (e) { toast((e as Error).message, 'err'); }
      } }, 'Add door to project'),
      h('button', { type: 'button', class: 'btn', onclick: () => { input = defaultDesign(); rerender(); } }, 'Start again')));
  return h('div', { class: 'dz' },
    options,
    h('div', { class: 'dz-preview' }, h('h3', {}, 'Live drawing'), preview, r.errors.length ? null : h('h3', {}, '3D model'), r.errors.length ? null : viewer3d({ ...r.door, mark: add.mark || 'NEW' }, 'designer', 340), summary, h('h3', {}, 'Add to project'), addForm));
}

// ---------- pop-up ----------

let overlay: HTMLElement | null = null;

export function openDesigner() {
  if (overlay) return;
  const close = () => { overlay?.remove(); overlay = null; document.removeEventListener('keydown', onKey); last?.focus(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const last = document.activeElement as HTMLElement | null;
  const body = h('div', { class: 'dz-body' });
  const render = () => {
    const active = document.activeElement as HTMLElement | null;
    const id = active && body.contains(active) ? active.id : '';
    const scroll = body.querySelector('.dz-options')?.scrollTop ?? 0;
    body.replaceChildren(designerPanel(render, close));
    const opts = body.querySelector('.dz-options');
    if (opts) opts.scrollTop = scroll;
    if (id) (document.getElementById(id) as HTMLElement | null)?.focus({ preventScroll: true });
  };
  overlay = h('div', { class: 'dz-overlay', onclick: (e: Event) => { if (e.target === overlay) close(); } },
    h('div', { class: 'dz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dz-title' },
      h('header', { class: 'dz-head' },
        h('div', {}, h('h2', { id: 'dz-title' }, 'Design your door'), h('p', { class: 'muted small' }, 'Enter the structural opening, click your options, and add the door to the project with drawings, schedule and hardware.')),
        h('div', { class: 'row gap' },
          h('a', { class: 'btn', href: '#/designer', onclick: () => close() }, 'Full page'),
          h('button', { type: 'button', class: 'btn', onclick: close, 'aria-label': 'Close' }, 'Close'))),
      body));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  render();
  (overlay.querySelector('#dz-w') as HTMLElement | null)?.focus();
}

export function presetStyle(key: string) {
  input = applyStyle(input, key);
}

export function designerView(): HTMLElement {
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Design your door'), h('p', { class: 'muted' }, 'Enter the structural opening, click your options, and add the door to the project with drawings, schedule and hardware.'))),
    h('div', { class: 'dz-page' }, designerPanel(() => setUi({}), () => undefined)));
}
