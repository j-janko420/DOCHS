import { h } from './ui/dom.js';
import { allProjects, demoOnly, isDemo, load, project, setUi, subscribe, switchProject, ui } from './ui/state.js';
import { importView } from './ui/views/import.js';
import { VERSION, aboutView, welcome } from './ui/views/about.js';
import { doorsView } from './ui/views/doors.js';
import { drawingsView, qaView, scheduleView } from './ui/views/outputs.js';
import { dashboardView, dataView, projectView } from './ui/views/setup.js';
import { hardwareView } from './ui/views/hardware.js';
import { materialsView } from './ui/views/materials.js';
import { referenceView } from './ui/views/reference.js';
import { designerView, openDesigner } from './ui/designer.js';

const VIEWS: { key: string; label: string; icon: string; render: () => HTMLElement }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', render: dashboardView },
  { key: 'designer', label: 'Design your door', icon: 'M5 21V4h11v17M16 4l3 2v13l-3 2M12 12h1', render: designerView },
  { key: 'reference', label: 'Door library', icon: 'M4 5h6v15H4zM10 5h4v15h-4zM15 6l4 1-3 13-4-1z', render: referenceView },
  { key: 'project', label: 'Project setup', icon: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6', render: projectView },
  { key: 'import', label: 'Import schedule', icon: 'M12 3v12M7 10l5 5 5-5M4 19h16', render: importView },
  { key: 'doors', label: 'Door register', icon: 'M6 21V3h12v18M14 12h1M3 21h18', render: doorsView },
  { key: 'schedule', label: 'Schedules', icon: 'M3 5h18M3 10h18M3 15h18M3 20h18M9 5v15', render: scheduleView },
  { key: 'drawings', label: '2D CAD studio', icon: 'M4 20h16M4 20V4m0 16L20 4M8 8h3M8 12h6', render: drawingsView },
  { key: 'hardware', label: 'Hardware', icon: 'M14 7a4 4 0 1 0-4 4l-6 6 3 3 6-6a4 4 0 0 0 1-7z', render: hardwareView },
  { key: 'materials', label: 'Materials', icon: 'M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4', render: materialsView },
  { key: 'qa', label: 'QA checks', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4', render: qaView },
  { key: 'about', label: 'About & test guide', icon: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', render: aboutView },
  { key: 'data', label: 'Project data', icon: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0', render: dataView },
];

const icon = (d: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};

function logo() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 40 40');
  s.setAttribute('class', 'logo-mark');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c3ee"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>' +
    '<path d="M8 4h24v32H8z" fill="none" stroke="url(#lg)" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M12 8l14 4v24l-14-3z" fill="#0f2a5c" stroke="#22c3ee" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="22.5" cy="22" r="1.4" fill="#e6f6ff"/>';
  return s;
}

function shell(): HTMLElement {
  const p = project();
  const current = VIEWS.find((v) => v.key === ui.view) ?? VIEWS[0];
  let main: HTMLElement;
  try { main = current.render(); } catch (e) {
    console.error(e);
    main = h('div', { class: 'view' }, h('div', { class: 'alert err' }, `This view failed to render: ${(e as Error).message}`));
  }
  return h('div', { class: 'app' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, logo(), h('div', {}, h('div', { class: 'brand-name' }, 'DOCHS'), h('div', { class: 'brand-sub' }, 'DoorChisolution'))),
      h('label', { class: 'proj-switch' }, h('span', {}, 'Project'),
        h('select', { id: 'proj-select', onchange: (e: Event) => switchProject((e.target as HTMLSelectElement).value) }, allProjects().map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name)))),
      h('button', { class: 'btn primary design-btn', onclick: () => openDesigner() }, '+ Design your door'),
      h('nav', { 'aria-label': 'Main' }, VIEWS.map((v) => h('a', { href: `#/${v.key}`, class: v.key === current.key ? 'on' : '', 'aria-current': v.key === current.key ? 'page' : undefined }, icon(v.icon), h('span', {}, v.label)))),
      h('div', { class: 'side-foot' }, 'Design - Draw - Detail - Schedule - Deliver', h('br'), h('span', {}, `Version ${VERSION}`), h('br'), h('span', { class: 'credit' }, 'Designed by i3 Design')),
    ),
    h('main', { id: 'main' },
      isDemo() ? h('div', { class: 'demo-bar' }, h('b', {}, 'Demo mode. '), 'Sample projects only: try anything, nothing is saved and your own projects are not touched. ',
        demoOnly() ? null : h('a', { href: location.pathname }, 'Open my own workspace')) : null,
      main),
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
  document.title = `DOCHS - ${VIEWS.find((v) => v.key === ui.view)?.label ?? ''}`;
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
subscribe(() => {
  if (location.hash !== `#/${ui.view}`) history.pushState(null, '', `#/${ui.view}`);
  render();
});
window.addEventListener('hashchange', route);
route();
render();
const w = welcome();
if (w) document.body.append(w);
