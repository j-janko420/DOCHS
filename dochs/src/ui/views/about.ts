import { SCHOOL_CSV } from '../../core/samples.js';
import { download, h, toast } from '../dom.js';
import { isDemo, setUi } from '../state.js';

export const VERSION = '2.0.0-beta';
export const REPO = 'https://github.com/j-janko420/DOCHS';

// Guided test script for people trying the demo. Results stay in this browser
// until the tester copies, downloads or files them.

interface Scenario { id: string; title: string; steps: string[]; expect: string; view?: string }

export const SCENARIOS: Scenario[] = [
  { id: 'dash', title: 'Dashboard and floor status', view: 'dashboard', steps: ['Choose "Sample Hospitality Level (anonymised)" in the Project selector.', 'Read the Floor-wise status table.'], expect: 'Level 31 shows 2 door records, Level 32 shows 10. Clicking a floor opens its schedule.' },
  { id: 'filter', title: 'Floor and category filter', view: 'schedule', steps: ['Open Schedules.', 'Set Floor = Level 32, then click the "Fire-rated" category chip.'], expect: 'Exactly 3 doors: L32-201, L32-301, L32-303. Clear filters brings back all 12.' },
  { id: 'edit', title: 'Edit a door and see the checks', view: 'doors', steps: ['Open Door register and select L32-102.', 'Change "Leaf 1 width" by +20 mm and press Tab.'], expect: 'A warning W-DIM-10 "Leaf width does not fit frame" appears with its calculation; the sheet preview redraws; Change history records the edit.' },
  { id: 'design', title: 'Design your door', steps: ['Click "+ Design your door".', 'Enter S.O. 1000 x 2200, wall 150; choose "Fire-rated timber door", FR 60 min, a vision panel and "Fire door with closer".', 'Enter a door mark and click "Add door to project".'], expect: 'Leaves 914 x 2149 mm, live drawing and 3D model update while you click; the new door opens in the register with 0 errors.' },
  { id: 'cad', title: '2D drawing and DXF', view: 'drawings', steps: ['Open 2D CAD studio and pick any door.', 'Zoom and pan the sheet; click "Export DXF".', 'If you have AutoCAD, BricsCAD or LibreCAD, open the file.'], expect: 'A dimensioned sheet (elevations, plan, head/jamb/threshold sections, title block). The DXF opens in CAD with layers and dimensions in millimetres.' },
  { id: '3d', title: '3D model', view: 'drawings', steps: ['In 2D CAD studio click the "3D model" tab.', 'Drag to rotate, move the Open slider, tick Exploded.'], expect: 'The door opens on its hinges (or slides / pivots), both faces can be viewed, the exploded view separates frame and leaf.' },
  { id: 'import', title: 'Import a schedule', view: 'import', steps: ['Use the Office or Hospitality sample. Open Import schedule and click "Download sample CSV".', 'Choose that file, check the column matching and preview.', 'Click Import.'], expect: '8 data rows: 7 doors imported, 1 TOTAL row skipped with its reason; sizes in feet-inches converted to mm; "Reconciled" is shown.' },
  { id: 'export', title: 'Schedules and issue package', view: 'schedule', steps: ['Open Schedules and click "Excel (.xlsx)".', 'Click "Issue package (.zip)".'], expect: 'The Excel file has 6 sheets. The zip has the schedule, CSVs, one DXF per door, a set DXF, a manifest and a backup.' },
  { id: 'library', title: 'Door library, hardware and materials', view: 'reference', steps: ['Open Door library and browse Door types and Hardware types.', 'Open Hardware > Takeoff and Materials > Material schedule.'], expect: 'Each hardware type states what it does; takeoff shows quantities with their calculation; materials show submittal status.' },
  { id: 'mobile', title: 'Phone or tablet', steps: ['Open the demo link on a phone.', 'Navigate a few screens.'], expect: 'Everything is readable and usable without sideways scrolling.' },
];

type Result = { status: '' | 'pass' | 'fail' | 'issue'; note: string };
const KEY = 'dochs.feedback';

function load(): { tester: string; results: Record<string, Result>; general: string } {
  try { return { tester: '', results: {}, general: '', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { tester: '', results: {}, general: '' }; }
}
function save(v: ReturnType<typeof load>) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* not available */ } }

export function feedbackReport(fb: ReturnType<typeof load>): string {
  const label = { '': 'not tested', pass: 'PASS', fail: 'FAIL', issue: 'WORKS WITH ISSUES' };
  const done = SCENARIOS.filter((s) => fb.results[s.id]?.status);
  return [
    `DORSCH ${VERSION} - test report`,
    `Tester: ${fb.tester || '-'}`,
    `Date: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `Browser: ${typeof navigator === 'undefined' ? '-' : navigator.userAgent}`,
    `Tested: ${done.length} of ${SCENARIOS.length}; pass ${done.filter((s) => fb.results[s.id].status === 'pass').length}, issues ${done.filter((s) => fb.results[s.id].status === 'issue').length}, fail ${done.filter((s) => fb.results[s.id].status === 'fail').length}`,
    '',
    ...SCENARIOS.map((s, i) => `${i + 1}. ${s.title}: ${label[fb.results[s.id]?.status ?? '']}${fb.results[s.id]?.note ? `\n   Note: ${fb.results[s.id].note}` : ''}`),
    '',
    `General feedback: ${fb.general || '-'}`,
  ].join('\n');
}

export function aboutView(): HTMLElement {
  const fb = load();
  const set = (patch: Partial<typeof fb>) => { save({ ...fb, ...patch }); };
  const setResult = (id: string, patch: Partial<Result>) => { const base: Result = fb.results[id] ?? { status: '', note: '' };
    const r: Result = { ...base, ...patch }; set({ results: { ...fb.results, [id]: r } }); setUi({}); };
  const report = () => feedbackReport(load());
  const done = SCENARIOS.filter((s) => fb.results[s.id]?.status).length;
  return h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'About and test guide'), h('p', { class: 'muted' }, `DORSCH - Door Schedule Solutions ${VERSION}. Designed by i3 Design.`)),
      isDemo() ? null : h('a', { class: 'btn', href: '?demo' }, 'Open the demo')),
    h('div', { class: 'cols' },
      h('section', { class: 'card' }, h('h3', {}, 'What DORSCH does'),
        h('p', {}, 'One door register drives floor-wise and category-wise door schedules, hardware and material schedules, QA checks, dimensioned 2D CAD sheets (editable DXF), a 3D model and issue packages. Doors can be entered, imported from a spreadsheet or designed from a structural opening.'),
        h('h4', {}, 'In this demo version'),
        h('ul', { class: 'plain small' },
          ['Door register, floors, buildings, categories', 'QA engine: errors block DXF issue; nothing is guessed', 'Door, quantity, hardware and material schedules (Excel / CSV)', '2D CAD sheets and DXF (R12, mm), set DXF and issue package', '3D model with opening and exploded view', 'Design your door: from structural opening and clicked options', 'Door library: types, materials, finishes, hardware and functions', 'Import of xlsx / csv schedules with a reconciling report', 'Optional AI server for column matching'].map((x) => h('li', {}, '- ' + x)))),
      h('section', { class: 'card' }, h('h3', {}, 'Before using results'),
        h('ul', { class: 'plain small' },
          h('li', {}, '- Sample projects and library items are illustrative, not manufacturer data.'),
          h('li', {}, '- Frame sections and designer values are starting assumptions: verify against the approved manufacturer system.'),
          h('li', {}, '- Fire, acoustic, access-control and egress compliance is not assessed by DORSCH.'),
          h('li', {}, '- DWG output and PDF / image drawing extraction are not included yet.'),
          h('li', {}, '- Projects are stored in this browser only: export a JSON backup to keep or share work.'),
          h('li', {}, '- Demo mode saves nothing.')),
        h('p', { class: 'small' }, 'Source and issues: ', h('a', { href: REPO, target: '_blank', rel: 'noopener' }, REPO)))),
    h('section', { class: 'card', id: 'tests' }, h('h3', {}, `Guided test (${done} of ${SCENARIOS.length} done)`),
      h('p', { class: 'muted small' }, 'Work through the scenarios in the demo, mark each result and add notes. Your notes stay in this browser until you copy, download or send the report.'),
      h('label', { class: 'fld' }, h('span', {}, 'Your name / company (optional)'), h('input', { id: 'fb-tester', type: 'text', value: fb.tester, onchange: (e: Event) => set({ tester: (e.target as HTMLInputElement).value.trim() }) })),
      h('ol', { class: 'scenarios' }, SCENARIOS.map((s) => {
        const r = fb.results[s.id] ?? { status: '', note: '' };
        return h('li', { class: `scenario st-${r.status || 'none'}` },
          h('div', { class: 'row gap' }, h('b', { class: 'grow' }, s.title), s.view ? h('button', { class: 'btn sm', onclick: () => setUi({ view: s.view! }) }, 'Go there') : null),
          h('ul', { class: 'plain small' }, s.steps.map((x) => h('li', {}, '- ' + x))),
          h('p', { class: 'small' }, h('b', {}, 'Expected: '), s.expect),
          h('div', { class: 'row gap' },
            (['pass', 'issue', 'fail'] as const).map((st) => h('button', { class: `chip ${r.status === st ? 'on' : ''}`, 'aria-pressed': r.status === st ? 'true' : 'false', onclick: () => setResult(s.id, { status: r.status === st ? '' : st }) }, st === 'pass' ? 'Pass' : st === 'issue' ? 'Works, with issues' : 'Fail')),
            h('input', { id: `fb-note-${s.id}`, type: 'text', class: 'grow', placeholder: 'Note (what happened, browser, file used...)', value: r.note, onchange: (e: Event) => setResult(s.id, { note: (e.target as HTMLInputElement).value.trim() }) })));
      })),
      h('label', { class: 'fld' }, h('span', {}, 'General feedback and missing features'), h('textarea', { id: 'fb-general', rows: 3, onchange: (e: Event) => set({ general: (e.target as HTMLTextAreaElement).value.trim() }) }, fb.general)),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: async () => { try { await navigator.clipboard.writeText(report()); toast('Test report copied', 'ok'); } catch { download('dochs-test-report.txt', report(), 'text/plain'); toast('Copy not allowed here: report downloaded instead', 'info'); } } }, 'Copy report'),
        h('button', { class: 'btn', onclick: () => download(`dochs-test-report-${new Date().toISOString().slice(0, 10)}.txt`, report(), 'text/plain') }, 'Download report'),
        h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: `${REPO}/issues/new?title=${encodeURIComponent(`Test report ${VERSION}${fb.tester ? ' - ' + fb.tester : ''}`)}&body=${encodeURIComponent(report().slice(0, 6000))}` }, 'Send as GitHub issue'),
        confirmClear())));
}

function confirmClear(): HTMLElement {
  let armed = false;
  const b = h('button', { class: 'btn ghost', onclick: () => {
    if (!armed) { armed = true; b.textContent = 'Click again to clear'; setTimeout(() => { armed = false; b.textContent = 'Clear my results'; }, 4000); return; }
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setUi({});
  } }, 'Clear my results');
  return b;
}

export function downloadSampleCsv() {
  download('dochs-sample-schedule.csv', SCHOOL_CSV + '\n', 'text/csv');
}

// First visit in demo mode: a short welcome with where to start.
export function welcome(): HTMLElement | null {
  if (!isDemo()) return null;
  try { if (sessionStorage.getItem('dochs.welcomed')) return null; } catch { return null; }
  const close = () => { try { sessionStorage.setItem('dochs.welcomed', '1'); } catch { /* ignore */ } el.remove(); };
  const el = h('div', { class: 'dz-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wl-title' },
    h('div', { class: 'welcome' },
      h('h2', { id: 'wl-title' }, 'Welcome to the DORSCH demo'),
      h('p', {}, 'Door Schedule Solutions turns a door register into floor-wise schedules, editable 2D CAD drawings (DXF), a 3D model and issue packages.'),
      h('p', { class: 'muted small' }, 'Three sample projects are loaded. Try anything: nothing is saved and your own projects are not touched.'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: () => { close(); setUi({ view: 'about' }); } }, 'Start the guided test'),
        h('button', { class: 'btn', onclick: close }, 'Explore on my own')),
      h('p', { class: 'muted small' }, `Version ${VERSION} - Designed by i3 Design`)));
  return el;
}
