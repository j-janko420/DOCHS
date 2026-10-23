import type { Door, Project } from '../core/types.js';
import { CONFIG_LABEL } from '../core/types.js';
import { buildingName, floorName } from '../core/classify.js';
import { drawingNumber } from '../core/schedule.js';
import type { BBox, Entity, Pt, View } from './entities.js';
import { bbox, place } from './entities.js';
import { doorViews } from './door-drawing.js';

export type SheetSize = 'A3' | 'A2' | 'A1';
export const SHEETS: Record<SheetSize, [number, number]> = { A3: [420, 297], A2: [594, 420], A1: [841, 594] };
export const MAIN_SCALE_OPTIONS = [10, 20, 25, 50, 100];
const MAIN_SCALES = MAIN_SCALE_OPTIONS;
const DETAIL_SCALES = [2, 5, 10, 20];

export interface SheetOptions {
  size: SheetSize;
  mainScale?: number; // force a scale; otherwise the largest that fits
}

export interface Sheet {
  size: SheetSize;
  paper: [number, number];
  S: number; // model units per paper mm (= main scale)
  mainScale: number;
  detailScale: number;
  entities: Entity[]; // model space, origin at sheet bottom-left
  drawingNo: string;
  door: Door;
}

const MARGIN = 10;
const TB_H = 42;
const NOTES_W = 95;
const GAP = 10;
const TITLE_SPACE = 10;

interface Placed { view: View; ents: Entity[]; box: BBox; w: number; h: number }

function prepare(view: View, S: number): Placed {
  const ents = place(view.entities, S / view.scale, S, 0, 0);
  const box = bbox(ents);
  return { view, ents, box, w: (box.x1 - box.x0) / S, h: (box.y1 - box.y0) / S };
}

function fits(row: Placed[], width: number): boolean {
  return row.reduce((s, p) => s + p.w, 0) + GAP * Math.max(0, row.length - 1) <= width;
}

export function composeSheet(p: Project, d: Door, opt: SheetOptions): Sheet {
  const [PW, PH] = SHEETS[opt.size];
  const views = doorViews(d);
  const mains = views.filter((v) => v.kind === 'main');
  const details = views.filter((v) => v.kind === 'detail');
  const areaW = PW - 2 * MARGIN - 8;
  const areaH = PH - 2 * MARGIN - TB_H - 8;
  let chosen: { S: number; sd: number; row1: Placed[]; row2: Placed[] } | null = null;
  const scales = opt.mainScale ? [opt.mainScale] : MAIN_SCALES;
  outer: for (const S of scales) {
    const row1 = mains.map((v) => prepare({ ...v, scale: S }, S));
    if (!fits(row1, areaW)) continue;
    const h1 = Math.max(...row1.map((r) => r.h)) + TITLE_SPACE;
    for (const sd of DETAIL_SCALES) {
      if (sd > S) break;
      const row2 = details.map((v) => prepare({ ...v, scale: sd }, S));
      const h2 = row2.length ? Math.max(...row2.map((r) => r.h)) + TITLE_SPACE : 0;
      if (fits(row2, areaW - NOTES_W - GAP) && h1 + GAP + h2 <= areaH) { chosen = { S, sd, row1, row2 }; break outer; }
    }
  }
  if (!chosen) {
    const S = opt.mainScale ?? MAIN_SCALES[MAIN_SCALES.length - 1];
    const sd = Math.min(S, 20);
    chosen = { S, sd, row1: mains.map((v) => prepare({ ...v, scale: S }, S)), row2: details.map((v) => prepare({ ...v, scale: sd }, S)) };
  }
  const { S, sd, row1, row2 } = chosen;
  const ents: Entity[] = [];
  const at = (pp: Pt): Pt => [pp[0] * S, pp[1] * S];

  // lay out rows (paper mm), row 1 at the top
  const h1 = Math.max(...row1.map((r) => r.h));
  const top = PH - MARGIN - 4;
  const y1base = top - h1; // bottom of row 1 boxes
  const y2base = MARGIN + TB_H + 4 + TITLE_SPACE;
  const layRow = (row: Placed[], yb: number, width: number, x0: number) => {
    const used = row.reduce((s, r) => s + r.w, 0);
    const gap = row.length > 1 ? Math.min(GAP * 3, (width - used) / (row.length - 1)) : 0;
    let x = x0 + (row.length > 1 ? 0 : (width - used) / 2);
    for (const r of row) {
      const dx = x * S - r.box.x0, dy = yb * S - r.box.y0;
      ents.push(...place(r.ents, 1, 1, dx, dy));
      const scaleTxt = `1:${r.view.scale}`;
      const cx = x + r.w / 2;
      ents.push({ t: 'text', layer: 'A-TITLE', p: at([cx, yb - 6]), h: 3.5 * S, s: `${r.view.title}  ${scaleTxt}`, align: 'center' });
      const tw = (r.view.title.length + scaleTxt.length + 2) * 3.5 * 0.75;
      ents.push({ t: 'line', layer: 'A-TITLE', a: at([cx - tw / 2, yb - 7.2]), b: at([cx + tw / 2, yb - 7.2]) });
      x += r.w + gap;
    }
  };
  layRow(row1, y1base, areaW, MARGIN + 4);
  layRow(row2, y2base, areaW - NOTES_W - GAP, MARGIN + 4);

  // border and title block
  ents.push({ t: 'poly', layer: 'A-SHEET', closed: true, pts: [at([0, 0]), at([PW, 0]), at([PW, PH]), at([0, PH])] });
  ents.push({ t: 'poly', layer: 'A-SHEET', closed: true, pts: [at([MARGIN, MARGIN]), at([PW - MARGIN, MARGIN]), at([PW - MARGIN, PH - MARGIN]), at([MARGIN, PH - MARGIN])] });
  ents.push(...titleBlock(p, d, S, PW, sd, opt.size));
  ents.push(...notes(d, S, PW, y1base - 16));
  return { size: opt.size, paper: [PW, PH], S, mainScale: S, detailScale: sd, entities: ents, drawingNo: drawingNumber(p, d), door: d };
}

function titleBlock(p: Project, d: Door, S: number, PW: number, sd: number, size: SheetSize): Entity[] {
  const es: Entity[] = [];
  const at = (x: number, y: number): Pt => [x * S, y * S];
  const x0 = MARGIN, y0 = MARGIN, x1 = PW - MARGIN, y1 = MARGIN + TB_H;
  es.push({ t: 'poly', layer: 'A-TITLE', closed: true, pts: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)] });
  const cols = [x0, x0 + 62, x0 + 62 + (x1 - x0 - 62) * 0.32, x0 + 62 + (x1 - x0 - 62) * 0.66, x1 - 62, x1];
  for (const c of cols.slice(1, -1)) es.push({ t: 'line', layer: 'A-TITLE', a: at(c, y0), b: at(c, y1) });
  const label = (x: number, y: number, s: string) => es.push({ t: 'text', layer: 'A-TITLE', p: at(x, y), h: 1.8 * S, s: s.toUpperCase(), align: 'left' });
  const val = (x: number, y: number, s: string, h = 2.6) => es.push({ t: 'text', layer: 'A-TEXT', p: at(x, y), h: h * S, s: s || '-', align: 'left' });
  // logo cell
  es.push({ t: 'poly', layer: 'A-TITLE', closed: true, pts: [at(x0 + 5, y0 + 14), at(x0 + 17, y0 + 14), at(x0 + 17, y0 + 34), at(x0 + 5, y0 + 34)] });
  es.push({ t: 'poly', layer: 'A-TITLE', closed: true, pts: [at(x0 + 8, y0 + 14), at(x0 + 15, y0 + 17), at(x0 + 15, y0 + 37), at(x0 + 8, y0 + 34)] });
  es.push({ t: 'text', layer: 'A-TITLE', p: at(x0 + 21, y0 + 24), h: 6 * S, s: 'DOCHS', align: 'left' });
  es.push({ t: 'text', layer: 'A-TEXT', p: at(x0 + 21, y0 + 17), h: 2.2 * S, s: 'DoorChisolution', align: 'left' });
  es.push({ t: 'text', layer: 'A-TEXT', p: at(x0 + 5, y0 + 5), h: 1.8 * S, s: 'DOCHS - Designed by i3 Design', align: 'left' });
  // project
  let x = cols[1] + 3;
  label(x, y1 - 5, 'Project'); val(x, y1 - 10, `${p.name}${p.number ? ' (' + p.number + ')' : ''}`);
  label(x, y1 - 16, 'Client'); val(x, y1 - 21, p.client);
  label(x, y1 - 27, 'Consultant'); val(x, y1 - 32, p.consultant);
  label(x, y1 - 38, `Location: ${p.location || '-'}`);
  // door
  x = cols[2] + 3;
  label(x, y1 - 5, 'Door'); val(x, y1 - 10.5, `${d.mark}  ${d.doorType}`, 3.5);
  label(x, y1 - 16, 'Building / floor / room'); val(x, y1 - 21, `${buildingName(p, d.buildingId)} / ${floorName(p, d.floorId)} / ${d.room}`);
  label(x, y1 - 27, 'Description'); val(x, y1 - 32, `${d.configuration ? CONFIG_LABEL[d.configuration] : ''} ${d.handing}${d.fireRating ? ' / FR ' + d.fireRating : ''}${d.acousticRating ? ' / ' + d.acousticRating : ''}`);
  label(x, y1 - 38, `Qty ${d.quantity ?? '-'}  /  HW ${d.hardwareSet || '-'}  /  Source ${d.sourceRef || '-'}`);
  // drawing data
  x = cols[3] + 3;
  label(x, y1 - 5, 'Scale'); val(x, y1 - 10, `1:${S} @ ${size} (details 1:${sd})`);
  label(x, y1 - 16, 'Date'); val(x, y1 - 21, p.date);
  label(x, y1 - 27, 'Status'); val(x, y1 - 32, d.status.toUpperCase());
  label(x, y1 - 38, `Prepared ${p.preparedBy || '-'}  Checked ${p.checkedBy || '-'}  Approved ${p.approvedBy || '-'}`);
  // number
  x = cols[4] + 3;
  label(x, y1 - 5, 'Drawing no.'); val(x, y1 - 12, drawingNumber(p, d), 4);
  label(x, y1 - 20, 'Revision'); val(x, y1 - 27, d.revision || p.revision, 4);
  label(x, y1 - 38, 'All dimensions in mm');
  return es;
}

function notes(d: Door, S: number, PW: number, yTop: number): Entity[] {
  const x = PW - MARGIN - NOTES_W;
  const banner = d.status !== 'approved' ? [`${d.status.toUpperCase().replace('-', ' ')} - NOT FOR CONSTRUCTION`, ''] : [];
  const lines = [
    ...banner,
    'NOTES',
    '1. All dimensions in millimetres. Do not scale.',
    '2. Generated from the DOCHS door register record.',
    '3. Sections are schematic: frame profile from entered',
    '   width / depth / rebate / gaps. Verify against the',
    '   approved manufacturer shop drawing.',
    '4. Handing LH/RH/LHR/RHR viewed from OUTSIDE.',
    '   Leaf 1 = left leaf viewed from outside.',
    '5. Hinge positions measured from bottom of leaf.',
    '   Handle height measured from finished floor.',
    '6. Fire / acoustic / access-control compliance is',
    '   not assessed by DOCHS; confirm with consultants.',
    '',
    `FRAME: ${d.frameMaterial || '-'} ${d.frameFinish}`.trim(),
    `LEAF: ${d.leafMaterial || '-'} ${d.leafCore} ${d.leafFacing}`.trim(),
    `FINISH: ${d.finishSide1 || '-'} / ${d.finishSide2 || '-'}`,
    `FIRE: ${d.fireRating || '-'}   ACOUSTIC: ${d.acousticRating || '-'}`,
    `HARDWARE SET: ${d.hardwareSet || '-'}`,
    `REMARKS: ${d.remarks || '-'}`.slice(0, 60),
  ];
  const head = banner.length ? [0, 2] : [0];
  return lines.map((s, i) => ({ t: 'text', layer: head.includes(i) ? 'A-TITLE' : 'A-TEXT', p: [x * S, (yTop - i * 4.2) * S], h: (head.includes(i) ? 3 : 2) * S, s, align: 'left' }) as Entity);
}

// Several sheets side by side in one model space (floor / category set).
export function composeSet(sheets: Sheet[]): Entity[] {
  const out: Entity[] = [];
  let x = 0;
  for (const s of sheets) {
    out.push(...place(s.entities, 1, 1, x, 0));
    x += s.paper[0] * s.S + 50 * s.S;
  }
  return out;
}
