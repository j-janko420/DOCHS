import { h } from './ui/dom.js';
import { allProjects, demoOnly, isDemo, load, project, setUi, subscribe, switchProject, ui } from './ui/state.js';
import { importView } from './ui/views/import.js';
import { VERSION, aboutView } from './ui/views/about.js';
import { doorsView } from './ui/views/doors.js';
import { drawingsView, qaView, scheduleView } from './ui/views/outputs.js';
import { dashboardView, dataView, projectView } from './ui/views/setup.js';
import { hardwareView } from './ui/views/hardware.js';
import { materialsView } from './ui/views/materials.js';
import { referenceView } from './ui/views/reference.js';
import { intakeView } from './ui/views/intake.js';
import { renderView } from './ui/views/render.js';
import { designerView } from './ui/designer.js';
import { BRAND, CREDIT, TAGLINE, mark } from './ui/brand.js';
import { doorOpenSound, setSound, soundOn } from './ui/sound.js';

type Menu = 'main' | 'settings' | 'route';
const VIEWS: { key: string; label: string; icon: string; menu: Menu; render: () => HTMLElement }[] = [
  { key: 'dashboard', label: 'Dashboard', menu: 'main', icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', render: dashboardView },
  { key: 'doors', label: 'Doors', menu: 'main', icon: 'M6 21V3h12v18M14 12h1M3 21h18', render: doorsView },
  { key: 'schedule', label: 'Schedules', menu: 'main', icon: 'M3 5h18M3 10h18M3 15h18M3 20h18M9 5v15', render: scheduleView },
  { key: 'drawings', label: '2D Drawings', menu: 'main', icon: 'M4 20h16M4 20V4m0 16L20 4M8 8h3M8 12h6', render: drawingsView },
  { key: 'render', label: '3D & Render', menu: 'main', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', render: renderView },
  { key: 'hardware', label: 'Hardware', menu: 'main', icon: 'M14 7a4 4 0 1 0-4 4l-6 6 3 3 6-6a4 4 0 0 0 1-7z', render: hardwareView },
  { key: 'materials', label: 'Materials', menu: 'main', icon: 'M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4', render: materialsView },
  { key: 'qa', label: 'Checks', menu: 'main', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4', render: qaView },
  { key: 'reference', label: 'Library', menu: 'main', icon: 'M4 5h6v15H4zM10 5h4v15h-4zM15 6l4 1-3 13-4-1z', render: referenceView },
  { key: 'project', label: 'Project details', menu: 'settings', icon: '', render: projectView },
  { key: 'import', label: 'Import schedule (manual mapping)', menu: 'settings', icon: '', render: importView },
  { key: 'data', label: 'Data, backup & server', menu: 'settings', icon: '', render: dataView },
  { key: 'about', label: 'About & test guide', menu: 'settings', icon: '', render: aboutView },
  { key: 'intake', label: 'New project', menu: 'route', icon: '', render: intakeView },
  { key: 'designer', label: 'Design your door', menu: 'route', icon: '', render: designerView },
];

const icon = (d: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};

function settingsMenu(current: string): HTMLElement {
  const items = VIEWS.filter((v) => v.menu === 'settings');
  return h('details', { class: 'hdr-menu' },
    h('summary', { class: 'hdr-icon', 'aria-label': 'Settings and more', title: 'Settings and more' }, icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z')),
    h('div', { class: 'hdr-pop', role: 'menu' },
      items.map((v) => h('a', { href: `#/${v.key}`, role: 'menuitem', class: v.key === current ? 'on' : '', onclick: (e: Event) => (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open') }, v.label)),
      h('label', { class: 'hdr-toggle' }, h('input', { type: 'checkbox', checked: soundOn(), onchange: (e: Event) => setSound((e.target as HTMLInputElement).checked) }), 'Door sounds'),
      h('div', { class: 'hdr-ver' }, `${BRAND} ${VERSION} · ${CREDIT}`)));
}

function header(current: string): HTMLElement {
  const p = project();
  return h('header', { class: 'hdr' },
    h('a', { class: 'hdr-brand', href: '#/dashboard', 'aria-label': `${BRAND} home` },
      mark('brand-mark'),
      h('span', { class: 'brand-rule', 'aria-hidden': 'true' }),
      h('span', { class: 'brand-text' },
        h('span', { class: 'brand-name' }, 'DOR', h('em', {}, 'SCH')),
        h('span', { class: 'brand-tag' }, TAGLINE))),
    h('div', { class: 'hdr-right' },
      h('label', { class: 'hdr-proj' }, h('span', {}, 'Project'),
        h('select', { id: 'proj-select', onchange: (e: Event) => switchProject((e.target as HTMLSelectElement).value) }, allProjects().map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name)))),
      h('a', { class: 'btn hdr-new', href: '#/intake' }, '+ New project'),
      settingsMenu(current)));
}

function doorFab(): HTMLElement {
  const b = h('button', { class: 'door-fab', type: 'button', 'aria-label': 'Design your door', title: 'Design your door' },
    h('span', { class: 'fab-door', 'aria-hidden': 'true' }, h('span', { class: 'fab-frame' }), h('span', { class: 'fab-light' }), h('span', { class: 'fab-leaf' }, h('i', {}))),
    h('span', { class: 'fab-label' }, 'Design your door'));
  b.addEventListener('click', () => {
    if (b.classList.contains('opening')) return;
    b.classList.add('opening');
    doorOpenSound();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { b.classList.remove('opening'); setUi({ view: 'designer' }); window.scrollTo(0, 0); }, reduce ? 0 : 650);
  });
  return b;
}

function shell(): HTMLElement {
  const current = VIEWS.find((v) => v.key === ui.view) ?? VIEWS[0];
  let main: HTMLElement;
  try { main = current.render(); } catch (e) {
    console.error(e);
    main = h('div', { class: 'view' }, h('div', { class: 'alert err' }, `This view failed to render: ${(e as Error).message}`));
  }
  return h('div', { class: 'app' },
    header(current.key),
    h('nav', { class: 'topnav', 'aria-label': 'Main' }, VIEWS.filter((v) => v.menu === 'main').map((v) =>
      h('a', { href: `#/${v.key}`, class: v.key === current.key ? 'on' : '', 'aria-current': v.key === current.key ? 'page' : undefined }, icon(v.icon), h('span', {}, v.label)))),
    h('main', { id: 'main' },
      isDemo() ? h('div', { class: 'demo-bar' }, h('b', {}, 'Demo. '), 'Sample projects: try anything, nothing is saved. ',
        demoOnly() ? null : h('a', { href: location.pathname }, 'Open my own workspace')) : null,
      main,
      h('footer', { class: 'foot' }, h('span', {}, `© ${BRAND} · ${TAGLINE}`), h('span', {}, CREDIT))),
    current.key === 'designer' ? null : doorFab(),
  );
}

let lastView = '';
function render() {
  const root = document.getElementById('root')!;
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id;
  const sel = active instanceof HTMLInputElement && ['text', 'search', 'number'].includes(active.type) ? [active.selectionStart, active.selectionEnd] : null;
  const mainEl = document.getElementById('main');
  const scroll = lastView === ui.view && mainEl ? mainEl.scrollTop : 0;
  const editorScroll = document.querySelector('.editor-form')?.scrollTop ?? 0;
  root.replaceChildren(shell());
  document.title = `${BRAND} - ${VIEWS.find((v) => v.key === ui.view)?.label ?? TAGLINE}`;
  const m = document.getElementById('main');
  if (m) m.scrollTop = scroll;
  const ef = document.querySelector('.editor-form');
  if (ef && lastView === ui.view) ef.scrollTop = editorScroll;
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange && el.type !== 'number') try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not selectable */ } }
  }
  lastView = ui.view;
}

function route() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (VIEWS.some((v) => v.key === key) && key !== ui.view) setUi({ view: key });
  else if (!key) history.replaceState(null, '', `#/${ui.view}`);
}

load();
if (!VIEWS.some((v) => v.key === ui.view)) ui.view = 'dashboard';
subscribe(() => {
  if (location.hash !== `#/${ui.view}`) history.pushState(null, '', `#/${ui.view}`);
  render();
});
window.addEventListener('hashchange', route);
route();
render();
