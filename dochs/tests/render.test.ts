import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankDoor, blankProject } from '../src/core/defaults.js';
import { lookFor, metalFor, renderSpec } from '../src/core/render-spec.js';
import type { Look } from '../src/core/render-spec.js';

const FB: Look = { surface: 'paint', color: '#000000', label: 'fb' };

test('finish text -> surface and colour', () => {
  assert.equal(lookFor('Walnut veneer', FB).surface, 'timber');
  assert.equal(lookFor('Walnut veneer', FB).color, '#6a4630');
  assert.deepEqual([lookFor('Paint RAL 9010', FB).surface, lookFor('Paint RAL 9010', FB).color], ['paint', '#f1ece1']);
  assert.equal(lookFor('White laminate', FB).surface, 'laminate');
  assert.equal(lookFor('Clear glass', FB).surface, 'glass');
  assert.equal(lookFor('Frosted glass', FB).frosted, true);
  assert.equal(lookFor('Brushed stainless steel', FB).surface, 'metal');
  assert.equal(lookFor('Polyester powder coat RAL 7016', FB).color, '#383e42');
  assert.equal(lookFor('Carrara marble', FB).surface, 'stone');
  assert.equal(lookFor('', FB), FB);
});

test('hardware finish codes -> metal look', () => {
  assert.equal(metalFor('US32D'), 'satin');
  assert.equal(metalFor('SSS'), 'satin');
  assert.equal(metalFor('PSS polished'), 'polished');
  assert.equal(metalFor('Matt black'), 'black');
  assert.equal(metalFor('US3 brass'), 'brass');
  assert.equal(metalFor('689'), 'aluminium');
  assert.equal(metalFor('US26D'), 'satin');
});

function door(handing: 'RH' | 'LHR', items: [number, string, string][]) {
  const p = blankProject('R');
  p.hardwareSets = [{ code: 'S1', description: '', items: items.map(([qty, item, finish], i) => ({ id: `i${i}`, catalogueId: '', item, qty, basis: 'per-door' as const, manufacturer: '', model: '', finish })) }];
  const d = blankDoor({ mark: 'D1', configuration: 'single', handing, openingWidth: 1000, openingHeight: 2200, leafWidth1: 880, leafHeight: 2150, leafThickness: 54, hardwareSet: 'S1', finishSide1: 'Oak veneer', finishSide2: 'Paint RAL 9010' });
  p.doors = [d];
  return renderSpec(p, d);
}

test('hardware goes on the right face: push / pull side from handing', () => {
  const s = door('RH', [[3, 'Butt hinge', 'SSS'], [1, 'Overhead closer', 'Silver'], [1, 'Panic bar', 'SSS'], [1, 'Kick plate 900 x 200', 'SSS'], [1, 'Lever handle on rose', 'Matt black'], [1, 'Euro cylinder and thumbturn', 'SCP']]);
  assert.equal(s.pushSide, 'outside');
  assert.equal(s.hingeLeftFromOutside, false);
  const side = (k: string) => s.hardware.filter((h) => h.kind === k).map((h) => h.side);
  assert.deepEqual(side('hinge'), ['inside']);
  assert.deepEqual(side('closer'), ['inside']);
  assert.deepEqual(side('panic'), ['outside']);
  assert.deepEqual(side('kick-plate'), ['outside']);
  assert.deepEqual(side('lever'), ['both']);
  assert.deepEqual(side('cylinder'), ['outside']);
  assert.deepEqual(side('thumbturn'), ['inside']);
  assert.equal(s.hardware.find((h) => h.kind === 'lever')!.metal, 'black');
  assert.equal(s.hardware.find((h) => h.kind === 'kick-plate')!.height, 200);
  assert.deepEqual([s.face.outside.surface, s.face.inside.surface], ['timber', 'paint']);
  assert.deepEqual(s.assumptions, []);
  const r = door('LHR', [[1, 'Overhead closer', 'Silver']]);
  assert.equal(r.pushSide, 'inside');
  assert.deepEqual(r.hardware.filter((h) => h.kind === 'closer').map((h) => h.side), ['outside']);
  assert.ok(r.hardware.some((h) => h.kind === 'lever' && h.label === 'Lever (assumed)'), 'missing trim is shown and labelled as assumed');
});

test('blank opening is derived from the leaf and the assumption is stated', () => {
  const p = blankProject('R');
  const d = blankDoor({ mark: 'D2', configuration: 'single', leafWidth1: 900, leafHeight: 2100 });
  p.doors = [d];
  const s = renderSpec(p, d);
  assert.ok(s.soW > 900 && s.soW < 1100);
  assert.ok(s.assumptions.some((a) => /S\.O\. width blank: \d+ mm from the leaf width/.test(a)));
  assert.ok(s.assumptions.some((a) => /No hardware set/.test(a)));
});
