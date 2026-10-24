import { floorName } from '../../core/classify.js';
import { toPdf } from '../../cad/pdf.js';
import { h, download, safeName, toast } from '../dom.js';
import { filterBar, filteredDoors } from '../filters.js';
import { project, setUi, ui } from '../state.js';
import { viewer3d } from '../viewer3d.js';
import { renderSheet, renderView as drawView, type ViewKind } from '../render.js';

// 3D & Render: the interactive model, realistic face / side / top renders, and
// an A3 render sheet with project, door and hardware-set details.

let tab: '3d' | 'render' | 'sheet' = 'render';

async function canvasBytes(c: HTMLCanvasElement, type: string, q?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));
  return new Uint8Array(await (blob ?? new Blob()).arrayBuffer());
}

function viewCard(kind: ViewKind, title: string, w: number, hgt: number, cls: string): HTMLElement {
  const p = project();
  const d = p.doors.find((x) => x.id === ui.selectedDoorId) ?? filteredDoors()[0];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'rn-canvas', width: Math.round(w * dpr), height: Math.round(hgt * dpr), role: 'img', 'aria-label': `${title} render of door ${d.mark}` }) as HTMLCanvasElement;
  drawView(p, d, kind, c);
  return h('figure', { class: `card rn-card ${cls}` }, c,
    h('figcaption', { class: 'row gap' }, h('b', {}, title), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: async () => {
        const big = document.createElement('canvas');
        big.width = Math.round(w * 3); big.height = Math.round(hgt * 3);
        drawView(p, d, kind, big);
        download(`${safeName(d.mark)}_${kind}.png`, await canvasBytes(big, 'image/png'), 'image/png');
      } }, 'PNG')));
}

export function renderView(): HTMLElement {
  const p = project();
  const doors = filteredDoors();
  const d = doors.find((x) => x.id === ui.selectedDoorId) ?? doors[0];
  const head = h('div', { class: 'view-head' },
    h('div', {}, h('h1', {}, '3D & Render'), h('p', { class: 'muted' }, 'Interactive 3D model, realistic renders of each face with the hardware set in its finishes, and an A3 render sheet for presentation.')));
  if (!d) return h('div', { class: 'view' }, head, filterBar({ status: true }), h('div', { class: 'card empty' }, 'No doors match the filters.'));
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    ([['render', 'Render'], ['sheet', 'A3 render sheet'], ['3d', '3D interactive']] as const).map(([k, l]) => h('button', { role: 'tab', class: `tab ${tab === k ? 'on' : ''}`, 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; setUi({}); } }, l)));
  let body: HTMLElement;
  if (tab === '3d') body = viewer3d(d, 'render', 560);
  else if (tab === 'render') {
    body = h('div', { class: 'rn-grid' },
      viewCard('front', 'Front - outside face', 420, 560, 'rn-front'),
      viewCard('back', 'Back - inside face', 420, 560, 'rn-back'),
      viewCard('side', 'Side - section', 260, 560, 'rn-side'),
      viewCard('top', 'Top - plan at handle height', 860, 300, 'rn-top'));
  } else {
    const c = h('canvas', { class: 'rn-sheet', role: 'img', 'aria-label': `A3 render sheet for door ${d.mark}` }) as HTMLCanvasElement;
    const status = h('p', { class: 'muted small' }, 'Rendering the A3 sheet…');
    void renderSheet(p, d, c, 5).then((s) => { status.textContent = s.assumptions.length ? `Assumed where the record is blank: ${s.assumptions.join('; ')}.` : 'Rendered from the door record and its hardware set.'; });
    body = h('div', { class: 'stack' },
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: async () => {
          const big = document.createElement('canvas');
          toast('Rendering A3 at 300 dpi…', 'info');
          await renderSheet(p, d, big, 11.8);
          download(`${safeName(d.mark)}_render_A3.png`, await canvasBytes(big, 'image/png'), 'image/png');
        } }, 'Download PNG (A3, 300 dpi)'),
        h('button', { class: 'btn', onclick: async () => {
          const big = document.createElement('canvas');
          await renderSheet(p, d, big, 8);
          const pdf = toPdf([{ entities: [{ t: 'image', layer: 'A-TITLE', p: [0, 0], w: 420, h: 297, src: big.toDataURL('image/jpeg', 0.9) }], paper: [420, 297], S: 1 }], { title: `${d.mark} render`, author: p.preparedBy });
          download(`${safeName(d.mark)}_render_A3.pdf`, pdf, 'application/pdf');
        } }, 'Download PDF (A3)')),
      status,
      h('div', { class: 'rn-sheet-wrap' }, c));
  }
  return h('div', { class: 'view' }, head, filterBar({ status: true }),
    h('div', { class: 'studio' },
      h('aside', { class: 'card studio-list' },
        h('h3', {}, 'Doors in scope'),
        h('ul', { class: 'pick' }, doors.map((x) => h('li', {}, h('button', { class: x.id === d.id ? 'on' : '', onclick: () => setUi({ selectedDoorId: x.id }) },
          h('span', { class: 'mono' }, x.mark || '(no mark)'), h('span', { class: 'muted small' }, floorName(p, x.floorId)), h('span', { class: 'small' }, x.hardwareSet || '')))))),
      h('div', { class: 'studio-main' }, tabs, body)));
}
