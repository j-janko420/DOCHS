import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { blankProject } from '../src/core/defaults.js';
import { crc32 } from '../src/core/export.js';
import { readXlsx } from '../src/core/xlsx-read.js';
import { autoMapping, csvRows, findHeaderRow, importRows, parseAcoustic, parseConfiguration, parseFire, parseLength } from '../src/core/importer.js';
import { SAMPLES, SCHOOL_CSV, sampleHospitality, sampleSchoolImport } from '../src/core/samples.js';
import { validateDoor, validateProject } from '../src/core/validate.js';
import { buildScene } from '../src/ui/viewer3d.js';

// Deflate-compressed zip, like Excel writes (our own writer only stores).
function zipDeflated(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), comp = deflateRawSync(raw), nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc32(raw), true);
    lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(16, crc32(raw), true); ch.setUint32(20, comp.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length / 2, true); end.setUint16(10, central.length / 2, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const WB = `<workbook xmlns:r="r"><sheets><sheet name="Title &amp; notes" sheetId="1" r:id="rId1"/><sheet name="Doors" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
const SST = `<sst><si><t>Door Number</t></si><si><t>Acoustic/FR/Normal</t></si><si><t>Movement</t></si><si><t>Qty</t></si><si><t>Door Location</t></si><si><r><t>FR 60 </t></r><r><t>min</t></r></si><si><t>Double</t></si><si><t>Acoustic 40DB / NFR</t></si><si><t>Single</t></si><si><t>Lobby to corridor</t></si><si><t>TOTAL DOORS</t></si><si><t>Width</t></si><si><t>Shutters - source</t></si><si><t>Sliding</t></si></sst>`;
const c = (r: string, s: number) => `<c r="${r}" t="s"><v>${s}</v></c>`;
const n = (r: string, v: number) => `<c r="${r}"><v>${v}</v></c>`;
const SHEET2 = `<worksheet><sheetData>
<row r="2">${c('A2', 0)}${c('B2', 1)}${c('C2', 2)}${c('D2', 3)}${c('E2', 4)}${c('F2', 11)}${c('G2', 12)}</row>
<row r="3">${`<c r="A3" t="inlineStr"><is><t>D-01</t></is></c>`}${c('B3', 5)}${c('C3', 6)}${n('D3', 1)}${c('E3', 9)}${n('F3', 1800)}${n('G3', 2)}</row>
<row r="4">${`<c r="A4" t="str"><f>A3</f><v>D-02</v></c>`}${c('B4', 7)}${c('C4', 8)}${n('D4', 2)}${n('F4', 900)}</row>
<row r="5"><c r="A5" t="inlineStr"><is><t>D-01</t></is></c></row>
<row r="6">${c('E6', 9)}</row>
<row r="7"><c r="A7" t="inlineStr"><is><t>D-03</t></is></c>${c('C7', 13)}${n('G7', 2)}</row>
<row r="9">${c('A9', 10)}${n('D9', 4)}</row>
</sheetData></worksheet>`;

test('reads a deflate-compressed xlsx: shared and rich strings, inline strings, formula values, sparse rows', async () => {
  const sheets = await readXlsx(zipDeflated({ 'xl/workbook.xml': WB, 'xl/_rels/workbook.xml.rels': RELS, 'xl/sharedStrings.xml': SST, 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>', 'xl/worksheets/sheet2.xml': SHEET2 }));
  assert.deepEqual(sheets.map((s) => s.name), ['Title & notes', 'Doors']);
  const rows = sheets[1].rows;
  assert.equal(rows[2][1], 'FR 60 min'); // rich text runs joined
  assert.equal(rows[3][0], 'D-02'); // cached formula value
  assert.equal(rows[2][5], '1800');
  const hr = findHeaderRow(rows);
  assert.equal(hr, 1);
  const p = blankProject('t');
  const r = importRows(p, rows, { fileName: 'x.xlsx', sheetName: 'Doors', headerRow: hr, mapping: autoMapping(rows[hr]), units: 'auto', buildingId: p.buildings[0].id, defaultFloorId: p.floors[0].id, existing: 'skip' });
  const rep = r.report;
  // 6 data rows: D-01, D-02, duplicate D-01, a row with no mark, D-03, TOTAL
  assert.equal(rep.dataRows, 6);
  assert.equal(rep.imported, 3);
  assert.equal(rep.dataRows, rep.imported + rep.updated + rep.skipped.length);
  assert.deepEqual(rep.skipped.map((s) => s.text).sort(), ['duplicate mark in the file (first occurrence kept)', 'no door mark', 'total / summary row']);
  const d1 = r.project.doors.find((d) => d.mark === 'D-01')!;
  assert.equal(d1.configuration, 'double-equal');
  assert.equal(d1.fireRating, '60 min');
  assert.deepEqual([d1.leafWidth1, d1.leafWidth2], [900, 900]); // pair total split, with a warning
  assert.ok(rep.warnings.some((w) => w.mark === 'D-01' && /pair total/.test(w.text)));
  const d2 = r.project.doors.find((d) => d.mark === 'D-02')!;
  assert.equal(d2.acousticRating, '40 dB');
  assert.equal(d2.fireRating, '');
  assert.equal(d2.quantity, 2);
  assert.equal(d2.leafWidth1, 900);
  assert.equal(r.project.doors.find((d) => d.mark === 'D-03')!.configuration, 'sliding-double');
  assert.match(d1.remarks, /x\.xlsx \/ Doors \/ row 3/);
});

test('length, fire, acoustic and configuration parsers', () => {
  assert.equal(parseLength(`3'-0"`, 'auto').value, 914);
  assert.equal(parseLength(`7' 0"`, 'auto').value, 2134);
  assert.equal(parseLength('84"', 'auto').value, 2134);
  assert.equal(parseLength('900', 'auto').value, 900);
  assert.equal(parseLength('0.9 m', 'auto').value, 900);
  assert.equal(parseLength('36', 'inch').value, 914);
  assert.equal(parseLength('abc', 'auto').value, null);
  assert.equal(parseFire('1 HR').value, '60 min');
  assert.equal(parseFire('1.5 HR').value, '90 min');
  assert.equal(parseFire('2H').value, '120 min');
  assert.equal(parseFire('FR 60 min').value, '60 min');
  assert.equal(parseFire('Normal / NFR').value, '');
  assert.equal(parseFire('Normal / NFR').note, undefined);
  assert.match(parseFire('FR 90 min (1.5 HR) - CONFIRM').note ?? '', /confirm/);
  assert.equal(parseAcoustic('Acoustic 40DB / NFR').value, '40 dB');
  assert.equal(parseAcoustic('Rw 45').value, '45 dB');
  assert.equal(parseConfiguration('Uneven Flush Door').value, 'double-unequal');
  assert.equal(parseConfiguration('Sliding').value, 'sliding-single');
  assert.equal(parseConfiguration('Double Flush Door').value, 'double-equal');
  assert.equal(parseConfiguration('DA pair').value, 'double-action-pair');
  assert.equal(parseConfiguration('xyz').value, '');
});

test('updating existing doors keeps unmapped data and records history', () => {
  const p = sampleHospitality();
  const rows = csvRows('Door No;Fire rating\nL32-102;1 HR\nNEW-1;');
  const r = importRows(p, rows, { fileName: 'u.csv', sheetName: 'u', headerRow: 0, mapping: autoMapping(rows[0]), units: 'auto', buildingId: p.buildings[0].id, defaultFloorId: p.floors[0].id, existing: 'update' });
  assert.equal(r.report.updated, 1);
  assert.equal(r.report.imported, 1);
  const d = r.project.doors.find((x) => x.mark === 'L32-102')!;
  assert.equal(d.fireRating, '60 min');
  assert.equal(d.acousticRating, '40 dB');
  assert.equal(d.history.at(-1)!.field, 'import');
  assert.throws(() => importRows(p, rows, { fileName: '', sheetName: '', headerRow: 0, mapping: ['', ''], units: 'auto', buildingId: '', defaultFloorId: '', existing: 'skip' }), /door mark/i);
});

test('samples: hospitality has no hard errors; imported school flags missing data instead of inventing it', () => {
  const hosp = sampleHospitality();
  assert.equal(hosp.doors.length, 12);
  assert.deepEqual(validateProject(hosp).filter((i) => i.severity === 'error').map((i) => `${i.mark} ${i.ruleId}`), []);
  const school = sampleSchoolImport();
  assert.equal(school.doors.length, 7);
  assert.deepEqual(school.floors.map((f) => f.name), ['Level 1', 'Level 2']);
  const d104 = school.doors.find((d) => d.mark === '104')!;
  assert.deepEqual([d104.configuration, d104.leafWidth1, d104.leafWidth2, d104.leafHeight, d104.fireRating], ['double-equal', 914, 914, 2134, '120 min']);
  const d101 = school.doors.find((d) => d.mark === '101')!;
  assert.equal(d101.openingWidth, null);
  assert.ok(validateDoor(d101, school).some((i) => i.ruleId === 'E-DIM-01'));
  for (const s of SAMPLES) assert.ok(s.build().isSample, s.key);
});

test('3D scene: finite geometry for every configuration; an LH leaf opened 90 deg swings inside', () => {
  const p = sampleHospitality();
  const configs = ['single', 'double-equal', 'double-unequal', 'double-action-single', 'double-action-pair', 'pivot', 'sliding-single', 'sliding-double', 'pocket'] as const;
  for (const configuration of configs) for (const exploded of [false, true]) {
    const d = { ...p.doors[2], configuration, leafWidth2: 500, pivotOffset: 100 };
    const faces = buildScene(d, { openFraction: 0.7, exploded, showWall: true });
    assert.ok(faces.length > 20 && faces.every((f) => f.pts.every((q) => q.every(Number.isFinite))), configuration);
  }
  const d = { ...p.doors[2], configuration: 'single' as const, handing: 'LH' as const, visionPanel: false, kickPlate: false, handleHeight: null };
  const closed = buildScene(d, { openFraction: 0, exploded: false, showWall: false });
  const open = buildScene(d, { openFraction: 1, exploded: false, showWall: false });
  const maxZ = (fs: typeof open) => Math.max(...fs.flatMap((f) => f.pts.map((q) => q[2])));
  assert.ok(maxZ(open) > maxZ(closed) + 500);
});

test('server field list matches the importer field list', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const path = '../server/app/dochs.py';
  if (!existsSync(path)) return; // web app built on its own
  const py = readFileSync(path, 'utf8');
  const block = py.slice(py.indexOf('TARGETS: dict[str, str] = {'), py.indexOf('}', py.indexOf('TARGETS: dict[str, str] = {')));
  const serverKeys = [...block.matchAll(/^\s+"([A-Za-z]+)":/gm)].map((m) => m[1]).sort();
  const { TARGETS } = await import('../src/core/importer.js');
  assert.deepEqual(serverKeys, TARGETS.map((t) => t.key).filter(Boolean).sort());
});

test('AI suggestions merge into the current matching without dropping good matches', async () => {
  const { mergeMapping } = await import('../src/core/importer.js');
  assert.deepEqual(mergeMapping(['mark', 'doorType', '', 'remarks'], ['', '', 'floor', '']), ['mark', 'doorType', 'floor', 'remarks']);
  // a field moved by the AI is cleared from its old column
  assert.deepEqual(mergeMapping(['mark', 'doorType', ''], ['', '', 'mark']), ['', 'doorType', 'mark']);
  assert.deepEqual(mergeMapping(['remarks', ''], ['', 'remarks']), ['remarks', 'remarks']);
});

test('guided test: report covers every scenario and the documented expectations hold', async () => {
  const { SCENARIOS, feedbackReport, VERSION } = await import('../src/ui/views/about.js');
  const r = feedbackReport({ tester: 'QA', results: { dash: { status: 'pass', note: '' }, filter: { status: 'fail', note: 'only 2 rows' } }, general: 'ok' });
  assert.ok(r.includes(VERSION) && r.includes('Tested: 2 of') && r.includes('only 2 rows'));
  assert.equal(r.split('\n').filter((l) => /^\d+\. /.test(l)).length, SCENARIOS.length);
  // scenario 1 and 2 expectations
  const { filterDoors } = await import('../src/core/classify.js');
  const p = sampleHospitality();
  const l31 = p.floors.find((f) => f.name === 'Level 31')!, l32 = p.floors.find((f) => f.name === 'Level 32')!;
  assert.equal(p.doors.filter((d) => d.floorId === l31.id).length, 2);
  assert.equal(p.doors.filter((d) => d.floorId === l32.id).length, 10);
  assert.deepEqual(filterDoors(p, { floorId: l32.id, categoryKeys: ['feature:fire-rated'] }).map((d) => d.mark), ['L32-201', 'L32-301', 'L32-303']);
  // scenario 7: the sample CSV has 8 data rows, 7 doors and a TOTAL row
  const rows = csvRows(SCHOOL_CSV);
  const r7 = importRows(p, rows, { fileName: 's.csv', sheetName: 's', headerRow: 0, mapping: autoMapping(rows[0]), units: 'auto', buildingId: p.buildings[0].id, defaultFloorId: l31.id, existing: 'skip' });
  assert.deepEqual([r7.report.dataRows, r7.report.imported, r7.report.skipped.length], [8, 7, 1]);
});
