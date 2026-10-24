import type { TitleBlock } from '../../core/types.js';
import {
  buildProject, crossCheck, docFromText, extractInfo, findHardware, findLayouts, findSchedule, kindOf, readDoc, scheduleMarks,
  type Finding, type InfoKey, type IntakeDoc, type Role, type SetFound,
} from '../../core/intake.js';
import { TARGETS } from '../../core/importer.js';
import { sampleIntakeFiles } from '../../core/intake-samples.js';
import { h, toast } from '../dom.js';
import { addProject, setUi } from '../state.js';
import { aiServer, extractText } from '../ai.js';
import { readTitleBlock } from '../titleblock-ui.js';

// New project: the three fundamental inputs (door layouts, master schedule,
// hardware sets) in any common format, read in the browser, cross-checked,
// reviewed, then turned into a project. Everything stays editable afterwards.

interface FileState { id: number; name: string; role: Role; bytes: Uint8Array; doc: IntakeDoc | null; busy: boolean }

let files: FileState[] = [];
let tb: TitleBlock | undefined;
let tbBusy = false;
let seq = 0;
const info: Record<InfoKey, string> = { name: '', number: '', client: '', consultant: '', location: '', date: '', revision: '' };
const edited = new Set<InfoKey>();
let openSet = '';

const ROLES: { role: Role; title: string; sub: string; hint: string; accept: string; icon: string }[] = [
  { role: 'layout', title: 'Door layouts', sub: 'Floor-wise plans or one complete plan', hint: 'PDF, DXF, DWG, image', accept: '.pdf,.dxf,.dwg,.png,.jpg,.jpeg,.webp,.tif,.tiff', icon: 'M3 3h18v18H3zM3 9h8M11 3v10M15 13h6M15 13v8' },
  { role: 'schedule', title: 'Master door schedule', sub: 'All doors, or one schedule per floor', hint: 'Excel, CSV, PDF, Word, text, image', accept: '.xlsx,.xlsm,.csv,.pdf,.docx,.txt,.tsv,.png,.jpg,.jpeg', icon: 'M3 5h18M3 10h18M3 15h18M3 20h18M9 5v15' },
  { role: 'hardware', title: 'Hardware / ironmongery sets', sub: 'Set headings with item lines, or a set table', hint: 'PDF, Excel, Word, text, image', accept: '.pdf,.xlsx,.xlsm,.csv,.docx,.txt,.png,.jpg,.jpeg', icon: 'M14 7a4 4 0 1 0-4 4l-6 6 3 3 6-6a4 4 0 0 0 1-7z' },
];

const LABELS: [InfoKey, string][] = [['name', 'Project name'], ['number', 'Project no.'], ['client', 'Client'], ['consultant', 'Consultant / architect'], ['location', 'Location'], ['date', 'Date'], ['revision', 'Revision']];

const svg = (d: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};

function analysis() {
  const docs = files.filter((f) => f.doc).map((f) => f.doc!);
  const extracted = extractInfo(docs);
  for (const [k] of LABELS) if (!edited.has(k)) info[k] = extracted[k]?.value ?? '';
  const sched = findSchedule(docs);
  const sm = sched ? scheduleMarks(sched) : null;
  const layouts = findLayouts(docs, sm?.marks ?? []);
  const hardware = findHardware(docs);
  const findings = crossCheck({ docs, schedule: sm, layouts, hardware, info: { ...extracted, ...(info.name ? { name: { value: info.name, source: '' } } : {}) } });
  return { docs, extracted, sched, sm, layouts, hardware, findings };
}

async function addFiles(role: Role, list: FileList | File[] | { name: string; bytes: Uint8Array }[]) {
  const items: { name: string; bytes: Uint8Array }[] = await Promise.all([...list].map(async (f: File | { name: string; bytes: Uint8Array }) => (f instanceof File ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : f)));
  for (const it of items) {
    const st: FileState = { id: ++seq, name: it.name, role, bytes: it.bytes, doc: null, busy: true };
    files.push(st);
    setUi({});
    st.doc = await readDoc(it.name, it.bytes, role);
    st.busy = false;
    setUi({});
  }
}

async function readWithAi(f: FileState) {
  const s = aiServer();
  if (!s) return;
  const kind = kindOf(f.name);
  const mt = kind === 'pdf' ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : /\.webp$/i.test(f.name) ? 'image/webp' : /\.gif$/i.test(f.name) ? 'image/gif' : 'image/jpeg';
  if (f.bytes.length > 15_000_000) { toast('File too large for AI reading (15 MB max)', 'err'); return; }
  f.busy = true;
  setUi({});
  try {
    const r = await extractText(s, f.name, mt, f.bytes, f.role);
    f.doc = docFromText(f.name, f.role, kind, r.text, `Transcribed by AI (${s.provider}). Check the values: AI reading can misread.`);
    f.doc.notes.push(...r.notes);
  } catch (e) { toast(`AI reading failed: ${(e as Error).message}`, 'err'); }
  f.busy = false;
  setUi({});
}

function drop(role: Role, accept: string, multiple = true): HTMLElement {
  const input = h('input', { type: 'file', accept, multiple, class: 'hidden', id: `in-${role}`, onchange: (e: Event) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) void addFiles(role, fl); (e.target as HTMLInputElement).value = ''; } });
  const zone = h('button', { type: 'button', class: 'in-drop', onclick: () => input.click() }, h('b', {}, 'Drop files here or click to upload'));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const fl = e.dataTransfer?.files; if (fl?.length) void addFiles(role, fl); });
  return h('div', {}, input, zone);
}

function fileRow(f: FileState): HTMLElement {
  const d = f.doc;
  const state = f.busy ? ['busy', 'Reading…'] : !d ? ['err', 'Error'] : d.textFound ? ['ok', 'Read'] : d.needsAi ? ['warn', 'Needs AI reading'] : ['err', 'Not readable'];
  return h('li', { class: 'in-file' },
    h('div', { class: 'row gap' },
      h('span', { class: `in-state ${state[0]}` }, state[1]),
      h('b', { class: 'in-name', title: f.name }, f.name),
      h('span', { class: 'grow' }),
      d?.needsAi && !f.busy ? (aiServer() ? h('button', { class: 'btn sm', onclick: () => void readWithAi(f) }, 'Read with AI') : null) : null,
      h('button', { class: 'btn ghost sm', 'aria-label': `Remove ${f.name}`, onclick: () => { files = files.filter((x) => x !== f); setUi({}); } }, '✕')),
    d ? h('p', { class: 'muted small' }, d.notes.join(' ')) : null,
    d?.needsAi && !aiServer() ? h('p', { class: 'small warn-text' }, 'To read images and scans, connect the DORSCH server (Settings > Data, backup & server), or upload the native PDF / Excel.') : null);
}

const sevOrder: Record<Finding['sev'], number> = { error: 0, warning: 1, info: 2, ok: 3 };

function setTable(s: SetFound): HTMLElement {
  return h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
    h('thead', {}, h('tr', {}, ['Qty', 'Item', 'Model / ref', 'Finish', 'Make'].map((x) => h('th', {}, x)))),
    h('tbody', {}, s.items.map((i) => h('tr', {}, h('td', { class: 'num' }, `${i.qty}${i.basis === 'per-leaf' ? '/leaf' : ''}`), h('td', {}, i.item), h('td', { class: 'small' }, i.model), h('td', {}, i.finish), h('td', {}, i.manufacturer))))));
}

function create(a: ReturnType<typeof analysis>) {
  if (!info.name.trim()) { toast('Enter the project name first', 'err'); document.getElementById('in-name')?.focus(); return; }
  if (files.some((f) => f.busy)) { toast('Wait until all files are read', 'info'); return; }
  try {
    const r = buildProject(info, a.sched, a.hardware, a.layouts);
    const p = { ...r.project, titleBlock: tb, intake: { at: new Date().toISOString(), files: files.map((f) => ({ name: f.name, role: f.role, notes: f.doc?.notes ?? [] })), findings: a.findings } };
    addProject(p);
    toast(`Project created: ${p.doors.length} doors, ${p.hardwareSets.length} hardware sets${r.report?.skipped.length ? `, ${r.report.skipped.length} rows skipped (see Checks)` : ''}`, 'ok');
    files = []; tb = undefined; edited.clear();
    for (const [k] of LABELS) info[k] = '';
    setUi({ view: 'dashboard' });
  } catch (e) { toast((e as Error).message, 'err'); }
}

export function intakeView(): HTMLElement {
  const a = analysis();
  const any = files.length > 0;
  const head = h('div', { class: 'view-head' },
    h('div', {}, h('h1', {}, 'New project'), h('p', { class: 'muted' }, 'Upload the three inputs. DORSCH reads them in your browser, takes the project details, cross-checks layouts, schedule and hardware, and builds the project. Everything can be edited afterwards.')),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn', onclick: () => { for (const s of sampleIntakeFiles()) void addFiles(s.role, [{ name: s.name, bytes: s.bytes }]); } }, 'Try with sample files'),
      any ? h('button', { class: 'btn ghost', onclick: () => { files = []; tb = undefined; edited.clear(); setUi({}); } }, 'Clear all') : null));
  const cards = h('div', { class: 'in-grid' }, ROLES.map((r, i) => {
    const mine = files.filter((f) => f.role === r.role);
    return h('section', { class: `card in-card ${mine.some((f) => f.doc?.textFound) ? 'done' : ''}` },
      h('div', { class: 'in-head' }, h('span', { class: 'in-num' }, String(i + 1)), h('span', { class: 'in-ico' }, svg(r.icon)),
        h('div', {}, h('h2', {}, r.title), h('p', { class: 'muted small' }, r.sub))),
      drop(r.role, r.accept),
      h('p', { class: 'muted small' }, r.hint),
      mine.length ? h('ul', { class: 'in-files' }, mine.map(fileRow)) : null);
  }));
  const tbCard = h('section', { class: 'card in-tb' },
    h('div', { class: 'row gap' },
      h('div', { class: 'grow' }, h('h3', {}, 'Company title block (optional)'), h('p', { class: 'muted small' }, tb ? `${tb.name}: ${tb.width} x ${tb.height} mm, ${tb.placement === 'full' ? 'full sheet frame' : `${tb.placement} strip`} on A3. Placement can be changed under 2D Drawings.` : 'PDF, DXF or image. Placed on every A3 drawing sheet; DWG: save as DXF or PDF first.')),
      h('input', { type: 'file', class: 'hidden', id: 'in-tb', accept: '.pdf,.dxf,.dwg,.png,.jpg,.jpeg', onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if (!f) return;
        tbBusy = true; setUi({});
        try { tb = await readTitleBlock(f); } catch (err) { toast((err as Error).message, 'err'); }
        tbBusy = false; setUi({});
      } }),
      h('button', { class: 'btn', disabled: tbBusy, onclick: () => document.getElementById('in-tb')?.click() }, tbBusy ? 'Reading…' : tb ? 'Replace' : 'Upload title block'),
      tb ? h('button', { class: 'btn ghost', onclick: () => { tb = undefined; setUi({}); } }, 'Remove') : null));
  if (!any) return h('div', { class: 'view' }, head, cards, tbCard);

  // ---------- review ----------
  const counts = { error: 0, warning: 0, info: 0, ok: 0 };
  for (const f of a.findings) counts[f.sev]++;
  const mapped = a.sched ? a.sched.mapping.map((m, i) => (m ? `${a.sched!.rows[a.sched!.headerRow][i]} → ${TARGETS.find((t) => t.key === m)?.label}` : '')).filter(Boolean) : [];
  const review = h('section', { class: 'card in-review' },
    h('h2', {}, 'Review and create'),
    h('div', { class: 'in-kpis' },
      h('div', { class: 'kpi' }, h('b', {}, String(a.sm?.marks.length ?? 0)), h('span', {}, 'Doors in schedule')),
      h('div', { class: 'kpi' }, h('b', {}, String(a.layouts.reduce((n, l) => n + l.marks.length, 0))), h('span', {}, 'Door marks on layouts')),
      h('div', { class: 'kpi' }, h('b', {}, String(a.hardware.length)), h('span', {}, 'Hardware sets')),
      h('div', { class: 'kpi' }, h('b', {}, String(a.hardware.reduce((n, s) => n + s.items.length, 0))), h('span', {}, 'Hardware item lines')),
      h('div', { class: `kpi ${counts.warning + counts.error ? 'sev-warning' : ''}` }, h('b', {}, String(counts.warning + counts.error)), h('span', {}, 'Points to check'))),
    h('div', { class: 'in-cols' },
      h('div', {},
        h('h3', {}, 'Project details'),
        h('div', { class: 'in-form' }, LABELS.map(([k, label]) => {
          const src = a.extracted[k]?.source;
          return h('label', { class: `fld ${!info[k] && k === 'name' ? 'flag' : !info[k] ? 'blank' : ''}` },
            h('span', {}, label, k === 'name' ? ' *' : '', h('em', {}, edited.has(k) ? '  (edited)' : src ? `  from ${src}` : '  not found')),
            h('input', { id: `in-${k}`, type: 'text', value: info[k], oninput: (e: Event) => { info[k] = (e.target as HTMLInputElement).value; edited.add(k); }, onchange: () => setUi({}) }));
        }))),
      h('div', {},
        h('h3', {}, 'Cross-check'),
        h('ul', { class: 'in-findings' }, a.findings.slice().sort((x, y) => sevOrder[x.sev] - sevOrder[y.sev]).map((f) =>
          h('li', { class: `sev-${f.sev}` }, h('span', { class: `badge sev-${f.sev === 'ok' ? 'info' : f.sev}` }, f.sev === 'ok' ? 'OK' : f.sev), h('span', { class: 'muted small' }, ` ${f.area}: `), f.text))))),
    a.sched ? h('details', { class: 'in-more' }, h('summary', {}, `Schedule: ${a.sched.source}, ${a.sm?.rows ?? 0} rows, ${mapped.length} columns matched`),
      h('p', { class: 'small muted' }, mapped.join(' · ')),
      h('div', { class: 'table-wrap flat' }, h('table', { class: 'grid dense' },
        h('thead', {}, h('tr', {}, a.sched.rows[a.sched.headerRow].map((c, i) => h('th', { class: a.sched!.mapping[i] ? '' : 'muted' }, c)))),
        h('tbody', {}, a.sched.rows.slice(a.sched.headerRow + 1, a.sched.headerRow + 9).map((r) => h('tr', {}, r.map((c, i) => h('td', { class: a.sched!.mapping[i] ? '' : 'muted' }, c))))))),
      h('p', { class: 'small muted' }, 'Columns can be re-matched after creating the project: Settings > Import schedule.')) : null,
    a.hardware.length ? h('details', { class: 'in-more' }, h('summary', {}, `Hardware sets (${a.hardware.length})`),
      h('ul', { class: 'in-sets' }, a.hardware.map((s) => h('li', {},
        h('button', { class: `in-set ${openSet === s.code ? 'on' : ''}`, onclick: () => { openSet = openSet === s.code ? '' : s.code; setUi({}); } },
          h('b', { class: 'mono' }, s.code), h('span', {}, ` ${s.description || ''}`), h('span', { class: 'muted small' }, ` · ${s.items.length} items${s.doors.length ? ` · ${s.doors.length} doors listed` : ''}`)),
        openSet === s.code ? setTable(s) : null)))) : null,
    h('div', { class: 'row gap in-actions' },
      h('span', { class: 'muted small grow' }, 'Nothing is invented: values not found stay blank and are flagged in Checks. Extracted products are marked unverified until checked.'),
      h('button', { class: 'btn primary lg', disabled: files.some((f) => f.busy), onclick: () => create(a) }, `Create project${a.sm ? ` with ${a.sm.marks.length} doors` : ''}`)));
  return h('div', { class: 'view' }, head, cards, tbCard, review);
}
