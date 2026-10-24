import type { TbPlacement, TitleBlock } from '../core/types.js';
import { readPdfVector } from '../core/pdf-read.js';
import { dwgVersion, readDxf } from '../cad/dxf-read.js';
import { TB_TOKENS, hasTokens, tbFromDxf, tbFromImage, tbFromPdf } from '../cad/titleblock.js';
import { h, toast } from './dom.js';
import { project, setProject } from './state.js';

// Company title block: upload (PDF / DXF / image; DWG explained), placement on
// the sheet, kept with the project.

async function imageToJpeg(file: File, max = 2400): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Could not open the image')); img.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function readTitleBlock(file: File): Promise<TitleBlock> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase() ?? '';
  if (ext === 'pdf') return tbFromPdf(await readPdfVector(bytes, 0), file.name);
  if (ext === 'dxf') return tbFromDxf(readDxf(new TextDecoder().decode(bytes)), file.name);
  if (ext === 'dwg') {
    const v = dwgVersion(bytes);
    throw new Error(`DWG${v ? ` (${v})` : ''} is a closed Autodesk format and cannot be read in the browser. In AutoCAD: SAVEAS > DXF, or plot the title block sheet to PDF, and upload that.`);
  }
  if (/^(png|jpe?g|webp|gif|bmp)$/.test(ext)) { const im = await imageToJpeg(file); return tbFromImage(im.src, im.w, im.h, file.name); }
  throw new Error('Use a PDF, DXF or image (PNG / JPG) title block.');
}

const PLACEMENTS: [TbPlacement | '', string][] = [['', 'DORSCH standard title block'], ['full', 'Client block: full sheet frame'], ['bottom', 'Client block: strip along the bottom'], ['right', 'Client block: strip down the right side']];

export function titleBlockPanel(): HTMLElement {
  const p = project();
  const tb = p.titleBlock;
  const set = (next: TitleBlock | undefined) => setProject({ ...project(), titleBlock: next });
  const input = h('input', { type: 'file', accept: '.pdf,.dxf,.dwg,.png,.jpg,.jpeg,.webp', class: 'hidden', id: 'tb-file', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const next = await readTitleBlock(f);
      const size = JSON.stringify(next).length;
      set(next);
      toast(`Title block loaded: ${next.width} x ${next.height} mm, placed as ${next.placement === 'full' ? 'full sheet frame' : `${next.placement} strip`}`, 'ok');
      if (size > 2_500_000) toast('This title block is very detailed (over 2.5 MB): browser storage may fill up. A simpler PDF / DXF export of the block helps.', 'info');
    } catch (err) { toast((err as Error).message, 'err'); }
  } });
  const num = (label: string, val: number, on: (v: number) => void) => h('label', { class: 'fld inline' }, h('span', {}, label),
    h('input', { type: 'number', min: 0, step: 1, value: String(Math.round(val)), style: { width: '80px' }, onchange: (e: Event) => on(Math.max(0, Number((e.target as HTMLInputElement).value) || 0)) }));
  return h('details', { class: 'card tb-panel', open: !tb ? undefined : true },
    h('summary', {}, h('b', {}, 'Title block'), h('span', { class: 'muted small' }, tb ? `  ${tb.name} (${tb.source.toUpperCase()}, ${tb.placement === 'full' ? 'full frame' : `${tb.placement} strip`})` : '  DORSCH standard. Upload your company block (PDF, DXF or image).')),
    h('div', { class: 'row gap tb-row' },
      input,
      h('button', { class: 'btn', onclick: () => input.click() }, tb ? 'Replace title block' : 'Upload company title block'),
      h('label', { class: 'fld inline' }, h('span', {}, 'Placement on sheet'),
        h('select', { id: 'tb-place', disabled: !tb, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value as TbPlacement | ''; if (!v) set(undefined); else if (tb) set({ ...tb, placement: v }); } },
          PLACEMENTS.map(([v, l]) => h('option', { value: v, selected: (tb?.placement ?? '') === v, disabled: !tb && v !== '' }, l)))),
      tb?.placement === 'full' ? [
        num('Keep clear right (mm)', tb.reserveRight, (v) => set({ ...tb, reserveRight: v })),
        num('Keep clear bottom (mm)', tb.reserveBottom, (v) => set({ ...tb, reserveBottom: v })),
      ] : null,
      tb ? h('button', { class: 'btn ghost', onclick: () => set(undefined) }, 'Use DORSCH standard') : null),
    tb ? h('p', { class: 'muted small' }, tb.notes.join(' '), ' ', hasTokens(tb) ? h('b', {}, 'Placeholders found: they are filled on every sheet.') : 'No placeholders: a DORSCH data box (drawing no., door, scale, rev, status) is added inside the drawing area.') : null,
    h('details', { class: 'small' }, h('summary', {}, 'Auto-fill fields in your title block'),
      h('p', { class: 'muted' }, 'Type these placeholders as text in your title block (in CAD or the PDF) and DORSCH fills them per sheet:'),
      h('p', { class: 'mono' }, TB_TOKENS.map((t) => `{${t}}`).join('  '))));
}
