import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleProject } from '../src/core/defaults.js';
import { readPdfText, readPdfVector } from '../src/core/pdf-read.js';
import { composeSheet } from '../src/cad/sheet.js';
import { jpegInfo, textWidth, toPdf } from '../src/cad/pdf.js';
import { toDxf } from '../src/cad/dxf.js';
import { readDxf } from '../src/cad/dxf-read.js';
import { detectStrips, fillTokens, hasTokens, tbFrame, tbFromDxf, tbFromImage, tbFromPdf } from '../src/cad/titleblock.js';
import type { Entity } from '../src/cad/entities.js';
import type { TitleBlock } from '../src/core/types.js';

const JPEG_1x1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==';

test('PDF writer: valid file, true A3 size, text readable back', async () => {
  const p = sampleProject();
  const s = composeSheet(p, p.doors[0], { size: 'A3' });
  const pdf = toPdf([{ entities: s.entities, paper: s.paper, S: s.S }], { title: 'T (1)' });
  const head = new TextDecoder('latin1').decode(pdf.subarray(0, 8));
  assert.equal(head, '%PDF-1.4');
  const r = await readPdfText(pdf);
  assert.equal(r.pages.length, 1);
  assert.equal(Math.round(r.pages[0].width / (72 / 25.4)), 420);
  assert.equal(Math.round(r.pages[0].height / (72 / 25.4)), 297);
  const all = r.pages[0].items.map((i) => i.s).join(' ');
  assert.match(all, new RegExp(s.drawingNo));
  assert.match(all, /ELEVATION - OUTSIDE/);
  assert.equal(r.producer, 'DORSCH - Door Schedule Solutions');
});

test('PDF writer: JPEG images embedded with their pixel size', () => {
  assert.deepEqual(jpegInfo(Uint8Array.from(atob(JPEG_1x1.split(',')[1]), (c) => c.charCodeAt(0))), { w: 1, h: 1, comps: 1 });
  const pdf = toPdf([{ entities: [{ t: 'image', layer: 'A-TITLE', p: [10, 10], w: 50, h: 20, src: JPEG_1x1 }], paper: [420, 297], S: 1 }]);
  const txt = new TextDecoder('latin1').decode(pdf);
  assert.match(txt, /\/Subtype \/Image \/Width 1 \/Height 1 \/ColorSpace \/DeviceGray/);
  assert.match(txt, /\/Im1 Do/);
});

test('Helvetica text widths', () => {
  assert.equal(textWidth('A', 10), 6.67);
  assert.equal(textWidth('ii', 10), 4.44);
});

const frameTb = (w: number, h: number, extra: Entity[] = []): TitleBlock => tbFromDxf({ entities: [{ t: 'poly', layer: 'A-TITLE', closed: true, pts: [[0, 0], [w, 0], [w, h], [0, h]] }, ...extra], texts: [], extents: null, units: 'mm', skipped: {} }, 'tb.dxf');

test('title block placement: strip shapes and full frames chosen by aspect', () => {
  assert.equal(frameTb(400, 40).placement, 'bottom');
  assert.equal(frameTb(60, 280).placement, 'right');
  assert.equal(frameTb(420, 297).placement, 'full');
  const b = tbFrame(frameTb(400, 40), 420, 297, 10);
  assert.equal(b.area.y0, 10 + 40 * (400 / 400));
  const r = tbFrame(frameTb(60, 277), 420, 297, 10);
  assert.equal(Math.round(r.area.x1), 410 - 60);
});

test('full frame: right title strip detected from a long rule line drawn in pieces', () => {
  const pieces: Entity[] = [{ t: 'line', layer: 'A-TITLE', a: [340, 5], b: [340, 150] }, { t: 'line', layer: 'A-TITLE', a: [340, 150], b: [340, 292] }];
  const tb = frameTb(420, 297, pieces);
  assert.deepEqual(detectStrips(tb.entities, 420, 297), { right: 80, bottom: 0 });
  assert.equal(tb.reserveRight, 80);
  const f = tbFrame(tb, 420, 297, 10);
  assert.ok(f.area.x1 <= 340 - 10);
});

test('placeholders in the client title block are filled per sheet', () => {
  const p = sampleProject();
  const tb = frameTb(400, 40, [{ t: 'text', layer: 'A-TEXT', p: [10, 10], h: 3, s: 'DWG {DRAWING_NO} / {PROJECT}' }]);
  assert.ok(hasTokens(tb));
  assert.equal(fillTokens('{DOOR} {UNKNOWN}', { DOOR: 'D1' }), 'D1 {UNKNOWN}');
  const s = composeSheet(p, p.doors[0], { size: 'A3', titleBlock: tb });
  const texts = s.entities.filter((e) => e.t === 'text').map((e) => (e as Extract<Entity, { t: 'text' }>).s);
  assert.ok(texts.includes(`DWG ${s.drawingNo} / ${p.name}`));
  assert.ok(!texts.includes('DRAWING NO.'), 'no DORSCH data box when the client block has placeholders');
  const plain = composeSheet(p, p.doors[0], { size: 'A3', titleBlock: frameTb(400, 40) });
  assert.ok(plain.entities.some((e) => e.t === 'text' && e.s === 'DRAWING NO.'), 'data box added when there are no placeholders');
});

test('PDF title block: vector paths, text and frame imported from a PDF page', async () => {
  const pdf = toPdf([{ entities: [{ t: 'line', layer: 'A-TITLE', a: [300, 0], b: [300, 297] }, { t: 'text', layer: 'A-TEXT', p: [310, 20], h: 3, s: 'ACME {DATE}' }], paper: [420, 297], S: 1 }]);
  const v = await readPdfVector(pdf, 0);
  const tb = tbFromPdf(v, 'tb.pdf');
  assert.equal(Math.round(tb.width), 420);
  assert.equal(Math.round(tb.height), 297);
  assert.equal(tb.placement, 'full');
  assert.equal(Math.round(tb.reserveRight), 120);
  const t = tb.entities.find((e) => e.t === 'text');
  assert.ok(t && t.t === 'text' && t.s === 'ACME {DATE}' && Math.abs(t.h - 3) < 0.05);
});

test('image title block: DXF keeps a frame, preview/PDF keep the image', () => {
  const tb = tbFromImage(JPEG_1x1, 2000, 200, 'logo.jpg');
  assert.equal(tb.placement, 'bottom');
  const dxf = toDxf(tb.entities, {});
  assert.equal(readDxf(dxf).entities.filter((e) => e.t === 'poly').length, 1);
});
