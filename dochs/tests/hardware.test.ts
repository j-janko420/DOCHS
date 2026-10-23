import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleProject } from '../src/core/defaults.js';
import type { Door, Project } from '../src/core/types.js';
import { catalogueFromCsv, catalogueTable, doorItemQty, parseCsv, takeoff, validateDoorHardware, validateHardwareSet } from '../src/core/hardware.js';
import { toCsv } from '../src/core/export.js';
import { validateDoor, validateProject } from '../src/core/validate.js';
import { exportProject, importProject } from '../src/core/project-ops.js';
import { productTable } from '../src/core/schedule.js';

const P = sampleProject();
const door = (p: Project, mark: string): Door => p.doors.find((d) => d.mark === mark)!;
const set = (p: Project, code: string) => p.hardwareSets.find((s) => s.code === code)!;
const ids = (xs: { ruleId: string }[]) => xs.map((x) => x.ruleId);
const withDoor = (p: Project, mark: string, patch: Partial<Door>): Project => ({ ...p, doors: p.doors.map((d) => (d.mark === mark ? { ...d, ...patch } : d)) });

test('sample sets link every line to a catalogue product, all unverified', () => {
  for (const s of P.hardwareSets) for (const it of s.items) assert.ok(P.catalogue.some((c) => c.id === it.catalogueId), `${s.code} ${it.item}`);
  assert.ok(P.catalogue.every((c) => !c.verified && !c.manufacturer));
  assert.ok(ids(validateHardwareSet(set(P, 'HW-01'), P)).includes('I-HWS-09'));
});

test('sample project still has no hard errors', () => {
  assert.deepEqual(validateProject(P).filter((i) => i.severity === 'error').map((i) => `${i.mark} ${i.ruleId}`), []);
});

test('product takeoff aggregates the same product across sets', () => {
  const hinge = takeoff(P, P.doors).products.find((x) => x.item === 'Butt hinge (generic)')!;
  // HW-01 D-G01 3; HW-02 D-G02 qty2 -> 6; HW-03 D-B01 pair 6 + D-R01 3; HW-04 D-G03 pair 6
  assert.equal(hinge.quantity, 3 + 6 + 9 + 6);
  assert.deepEqual(hinge.sets.sort(), ['HW-01', 'HW-02', 'HW-03', 'HW-04']);
  assert.equal(productTable(P, P.doors).columns.length, 8);
});

test('door override replaces the computed quantity and records the reason', () => {
  const it = set(P, 'HW-01').items[0];
  const d = { ...door(P, 'D-G01'), hardwareOverrides: [{ itemId: it.id, qty: 4, reason: 'Heavy leaf - 4 hinges per consultant', by: 'x', at: '2026-01-01' }] };
  const q = doorItemQty(d, it);
  assert.equal(q.qty, 4);
  assert.ok(q.overridden && /was 3/.test(q.basis) && /consultant/.test(q.basis));
  const p2 = withDoor(P, 'D-G01', { hardwareOverrides: d.hardwareOverrides });
  const hinge01 = takeoff(p2, p2.doors).lines.find((l) => l.set === 'HW-01' && l.itemId === it.id)!;
  assert.equal(hinge01.quantity, 4);
});

test('override without reason is an error; override for a foreign item is a warning', () => {
  const it = set(P, 'HW-01').items[0];
  const p2 = withDoor(P, 'D-G01', { hardwareOverrides: [{ itemId: it.id, qty: 4, reason: ' ', by: '', at: '' }, { itemId: 'nope', qty: 1, reason: 'x', by: '', at: '' }] });
  const r = ids(validateDoor(door(p2, 'D-G01'), p2));
  assert.ok(r.includes('E-HW-07') && r.includes('W-HW-08'));
});

test('duplicate product, missing product, zero quantity and empty set are flagged', () => {
  const s = set(P, 'HW-01');
  const bad = { ...s, items: [...s.items, { ...s.items[0], id: 'dup' }, { ...s.items[1], id: 'gone', catalogueId: 'cat_deleted' }, { ...s.items[2], id: 'zero', qty: 0 }] };
  const r = ids(validateHardwareSet(bad, P));
  for (const k of ['W-HWS-04', 'W-HWS-05', 'W-HWS-06']) assert.ok(r.includes(k), k);
  assert.ok(ids(validateHardwareSet({ code: 'X', description: '', items: [] }, P)).includes('W-HWS-03'));
  const twice = { ...P, hardwareSets: [...P.hardwareSets, { ...s }] };
  assert.ok(ids(validateHardwareSet(s, twice)).includes('E-HWS-02'));
});

test('incompatibility is flagged only when a rule says so, with its source', () => {
  const s = set(P, 'HW-04');
  assert.ok(!ids(validateHardwareSet(s, P)).includes('W-HWS-07'));
  const p2 = { ...P, incompatibilities: [{ id: 'i1', a: 'cat_elock', b: 'cat_flushbolt', reason: 'Lock throw clashes with bolt keep', source: 'RFI-012' }] };
  const w = validateHardwareSet(s, p2).find((i) => i.ruleId === 'W-HWS-07')!;
  assert.equal(w.source, 'RFI-012');
  assert.match(w.check, /bolt keep/);
});

test('fire, access-control, power and pair-door hardware checks', () => {
  // fire door using a product stated as not fire-rated
  const p2 = { ...P, catalogue: P.catalogue.map((c) => (c.id === 'cat_closer' ? { ...c, fireRated: 'no' as const } : c)) };
  assert.ok(ids(validateDoorHardware(door(p2, 'D-B01'), p2)).includes('W-HW-09'));
  assert.ok(ids(validateDoorHardware(door(P, 'D-B01'), P)).includes('I-HW-10'));
  // access-controlled door without access-control products
  const p3 = withDoor(P, 'D-G01', { accessControl: true });
  assert.ok(ids(validateDoorHardware(door(p3, 'D-G01'), p3)).includes('W-HW-11'));
  // set with access-control products on a door not marked access-controlled
  const p4 = withDoor(P, 'D-G01', { hardwareSet: 'HW-04' });
  assert.ok(ids(validateDoorHardware(door(p4, 'D-G01'), p4)).includes('W-HW-12'));
  assert.ok(ids(validateDoorHardware(door(P, 'D-G03'), P)).includes('I-HW-13'));
  // pair door with no inactive-leaf hardware
  const p5 = withDoor(P, 'D-B01', { hardwareSet: 'HW-01' });
  assert.ok(ids(validateDoorHardware(door(p5, 'D-B01'), p5)).includes('I-HW-14'));
});

test('catalogue CSV round trip, with bad rows reported not guessed', () => {
  const csv = toCsv(catalogueTable(P.catalogue));
  const back = catalogueFromCsv(csv);
  assert.equal(back.errors.length, 0);
  assert.equal(back.items.length, P.catalogue.length);
  assert.equal(back.items[0].description, P.catalogue[0].description);
  const r = catalogueFromCsv('category,description,manufacturer,fireRated,verified\nHinge,"Hinge, 4"" ball bearing",Acme,yes,yes\nwidget,Thing,,,\nlock,,,,\n');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].description, 'Hinge, 4" ball bearing');
  assert.equal(r.items[0].fireRated, 'yes');
  assert.ok(r.items[0].verified);
  assert.equal(r.errors.length, 2);
  assert.ok(catalogueFromCsv('a,b\n1,2').errors[0].startsWith('Missing column'));
  assert.deepEqual(parseCsv('a,"b\nc"\r\nd,e'), [['a', 'b\nc'], ['d', 'e']]);
});

test('v0.1 backups migrate: set items get ids, catalogue defaults to empty', () => {
  const old = JSON.parse(exportProject(P));
  for (const s of old.project.hardwareSets) for (const it of s.items) { delete it.id; delete it.catalogueId; }
  delete old.project.catalogue;
  delete old.project.incompatibilities;
  for (const d of old.project.doors) delete d.hardwareOverrides;
  const m = importProject(JSON.stringify(old));
  assert.ok(m.hardwareSets.every((s) => s.items.every((it) => it.id && it.catalogueId === '')));
  assert.deepEqual(m.catalogue, []);
  assert.deepEqual(m.doors[0].hardwareOverrides, []);
  assert.ok(ids(validateHardwareSet(m.hardwareSets[0], m)).includes('I-HWS-08'));
});
