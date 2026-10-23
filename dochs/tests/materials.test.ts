import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleProject } from '../src/core/defaults.js';
import type { Door, Project } from '../src/core/types.js';
import { autoLink, linkPatch, materialFor, materialSchedule, materialTable, materialsFromCsv, validateDoorMaterials, validateMaterialLibrary } from '../src/core/materials.js';
import { toCsv } from '../src/core/export.js';
import { validateProject } from '../src/core/validate.js';
import { exportProject, importProject } from '../src/core/project-ops.js';

const P = sampleProject();
const door = (p: Project, mark: string): Door => p.doors.find((d) => d.mark === mark)!;
const ids = (xs: { ruleId: string }[]) => xs.map((x) => x.ruleId);
const withDoor = (p: Project, mark: string, patch: Partial<Door>): Project => ({ ...p, doors: p.doors.map((d) => (d.mark === mark ? { ...d, ...patch } : d)) });
const withMat = (p: Project, id: string, patch: object): Project => ({ ...p, materials: p.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

test('sample door fields are linked to the library by exact name, by kind', () => {
  const d = door(P, 'D-B01');
  assert.equal(materialFor(P, d, 'leaf')?.id, 'mat_steel_leaf');
  assert.equal(materialFor(P, d, 'frame')?.id, 'mat_steel_frame'); // same name, different kind
  assert.equal(materialFor(P, door(P, 'D-G01'), 'glazing')?.name, 'Clear toughened glass');
  assert.equal(door(P, 'D-G03').materialIds.core, undefined); // blank core stays unlinked
  assert.deepEqual(validateProject(P).filter((i) => i.severity === 'error'), []);
});

test('autoLink never links on partial or ambiguous matches', () => {
  const p1 = withDoor({ ...P, doors: P.doors.map((d) => ({ ...d, materialIds: {} })) }, 'D-G01', { finishSide1: 'Natural oak veneer' });
  const r = autoLink(p1);
  assert.equal(door(r.project, 'D-G01').materialIds.finish1, undefined);
  assert.equal(door(r.project, 'D-G01').materialIds.finish2, 'mat_oak');
  const dup = { ...p1, materials: [...p1.materials, { ...p1.materials.find((m) => m.id === 'mat_paint')!, id: 'mat_paint2' }] };
  const r2 = autoLink(dup);
  assert.equal(door(r2.project, 'D-B01').materialIds.finish1, undefined);
  assert.ok(ids(validateMaterialLibrary(dup)).includes('W-MLIB-01'));
});

test('linkPatch copies the library name and can unlink', () => {
  const d = door(P, 'D-G01');
  const oak = P.materials.find((m) => m.id === 'mat_paint')!;
  const patch = linkPatch(d, 'finish1', oak);
  assert.equal(patch.finishSide1, 'Paint');
  assert.equal(patch.materialIds!.finish1, 'mat_paint');
  assert.equal(linkPatch(d, 'finish1', null).materialIds!.finish1, undefined);
});

test('fire, thickness, glazing and submittal checks', () => {
  const p1 = withMat(P, 'mat_mineral', { fireRated: 'no' });
  assert.ok(ids(validateDoorMaterials(door(p1, 'D-B01'), p1)).includes('W-MAT-05'));
  assert.ok(ids(validateDoorMaterials(door(P, 'D-B01'), P)).includes('I-MAT-06'));
  const p2 = withMat(P, 'mat_timber', { thickness: 54 });
  const w = validateDoorMaterials(door(p2, 'D-G01'), p2).find((i) => i.ruleId === 'W-MAT-07')!;
  assert.match(w.message, /45.*54/);
  const p3 = withDoor(P, 'D-G01', { glazingType: '' });
  assert.ok(ids(validateDoorMaterials(door(p3, 'D-G01'), p3)).includes('W-MAT-08'));
  const p4 = withMat(P, 'mat_oak', { approval: 'rejected' });
  assert.ok(ids(validateDoorMaterials(door(p4, 'D-G02'), p4)).includes('W-MAT-10'));
  // approved door with materials not yet approved
  assert.ok(ids(validateDoorMaterials(door(P, 'D-G01'), P)).includes('W-MAT-11'));
  const allOk = { ...P, materials: P.materials.map((m) => ({ ...m, approval: 'approved' as const })) };
  assert.ok(!ids(validateDoorMaterials(door(allOk, 'D-G01'), allOk)).includes('W-MAT-11'));
  // missing link target and unlinked text
  const p5 = withDoor(P, 'D-G01', { materialIds: { ...door(P, 'D-G01').materialIds, core: 'gone' } });
  assert.ok(ids(validateDoorMaterials(door(p5, 'D-G01'), p5)).includes('W-MAT-04'));
  const p6 = withDoor(P, 'D-G01', { materialIds: {} });
  assert.ok(ids(validateDoorMaterials(door(p6, 'D-G01'), p6)).includes('I-MAT-03'));
});

test('material schedule totals door qty and finish faces', () => {
  const t = materialSchedule(P, P.doors);
  const col = (n: string) => t.columns.indexOf(n);
  const oak = t.rows.find((r) => r[col('Name')] === 'Natural oak')!;
  // D-G01 (1 leaf, qty1), D-G02 (qty2), D-G03 not oak, D-102 (1), D-201 (1), D-101 (1): both faces
  const oakDoors = P.doors.filter((d) => d.finishSide1 === 'Natural oak');
  const q = oakDoors.reduce((s, d) => s + (d.quantity ?? 0), 0);
  assert.equal(oak[col('Door qty')], q);
  assert.equal(oak[col('Leaf faces (finishes)')], 2 * q);
  const steel = t.rows.filter((r) => r[col('Name')] === 'Steel');
  assert.equal(steel.length, 2); // leaf and frame are separate rows
  const pf = withDoor(P, 'D-G01', { leafCore: 'Honeycomb', materialIds: {} });
  const free = materialSchedule(pf, [door(pf, 'D-G01')]);
  assert.ok(free.rows.some((r) => r[1] === 'Honeycomb' && r[6] === 'NOT IN LIBRARY'));
});

test('material CSV round trip and row errors', () => {
  const back = materialsFromCsv(toCsv(materialTable(P.materials)));
  assert.equal(back.errors.length, 0);
  assert.equal(back.items.length, P.materials.length);
  const r = materialsFromCsv('kind,name,thickness,approval,fireRated,verified\nLeaf material / system,Fire leaf 54,54,Approved as noted,yes,yes\ncore,X,abc,,,\nwood,Y,,,,\nfinish,Z,,maybe,,\n');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'leaf');
  assert.equal(r.items[0].thickness, 54);
  assert.equal(r.items[0].approval, 'approved-as-noted');
  assert.equal(r.errors.length, 3);
});

test('older backups migrate with an empty library and no links', () => {
  const old = JSON.parse(exportProject(P));
  delete old.project.materials;
  for (const d of old.project.doors) { delete d.materialIds; delete d.glazingType; }
  const m = importProject(JSON.stringify(old));
  assert.deepEqual(m.materials, []);
  assert.deepEqual(m.doors[0].materialIds, {});
  assert.equal(m.doors[0].glazingType, '');
});
