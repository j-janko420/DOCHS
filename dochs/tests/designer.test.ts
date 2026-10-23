import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankProject, sampleProject } from '../src/core/defaults.js';
import { addDesignedDoor, applyStyle, defaultDesign, designDoor, hardwareLines, withPerformance } from '../src/core/designer.js';
import { DOOR_STYLES, HARDWARE_FUNCTIONS, HARDWARE_TYPES, REFERENCE_MATERIALS, installReference } from '../src/core/reference.js';
import { frameFit } from '../src/core/geometry.js';
import { validateDoor } from '../src/core/validate.js';
import { composeSheet } from '../src/cad/sheet.js';
import { dxfStats, toDxf } from '../src/cad/dxf.js';

const P = sampleProject();
const opts = (mark: string) => ({ mark, buildingId: P.floors[1].buildingId, floorId: P.floors[1].id, room: 'Test', quantity: 1 });

test('reference data is consistent: style materials and function lines exist', () => {
  for (const s of DOOR_STYLES) {
    for (const [kind, name] of [['leaf', s.leaf], ['core', s.core], ['facing', s.facing], ['finish', s.finish], ['frame', s.frame], ['finish', s.frameFinish]] as const)
      assert.ok(REFERENCE_MATERIALS.some((m) => m.kind === kind && m.name === name), `${s.key}: ${kind} ${name}`);
  }
  for (const f of HARDWARE_FUNCTIONS) for (const l of f.lines) assert.ok(HARDWARE_TYPES.some((t) => t.name === l.type), `${f.key}: ${l.type}`);
  assert.equal(new Set(HARDWARE_TYPES.map((t) => t.name)).size, HARDWARE_TYPES.length);
});

test('every style, configuration and performance gives a valid, drawable door', () => {
  let n = 0;
  for (const s of DOOR_STYLES) for (const c of s.configurations) for (const perf of s.performance) {
    let i = applyStyle({ ...defaultDesign(), soWidth: c.includes('double') || c === 'sliding-double' ? 1800 : 1000, soHeight: 2400 }, s.key);
    i = withPerformance({ ...i, configuration: c, hardwareFunction: c.startsWith('sliding') || c === 'pocket' ? 'sliding' : i.hardwareFunction }, perf);
    const r = designDoor(i);
    assert.deepEqual(r.errors, [], `${s.key} ${c} ${perf}`);
    const res = addDesignedDoor(P, i, opts(`T-${++n}`));
    const issues = validateDoor(res.door, res.project);
    const errors = issues.filter((x) => x.severity === 'error').map((x) => x.ruleId);
    assert.deepEqual(errors, [], `${s.key} ${c} ${perf}: ${errors}`);
    // computed leaves fit the frame exactly (no fit warnings)
    assert.ok(!issues.some((x) => x.ruleId === 'W-DIM-10' || x.ruleId === 'W-DIM-11'), `${s.key} ${c} fit`);
    const sheet = composeSheet(res.project, res.door, { size: 'A3' });
    assert.ok(dxfStats(toDxf(sheet.entities, { ltscale: sheet.S })).dimensions > 10);
  }
  assert.ok(n > 40);
});

test('leaf sizes from the opening: single, equal pair, unequal pair, sliding', () => {
  const base = defaultDesign(); // 1000 x 2200, gap 5, frame 50, rebate 15, edge 3, undercut 8
  const r1 = designDoor(base);
  assert.deepEqual(r1.leaves, [914]);
  assert.equal(r1.leafHeight, 2149);
  assert.equal(r1.leaves[0], frameFit(r1.door).expectedLeafTotal);
  const pair = designDoor({ ...base, soWidth: 1800, configuration: 'double-equal' });
  assert.deepEqual(pair.leaves, [855, 855]);
  const uneq = designDoor({ ...base, soWidth: 1500, configuration: 'double-unequal', unequalRatio: 0.65 });
  assert.equal(uneq.leaves[0] + uneq.leaves[1], 1411);
  const sl = designDoor({ ...applyStyle(base, 'sliding'), configuration: 'sliding-single' });
  assert.deepEqual(sl.leaves, [990]); // aperture 890 + 2 x 50 overlap
  assert.ok(designDoor({ ...base, soWidth: 300 }).errors.length > 0);
});

test('fire / acoustic choices set core, glass, thickness, seals and hardware', () => {
  let i = withPerformance({ ...defaultDesign(), vision: 'standard', glazingType: 'Clear toughened glass' }, 'fr');
  assert.equal(i.core, 'Fire-resisting mineral core');
  assert.equal(i.glazingType, 'Fire-resisting glass');
  assert.equal(i.leafThickness, 54);
  assert.equal(i.hardwareFunction, 'fire-closer');
  assert.ok(designDoor(i).door.smokeSeal);
  i = withPerformance(defaultDesign(), 'acoustic');
  assert.ok(hardwareLines(i).some((l) => l.type === 'Automatic drop seal'));
  assert.equal(designDoor(i).door.acousticRating, '35 dB');
  // back to non-FR restores the style core
  assert.equal(withPerformance(withPerformance(defaultDesign(), 'fr'), 'non-fr').core, 'Particleboard core');
});

test('adding a door links materials, creates or reuses a hardware set, and records assumptions', () => {
  const p0 = blankProject('Designer test');
  const i = defaultDesign();
  const a = addDesignedDoor(p0, i, { mark: 'X-1', buildingId: p0.buildings[0].id, floorId: p0.floors[0].id, room: '', quantity: 2 });
  const d = a.door;
  assert.equal(d.status, 'draft');
  assert.match(d.remarks, /starting assumptions/);
  assert.equal(Object.keys(d.materialIds).length, 7);
  assert.ok(a.project.materials.every((m) => !m.verified));
  assert.equal(d.hardwareSet, 'DD-01');
  const b = addDesignedDoor(a.project, i, { mark: 'X-2', buildingId: p0.buildings[0].id, floorId: p0.floors[0].id, room: '', quantity: 1 });
  assert.equal(b.door.hardwareSet, 'DD-01'); // identical set reused
  assert.equal(b.project.materials.length, a.project.materials.length); // no duplicate library items
  const c = addDesignedDoor(b.project, { ...i, hardwareFunction: 'privacy' }, { mark: 'X-3', buildingId: p0.buildings[0].id, floorId: p0.floors[0].id, room: '', quantity: 1 });
  assert.equal(c.door.hardwareSet, 'DD-02');
  assert.throws(() => addDesignedDoor(c.project, i, { mark: 'x-1', buildingId: p0.buildings[0].id, floorId: p0.floors[0].id, room: '', quantity: 1 }), /already exists/);
  assert.throws(() => addDesignedDoor(c.project, i, { mark: ' ', buildingId: '', floorId: '', room: '', quantity: 1 }), /mark/);
});

test('reference library installs once, without duplicates', () => {
  const r = installReference(P, { hardware: true, materials: true });
  assert.ok(r.added > 80);
  assert.equal(installReference(r.project, { hardware: true, materials: true }).added, 0);
  assert.ok(r.project.catalogue.filter((c) => c.notes.startsWith('DOCHS reference type')).every((c) => !c.verified && !c.manufacturer));
});
