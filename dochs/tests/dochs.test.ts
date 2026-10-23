import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { blankDoor, sampleProject } from '../src/core/defaults.js';
import type { Door, Project } from '../src/core/types.js';
import { classify, filterDoors } from '../src/core/classify.js';
import { frameFit } from '../src/core/geometry.js';
import { drawable, validateDoor } from '../src/core/validate.js';
import { doorSchedule, hardwareTakeoff, quantitySummary } from '../src/core/schedule.js';
import { crc32, toCsv, xlsx, zip } from '../src/core/export.js';
import { exportProject, importProject, patchDoor, removeFloor } from '../src/core/project-ops.js';
import { doorParams, doorViews, elevationView, planView } from '../src/cad/door-drawing.js';
import { bbox, dimGeometry, place, type Entity } from '../src/cad/entities.js';
import { composeSet, composeSheet } from '../src/cad/sheet.js';
import { dxfStats, parsePairs, toDxf } from '../src/cad/dxf.js';
import { toSvg } from '../src/cad/svg.js';

const P = sampleProject();
const door = (mark: string): Door => P.doors.find((d) => d.mark === mark)!;
const rules = (d: Door, p: Project = P) => validateDoor(d, p).map((i) => i.ruleId);
const dims = (es: Entity[]) => es.filter((e): e is Extract<Entity, { t: 'dim' }> => e.t === 'dim');

// ---------- geometry and validation ----------

test('frame fit formula matches sample single door', () => {
  const f = frameFit(door('D-G01'));
  assert.equal(f.frameOuterWidth, 990);
  assert.equal(f.apertureWidth, 890);
  assert.equal(f.expectedLeafTotal, 914);
  assert.equal(f.expectedLeafHeight, 2149);
  assert.equal(f.nominalClearWidth, 845);
});

test('sample project has no hard errors', () => {
  for (const d of P.doors) assert.deepEqual(validateDoor(d, P).filter((i) => i.severity === 'error').map((i) => `${d.mark} ${i.ruleId}`), []);
});

test('blank door is flagged and blocked, never filled in', () => {
  const d = blankDoor({ buildingId: 'bld_main', floorId: 'flr_g' });
  const p = { ...P, doors: [...P.doors, d] };
  const r = rules(d, p);
  for (const id of ['E-ID-01', 'E-CFG-01', 'E-DIM-01', 'E-DIM-02', 'E-DIM-03', 'E-DIM-04', 'W-FRM-01', 'W-HW-01']) assert.ok(r.includes(id), id);
  assert.equal(drawable(d, p).ok, false);
  assert.equal(d.openingWidth, null);
});

test('leaf taller than structural opening is an error', () => {
  const d = { ...door('D-G01'), leafHeight: 2945, openingHeight: 2935 };
  assert.ok(rules(d).includes('E-DIM-07'));
});

test('pair leaf widths that exceed the opening are an error', () => {
  const d = { ...door('D-B01'), leafWidth1: 1065, leafWidth2: 1065, openingWidth: 2070 };
  assert.ok(rules(d).includes('E-DIM-08'));
});

test('equal pair with unequal leaves is an error; fit mismatch is a warning with the calculation', () => {
  const d = { ...door('D-B01'), leafWidth2: 800 };
  assert.ok(rules(d).includes('E-DIM-05'));
  const w = validateDoor({ ...door('D-G01'), leafWidth1: 930 }, P).find((i) => i.ruleId === 'W-DIM-10')!;
  assert.match(w.check, /aperture 890/);
  assert.equal(w.severity, 'warning');
});

test('duplicate marks, required clear width and vision panel fit', () => {
  const dup = { ...door('D-G02'), id: 'x', mark: 'D-G01' };
  assert.ok(rules(dup, { ...P, doors: [...P.doors, dup] }).includes('E-ID-02'));
  assert.ok(rules({ ...door('D-G01'), requiredClearWidth: 900 }).includes('E-CLR-01'));
  assert.ok(!rules({ ...door('D-G01'), requiredClearWidth: 800 }).includes('E-CLR-01'));
  assert.ok(rules({ ...door('D-G01'), vpHeight: 2000 }).includes('E-VP-02'));
});

test('fire rating produces information for the consultant, not a compliance verdict', () => {
  const r = validateDoor(door('D-B01'), P).find((i) => i.ruleId === 'I-FR-01')!;
  assert.equal(r.severity, 'info');
  assert.match(r.action, /fire consultant/);
});

test('approved door with errors is flagged', () => {
  const d = { ...door('D-G01'), leafThickness: null };
  assert.ok(rules(d).includes('E-REV-02'));
});

// ---------- classification and floor / category filters ----------

test('classification is multi-membership', () => {
  const keys = classify(door('D-G03'), P).map((c) => c.key);
  for (const k of ['leaf:double', 'operation:swing', 'feature:glazed', 'feature:access-controlled', 'custom:cat_ext']) assert.ok(keys.includes(k), k);
});

test('floor and category filters select the expected doors', () => {
  assert.deepEqual(filterDoors(P, { floorId: 'flr_g' }).map((d) => d.mark), ['D-G01', 'D-G02', 'D-G03']);
  assert.deepEqual(filterDoors(P, { categoryKeys: ['feature:fire-rated'] }).map((d) => d.mark), ['D-B01', 'D-R01']);
  assert.deepEqual(filterDoors(P, { floorId: 'flr_g', categoryKeys: ['feature:glazed'] }).map((d) => d.mark), ['D-G01', 'D-G03']);
  assert.deepEqual(filterDoors(P, { categoryKeys: ['custom:cat_ext', 'feature:fire-rated'] }).map((d) => d.mark), ['D-R01']);
  // floor order follows the floor list, not alphabetical
  assert.deepEqual(filterDoors(P, {}).map((d) => d.floorId)[0], 'flr_b1');
});

// ---------- schedules and quantities ----------

test('schedule rows carry the same dimensions as the door record', () => {
  const t = doorSchedule(P, [door('D-G03')]);
  const row = Object.fromEntries(t.columns.map((c, i) => [c, t.rows[0][i]]));
  assert.equal(row['S.O. width'], 1500);
  assert.equal(row['Leaf 1 width'], 914);
  assert.equal(row['Leaf 2 width'], 497);
  assert.equal(row['Drawing no.'], 'DCH-D-G03');
});

test('quantity summary totals door qty and leaves', () => {
  const t = quantitySummary(P, P.doors);
  const total = t.rows[t.rows.length - 1];
  assert.equal(total[3], 9); // D-G02 qty 2
  assert.equal(total[4], 11); // two pairs add a leaf each
});

test('hardware takeoff uses explicit per-door / per-leaf rules and reports unresolved doors', () => {
  const tk = hardwareTakeoff(P, P.doors);
  const hinge03 = tk.lines.find((l) => l.set === 'HW-03' && l.item === 'Butt hinge (generic)')!;
  assert.equal(hinge03.quantity, 3 * 1 * 2 + 3 * 1 * 1); // D-B01 pair + D-R01 single
  const hinge02 = tk.lines.find((l) => l.set === 'HW-02' && l.item === 'Butt hinge (generic)')!;
  assert.equal(hinge02.quantity, 6); // qty 2
  assert.match(hinge03.basis, /per-leaf/);
  assert.deepEqual(tk.unresolved, ['D-102: no hardware set']);
});

// ---------- CAD geometry ----------

test('plan and elevation dimensions equal the door record values', () => {
  for (const mark of ['D-G01', 'D-B01', 'D-G03', 'D-201']) {
    const d = door(mark);
    const values = dims(planView(d).entities).map((x) => x.value);
    assert.ok(values.includes(d.openingWidth!), `${mark} S.O.`);
    assert.ok(values.includes(d.leafWidth1!), `${mark} leaf 1`);
    if (d.leafWidth2) assert.ok(values.includes(d.leafWidth2), `${mark} leaf 2`);
    assert.ok(values.includes(d.wallThickness!), `${mark} wall`);
    const ev = dims(elevationView(d, 'front').entities).map((x) => x.value);
    assert.ok(ev.includes(d.openingHeight!) && ev.includes(d.leafHeight!), `${mark} heights`);
  }
});

test('leaf geometry positions match the frame fit', () => {
  const p = doorParams(door('D-G01'));
  assert.equal(p.leaves[0].x0, 5 + 50 - 15 + 3);
  assert.equal(p.leaves[0].x1 - p.leaves[0].x0, 914);
  assert.equal(p.leafTop, 8 + 2149);
  const pair = doorParams(door('D-G03'));
  assert.equal(pair.leaves[1].x0 - pair.leaves[0].x1, 3); // meeting gap
});

test('handing: LH hinges left from outside, reverse elevation mirrors it', () => {
  const p = doorParams(door('D-G01'));
  assert.equal(p.leaves[0].hinge, 'left');
  assert.equal(doorParams(door('D-G02')).leaves[0].hinge, 'right');
  const front = bbox(elevationView(door('D-G01'), 'front').entities.filter((e) => e.layer === 'A-HDWR'));
  const back = bbox(elevationView(door('D-G01'), 'back').entities.filter((e) => e.layer === 'A-HDWR'));
  assert.ok(front.x0 < 100 && back.x1 > 900);
});

test('every configuration produces views without NaN', () => {
  const configs: Door['configuration'][] = ['single', 'double-equal', 'double-unequal', 'double-action-single', 'double-action-pair', 'pivot', 'sliding-single', 'sliding-double', 'pocket'];
  for (const configuration of configs) {
    const d = { ...door('D-G01'), configuration, leafWidth2: 914 };
    for (const v of doorViews(d)) {
      const b = bbox(v.entities);
      assert.ok([b.x0, b.y0, b.x1, b.y1].every(Number.isFinite), `${configuration} ${v.key}`);
    }
    const s = composeSheet(P, d, { size: 'A3' });
    assert.ok(!JSON.stringify(s.entities).includes('null'), `${configuration} has no null coordinates`);
  }
});

test('frame sections are omitted when frame data is missing', () => {
  const d = { ...door('D-G01'), frameWidth: null };
  const keys = doorViews(d).map((v) => v.key);
  assert.ok(!keys.includes('head') && !keys.includes('jamb'));
});

test('detail views are scaled in model space while dimension values stay true', () => {
  const s = composeSheet(P, door('D-G01'), { size: 'A3' });
  assert.equal(s.S, 20);
  assert.equal(s.detailScale, 10);
  const leafT = dims(s.entities).filter((x) => x.value === 45);
  assert.ok(leafT.length >= 2);
  const g = dimGeometry(leafT[0]);
  assert.equal(g.text, '45');
});

test('dimension geometry: horizontal dim spans the measured points', () => {
  const [d] = dims(place([{ t: 'dim', layer: 'A-DIMS', a: [0, 0], b: [914, 0], dir: 'h', off: -8, h: 2.5, value: 914 }], 1, 20, 0, 0));
  const g = dimGeometry(d);
  const dimLine = g.lines[2];
  assert.equal(dimLine[0][1], -160);
  assert.ok(dimLine[0][0] < 0 && dimLine[1][0] > 914);
});

// ---------- DXF ----------

test('DXF is well formed R12 with layers, linetypes and real DIMENSION entities', () => {
  const s = composeSheet(P, door('D-G03'), { size: 'A3' });
  const text = toDxf(s.entities, { ltscale: s.S });
  const pairs = parsePairs(text);
  assert.equal(pairs[pairs.length - 1].value, 'EOF');
  assert.ok(text.includes('\nAC1009\n'));
  const st = dxfStats(text);
  for (const l of ['A-DOOR', 'A-FRAME', 'A-DIMS', 'A-HIDDEN', 'A-SWING']) assert.ok(st.layers.includes(l), l);
  assert.equal(st.dimensions, dims(s.entities).length);
  assert.ok(st.entities['LINE'] > 50 && st.entities['POLYLINE'] > 10 && st.entities['TEXT'] > 20 && st.entities['ARC'] >= 2);
  // every DIMENSION references a defined block
  const blocks = new Set<string>();
  const refs: string[] = [];
  let section = '';
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value === 'SECTION') section = pairs[i + 1].value;
    if (section === 'BLOCKS' && pairs[i].code === 0 && pairs[i].value === 'BLOCK') blocks.add(pairs.slice(i, i + 6).find((x) => x.code === 2)!.value);
    if (section === 'ENTITIES' && pairs[i].code === 0 && pairs[i].value === 'DIMENSION') refs.push(pairs.slice(i, i + 4).find((x) => x.code === 2)!.value);
  }
  assert.equal(refs.length, blocks.size);
  assert.ok(refs.every((r) => blocks.has(r)));
  // balanced POLYLINE / SEQEND and every entity on a declared layer
  assert.equal(pairs.filter((x) => x.code === 0 && x.value === 'POLYLINE').length, pairs.filter((x) => x.code === 0 && x.value === 'SEQEND').length);
  const declared = new Set(['0', ...st.layers]);
  assert.ok(pairs.filter((x) => x.code === 8).every((x) => declared.has(x.value)));
  // numeric group codes parse as numbers
  assert.ok(pairs.filter((x) => x.code >= 10 && x.code < 60).every((x) => Number.isFinite(Number(x.value))));
});

test('DXF text is ASCII-safe and dimension text is the measured value', () => {
  const d = { ...door('D-G01'), remarks: 'Café door – check' };
  const s = composeSheet(P, d, { size: 'A3' });
  const text = toDxf(s.entities, { ltscale: s.S });
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text));
  const pairs = parsePairs(text);
  const dimTexts: string[] = [];
  for (let i = 0; i < pairs.length; i++) if (pairs[i].value === 'DIMENSION' && pairs[i].code === 0) dimTexts.push(pairs.slice(i, i + 20).find((x) => x.code === 1)!.value);
  assert.ok(dimTexts.includes('914') && dimTexts.includes('2200'));
});

test('set DXF places several sheets side by side', () => {
  const sheets = P.doors.slice(0, 3).map((d) => composeSheet(P, d, { size: 'A3' }));
  const es = composeSet(sheets);
  const b = bbox(es);
  assert.ok(b.x1 - b.x0 > 420 * 20 * 2.5);
  assert.ok(dxfStats(toDxf(es, { ltscale: 25 })).dimensions > 90);
});

test('SVG preview renders the same entities', () => {
  const s = composeSheet(P, door('D-G01'), { size: 'A3' });
  const svg = toSvg(s.entities, { width: 420 * s.S, height: 297 * s.S, S: s.S, paperMm: [420, 297] });
  assert.ok(svg.startsWith('<svg') && svg.includes('width="420mm"'));
  assert.ok(svg.includes('data-layer="A-DOOR"') && svg.includes('stroke-dasharray'));
});

// ---------- exports and persistence ----------

test('CRC32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP and XLSX are readable by independent tools', () => {
  mkdirSync('build/test-out', { recursive: true });
  const z = zip([{ name: 'a/b.txt', data: 'hello' }, { name: 'c.dxf', data: toDxf(composeSheet(P, door('D-G01'), { size: 'A3' }).entities) }]);
  writeFileSync('build/test-out/t.zip', z);
  const x = xlsx([doorSchedule(P, P.doors), quantitySummary(P, P.doors)]);
  writeFileSync('build/test-out/t.xlsx', x);
  let tool = true;
  try { execFileSync('unzip', ['-v'], { encoding: 'utf8' }); } catch { tool = false; }
  if (tool) {
    assert.match(execFileSync('unzip', ['-t', 'build/test-out/t.zip'], { encoding: 'utf8' }), /No errors detected/);
    assert.match(execFileSync('unzip', ['-t', 'build/test-out/t.xlsx'], { encoding: 'utf8' }), /No errors detected/);
    const sheet = execFileSync('unzip', ['-p', 'build/test-out/t.xlsx', 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
    assert.ok(sheet.includes('D-G03') && sheet.includes('<v>1500</v>'));
  }
});

test('CSV escapes commas, quotes and newlines', () => {
  const csv = toCsv({ name: 't', columns: ['a', 'b'], rows: [['x,y', 'say "hi"\nnow']] });
  assert.ok(csv.includes('"x,y","say ""hi""\nnow"'));
});

test('patchDoor records change history per field', () => {
  const p2 = patchDoor(P, door('D-G01').id, { leafWidth1: 920, room: 'Office 001' }, '2026-01-01T00:00:00Z');
  const d = p2.doors.find((x) => x.mark === 'D-G01')!;
  assert.deepEqual(d.history, [{ at: '2026-01-01T00:00:00Z', field: 'leafWidth1', from: '914', to: '920' }]);
});

test('JSON backup round trip and migration of missing fields', () => {
  const back = importProject(exportProject(P));
  assert.deepEqual(back, P);
  const old = JSON.parse(exportProject(P));
  delete old.project.doors[0].pivotOffset;
  delete old.project.hardwareSets;
  const m = importProject(JSON.stringify(old));
  assert.equal(m.doors[0].pivotOffset, null);
  assert.deepEqual(m.hardwareSets, []);
  assert.throws(() => importProject('{"foo":1}'));
  assert.throws(() => importProject('not json'));
});

test('a floor with doors cannot be removed', () => {
  assert.throws(() => removeFloor(P, 'flr_g'));
});
