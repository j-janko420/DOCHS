import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { zip } from '../src/core/export.js';
import { pageLines, pageTable, parseCMap, readPdfText } from '../src/core/pdf-read.js';
import { readDocx } from '../src/core/docx-read.js';
import { dwgVersion, readDxf } from '../src/cad/dxf-read.js';
import {
  buildProject, crossCheck, extractInfo, findHardware, findLayouts, findSchedule, floorLabel, hardwareCategory, kindOf, markFamily,
  normMark, normSet, readDoc, scheduleMarks, setsFromLines, setsFromTable, type Line,
} from '../src/core/intake.js';

const enc = new TextEncoder();

// A small PDF built by hand: Flate-compressed content, Helvetica text placed as a 3 x 3 table.
function makePdf(content: string, extra = ''): Uint8Array {
  const comp = deflateSync(enc.encode(content));
  const objs: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R ${extra}>>`],
    [`<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`, comp, '\nendstream'],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [' + Array(95).fill(556).join(' ') + '] >>'],
  ];
  const parts: Uint8Array[] = [enc.encode('%PDF-1.4\n')];
  objs.forEach((o, i) => {
    parts.push(enc.encode(`${i + 1} 0 obj\n`));
    for (const p of o) parts.push(typeof p === 'string' ? enc.encode(p) : p);
    parts.push(enc.encode('\nendobj\n'));
  });
  parts.push(enc.encode('trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n'));
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const TABLE_PDF = [
  'BT /F1 10 Tf 50 800 Td (Project: Harbour View Hotel) Tj ET',
  'BT /F1 9 Tf 50 760 Td (Door No) Tj 150 0 Td (Fire rating) Tj 150 0 Td (HW Set) Tj ET',
  'BT /F1 9 Tf 50 745 Td (D-101) Tj 150 0 Td (60 min) Tj 150 0 Td (HW-01) Tj ET',
  'BT /F1 9 Tf 50 730 Td [(D-1)20(02)] TJ 150 0 Td (NFR) Tj 150 0 Td (HW-02) Tj ET',
].join('\n');

test('PDF reader: text, kerned TJ joined, table grid rebuilt', async () => {
  const r = await readPdfText(makePdf(TABLE_PDF));
  assert.equal(r.pages.length, 1);
  const lines = pageLines(r.pages[0]).map((l) => l.cells.map((c) => c.s));
  assert.deepEqual(lines[0], ['Project: Harbour View Hotel']);
  assert.deepEqual(lines[3], ['D-102', 'NFR', 'HW-02']);
  const grid = pageTable(r.pages[0]);
  assert.deepEqual(grid.slice(1), [['Door No', 'Fire rating', 'HW Set'], ['D-101', '60 min', 'HW-01'], ['D-102', 'NFR', 'HW-02']]);
});

test('PDF reader: markup annotations are read as notes', async () => {
  const pdf = makePdf('BT /F1 9 Tf 50 700 Td (D-101) Tj ET', '/Annots [<< /Subtype /FreeText /Rect [300 500 400 520] /Contents (LEGEND - 2 DOORS) >>]');
  const r = await readPdfText(pdf);
  assert.ok(r.pages[0].items.some((i) => i.note && i.s === 'LEGEND - 2 DOORS'));
});

test('PDF reader: refuses non-PDF input with a clear message', async () => {
  await assert.rejects(() => readPdfText(enc.encode('hello')), /Not a PDF/);
});

test('ToUnicode CMap: bfchar and both bfrange forms', () => {
  const cm = parseCMap('1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0020> <0024> <0041> endbfchar 2 beginbfrange <0010> <0012> <0030> <0050> <0051> [<0058> <0059>] endbfrange');
  assert.equal(cm.map.get(3), ' ');
  assert.equal(cm.map.get(0x24), 'A');
  assert.equal([0x10, 0x11, 0x12].map((c) => cm.map.get(c)).join(''), '012');
  assert.equal(cm.map.get(0x51), 'Y');
  assert.deepEqual(cm.ranges, [{ lo: 0, hi: 0xffff, n: 2 }]);
});

test('Word reader: paragraphs and tables', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Hardware Set HW-01 Office</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">Butt hinge &amp; bearing</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const r = await readDocx(zip([{ name: 'word/document.xml', data: xml }]));
  assert.equal(r.lines[0], 'Hardware Set HW-01 Office');
  assert.deepEqual(r.tables[0], [['Qty', 'Item'], ['3', 'Butt hinge & bearing']]);
});

test('DXF reader: lines, bulged polyline, text, block insert with attribute', () => {
  const g = (pairs: (string | number)[]) => pairs.join('\n') + '\n';
  const dxf = g([0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC',
    0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'TB', 10, 0, 20, 0, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0, 0, 'ATTDEF', 1, 'PROMPT', 0, 'ENDBLK', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 420, 21, 297,
    0, 'LWPOLYLINE', 8, '0', 90, 2, 70, 0, 10, 1, 20, 0, 42, 1, 10, -1, 20, 0,
    0, 'TEXT', 8, '0', 10, 5, 20, 5, 40, 3.5, 1, 'PROJECT: TEST',
    0, 'INSERT', 8, '0', 2, 'TB', 10, 200, 20, 10, 41, 2, 42, 2, 66, 1, 0, 'ATTRIB', 8, '0', 10, 210, 20, 12, 40, 2.5, 1, 'DRG 001', 0, 'SEQEND',
    0, 'ENDSEC', 0, 'EOF']);
  const r = readDxf(dxf);
  assert.equal(r.units, 'mm');
  const poly = r.entities.find((e) => e.t === 'poly');
  assert.ok(poly && poly.t === 'poly' && poly.pts.some((p) => Math.abs(p[1] - 1) < 1e-6), 'bulge 1 = semicircle through (0,1)');
  const blockLine = r.entities.filter((e) => e.t === 'line')[1];
  assert.ok(blockLine.t === 'line' && blockLine.b[0] === 400 && blockLine.a[0] === 200, 'block scaled x2 and moved');
  assert.deepEqual(r.texts.map((t) => t.s), ['PROJECT: TEST', 'DRG 001']);
});

test('DWG: version detected, never parsed', () => {
  assert.equal(dwgVersion(enc.encode('AC1032\0\0\0')), 'AutoCAD 2018');
  assert.equal(dwgVersion(enc.encode('%PDF-1')), null);
});

test('file kinds', () => {
  assert.deepEqual(['a.PDF', 'b.xlsx', 'c.docx', 'd.dwg', 'e.jpg', 'f.txt', 'g.doc'].map(kindOf), ['pdf', 'xlsx', 'docx', 'dwg', 'image', 'text', 'other']);
});

test('normalising codes and marks; floor labels', () => {
  assert.equal(normSet('HW-01'), '1');
  assert.equal(normSet('Hardware Set 01'), '1');
  assert.equal(normSet('Set: 03.15'), '3.15');
  assert.equal(normMark('T-32-025.A'), normMark('T-32-025A'));
  assert.equal(normMark('T-32-313 A'), 'T-32-313A');
  assert.equal(markFamily('T-32-019C'), markFamily('T-32-020'));
  assert.equal(floorLabel('Key plan LEVEL 32 Sky Gaming'), 'Level 32');
  assert.equal(floorLabel('ground floor plan'), 'Ground Floor');
  assert.equal(floorLabel('door layout'), '');
});

test('hardware category keywords', () => {
  const cases: [string, string][] = [['Hinge, Full Mortise, Hvy Wt', 'hinge'], ['Fail Secure Lock', 'lock'], ['Cylinder (temporary&permanent)', 'cylinder'], ['Surface Closer', 'closer'],
    ['Armor Plate', 'protection'], ['Lever Protector', 'protection'], ['Card Reader', 'access-control'], ['Power Supply', 'electrical'], ['Exit Device rim', 'panic'], ['Lever handle on rose', 'handle'], ['Pull handle 300 mm', 'pull'], ['Flush Bolt (top auto)', 'flush-bolt'], ['Gasketing', 'seal'], ['Wall Stop', 'stop']];
  for (const [t, c] of cases) assert.equal(hardwareCategory(t), c, t);
});

const L = (...cells: [number, string][]): Line => ({ cells: cells.map(([x, s]) => ({ x, s })) });

test('hardware sets from PDF-style lines: heading, doors, wrapped model text, notes skipped', () => {
  const lines: Line[] = [
    L([264, 'Set: 03.15']),
    L([72, 'Doors: D-101, D-102.A']),
    L([72, 'Description: BOH single fail secure']),
    L([72, 'CAGE MANTRAP']),
    L([269, 'T4A3386 5" x 4-1/2"']),
    L([72, '3'], [89, 'Hinge, Full Mortise, Hvy Wt'], [465, 'US32D MK']),
    L([269, 'OUTSWING DOORS)']),
    L([72, '1 Surface Closer'], [269, '7500'], [465, '689'], [501, 'NO']),
    L([72, 'WYNN – PAGE HEADER']),
    L([72, 'Note - tie to fire alarm']),
    L([72, '1'], [89, 'Should be skipped, inside notes']),
    L([264, 'Set: 03.16']),
    L([72, '2'], [89, 'Card Reader'], [269, 'WRDM0G4B'], [440, 'Black'], [501, 'Salto']),
  ];
  const sets = setsFromLines(lines, 'hw.pdf');
  assert.equal(sets.length, 2);
  const [a, b] = sets;
  assert.equal(a.code, '03.15');
  assert.deepEqual(a.doors, ['D-101', 'D-102.A']);
  assert.equal(a.description, 'BOH single fail secure CAGE MANTRAP');
  assert.equal(a.items.length, 2);
  assert.deepEqual({ ...a.items[0], id: '' }, { id: '', catalogueId: '', item: 'Hinge, Full Mortise, Hvy Wt', qty: 3, basis: 'per-door', manufacturer: 'MK', model: 'T4A3386 5" x 4-1/2" OUTSWING DOORS)', finish: 'US32D' });
  assert.deepEqual([a.items[1].item, a.items[1].model, a.items[1].finish, a.items[1].manufacturer], ['Surface Closer', '7500', '689', 'NO']);
  assert.deepEqual([b.items[0].qty, b.items[0].item, b.items[0].finish, b.items[0].manufacturer], [2, 'Card Reader', 'Black', 'Salto']);
});

test('hardware sets from plain text lines (qty in the text)', () => {
  const sets = setsFromLines([L([0, 'Hardware Set HW-01 Office doors']), L([0, '3 No. butt hinges 100 mm SSS per leaf']), L([0, '1 x lever handle on rose satin stainless'])], 'hw.txt');
  assert.equal(sets[0].code, 'HW-01');
  assert.equal(sets[0].description, 'Office doors');
  assert.deepEqual(sets[0].items.map((i) => [i.qty, i.basis, i.finish]), [[3, 'per-leaf', 'SSS'], [1, 'per-door', 'satin stainless']]);
});

test('hardware sets from a table with Set / Qty / Item columns', () => {
  const rows = [['IRONMONGERY SCHEDULE'], ['Set', 'Qty', 'Item', 'Manufacturer', 'Model', 'Finish'], ['HW1', '3', 'Hinge', 'Acme', 'H100', 'SSS'], ['', '1', 'Closer', 'Acme', 'C50', 'Silver'], ['HW2', '1', 'Pull handle', 'Acme', 'P300', 'SSS']];
  const sets = setsFromTable(rows, 'hw.xlsx')!;
  assert.deepEqual(sets.map((s) => [s.code, s.items.length]), [['HW1', 2], ['HW2', 1]]);
  assert.deepEqual([sets[0].items[1].item, sets[0].items[1].model, sets[0].items[1].finish], ['Closer', 'C50', 'Silver']);
  assert.equal(setsFromTable([['a', 'b']], 'x'), null);
});

const SCHED_CSV = 'Project Name,Harbour View Hotel\nClient,Harbour Holdings\n\nDoor No,Level,Width,Height,Fire rating,Hardware set\nD-101,Level 1,900,2100,60 min,HW-01\nD-102,Level 1,1000,2100,,HW-02\nD-103,Level 2,900,2100,,HW-03\n';

test('intake end to end: info, schedule, layouts, hardware, cross-check, project', async () => {
  const docs = [
    await readDoc('schedule.csv', enc.encode(SCHED_CSV), 'schedule'),
    await readDoc('Level 1 plan.txt', enc.encode('PLAN LEVEL 1\nD-101   D-102   D-109\nLEGEND - 3 DOORS\n'), 'layout'),
    await readDoc('ironmongery.txt', enc.encode('Hardware Set HW-01\n3 No. hinges\nHardware Set HW-02\n1 x pull handle\nHardware Set HW-09\n1 x closer\n'), 'hardware'),
    await readDoc('photo.jpg', new Uint8Array([0xff, 0xd8]), 'layout'),
  ];
  const info = extractInfo(docs);
  assert.equal(info.name?.value, 'Harbour View Hotel');
  assert.equal(info.client?.value, 'Harbour Holdings');
  const s = findSchedule(docs)!;
  assert.equal(s.headerRow, 3);
  const sm = scheduleMarks(s);
  assert.deepEqual(sm.marks, ['D-101', 'D-102', 'D-103']);
  const lay = findLayouts(docs, sm.marks);
  assert.deepEqual(lay[0].marks, ['D-101', 'D-102', 'D-109']);
  assert.equal(lay[0].floor, 'Level 1');
  assert.equal(lay[0].legendTotal, 3);
  const hw = findHardware(docs);
  assert.deepEqual(hw.map((x) => x.code), ['HW-01', 'HW-02', 'HW-09']);
  const f = crossCheck({ docs, schedule: sm, layouts: lay, hardware: hw, info });
  const text = f.map((x) => `${x.sev} ${x.text}`).join('\n');
  assert.match(text, /warning 2 of 3 scheduled doors found on the layouts\. Not found: D-103/);
  assert.match(text, /On the layouts but not in the schedule: D-109/);
  assert.match(text, /Sets used in the schedule but not defined in the hardware file: HW-03/);
  assert.match(text, /Sets defined but not used by any scheduled door: HW-09/);
  assert.match(text, /photo\.jpg: Image received/);
  const r = buildProject({ name: 'Harbour View Hotel', number: '', client: 'Harbour Holdings', consultant: '', location: '', date: '', revision: '' }, s, hw, lay);
  assert.equal(r.project.doors.length, 3);
  assert.deepEqual(r.project.floors.map((x) => x.name).sort(), ['Level 1', 'Level 2']);
  assert.equal(r.report!.dataRows, r.report!.imported + r.report!.updated + r.report!.skipped.length);
  assert.deepEqual(r.project.hardwareSets.map((x) => x.code), ['HW-01', 'HW-02', 'HW-09']);
  assert.equal(r.project.doors[0].fireRating, '60 min');
});

test('intake: no floor column -> doors placed by the floor-wise layout they appear on; set from door lists', async () => {
  const docs = [
    await readDoc('s.csv', enc.encode('Door No,Width\nA-01,900\nA-02,900\nB-01,900\n'), 'schedule'),
    await readDoc('Ground floor.txt', enc.encode('A-01 A-02\n'), 'layout'),
    await readDoc('First floor.txt', enc.encode('B-01\n'), 'layout'),
  ];
  const s = findSchedule(docs)!;
  const lay = findLayouts(docs, scheduleMarks(s).marks);
  const sets = setsFromLines([L([0, 'Set: 7']), L([0, 'Doors: A-01, B-01']), L([0, '3'], [20, 'Hinge'])], 'x');
  const r = buildProject({ name: 'P', number: '', client: '', consultant: '', location: '', date: '', revision: '' }, s, sets, lay);
  const fl = (m: string) => r.project.floors.find((f) => f.id === r.project.doors.find((d) => d.mark === m)!.floorId)!.name;
  assert.deepEqual(['A-01', 'A-02', 'B-01'].map(fl), ['Ground Floor', 'Ground Floor', 'First Floor']);
  assert.deepEqual(r.project.doors.map((d) => d.hardwareSet), ['7', '', '7']);
});
