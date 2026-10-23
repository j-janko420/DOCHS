import type { CatalogueItem, Door, HardwareCategory, HardwareItem, HardwareSet, Project } from './types.js';
import { HARDWARE_CATEGORIES, leafCount } from './types.js';
import { isRated } from './classify.js';
import { uid } from './defaults.js';
import type { Issue, Severity } from './validate.js';

// Hardware library logic: catalogue lookup, quantity rules with door-level
// overrides, hardware QA rules and catalogue CSV import/export.

const DATA = 'DOCHS data completeness rule';
const LIB = 'Project hardware library';
const SPEC = 'Confirm against approved project specification / jurisdiction';

export function catalogueItem(p: Project, it: HardwareItem): CatalogueItem | undefined {
  return it.catalogueId ? p.catalogue.find((c) => c.id === it.catalogueId) : undefined;
}

export function itemLabel(p: Project, it: HardwareItem): string {
  return catalogueItem(p, it)?.description || it.item || '(unnamed item)';
}

export function itemSource(p: Project, it: HardwareItem): { manufacturer: string; model: string; finish: string; category: string; verified: boolean } {
  const c = catalogueItem(p, it);
  if (c) return { manufacturer: c.manufacturer, model: c.model, finish: c.finish, category: HARDWARE_CATEGORIES[c.category], verified: c.verified };
  return { manufacturer: it.manufacturer, model: it.model, finish: it.finish, category: '', verified: false };
}

export function setFor(p: Project, d: Door): HardwareSet | undefined {
  const code = d.hardwareSet.trim();
  return code ? p.hardwareSets.find((s) => s.code === code) : undefined;
}

export interface DoorItemQty {
  qty: number;
  basis: string;
  overridden: boolean;
}

// Rule: per-door items = qty x door qty; per-leaf items = qty x door qty x leaves.
// A door-level override replaces the computed total and records why.
export function doorItemQty(d: Door, it: HardwareItem): DoorItemQty {
  const q = d.quantity ?? 0;
  const leaves = d.configuration ? leafCount(d.configuration) : 1;
  const ov = d.hardwareOverrides.find((o) => o.itemId === it.id);
  const computed = it.basis === 'per-leaf' ? it.qty * q * leaves : it.qty * q;
  const calc = it.basis === 'per-leaf' ? `${it.qty}x${q}x${leaves}L` : `${it.qty}x${q}`;
  if (ov) return { qty: ov.qty, basis: `${d.mark}: override ${ov.qty} (was ${computed}: ${calc}) - ${ov.reason || 'NO REASON'}`, overridden: true };
  return { qty: computed, basis: `${d.mark}: ${calc}`, overridden: false };
}

export interface SetLine {
  set: string;
  itemId: string;
  catalogueId: string;
  item: string;
  category: string;
  manufacturer: string;
  model: string;
  finish: string;
  verified: boolean;
  quantity: number;
  basis: string;
  doors: string[];
}

export interface ProductLine {
  key: string;
  item: string;
  category: string;
  manufacturer: string;
  model: string;
  finish: string;
  verified: boolean;
  quantity: number;
  sets: string[];
}

export function takeoff(p: Project, doors: Door[]): { lines: SetLine[]; products: ProductLine[]; unresolved: string[] } {
  const lines: SetLine[] = [];
  const unresolved: string[] = [];
  const bySet = new Map<string, Door[]>();
  for (const d of doors) {
    const k = d.hardwareSet.trim();
    if (!k) { unresolved.push(`${d.mark}: no hardware set`); continue; }
    if (!p.hardwareSets.some((h) => h.code === k)) { unresolved.push(`${d.mark}: set ${k} not in library`); continue; }
    bySet.set(k, [...(bySet.get(k) ?? []), d]);
  }
  for (const [code, ds] of bySet) {
    const set = p.hardwareSets.find((h) => h.code === code)!;
    for (const it of set.items) {
      const per = ds.map((d) => doorItemQty(d, it));
      const src = itemSource(p, it);
      lines.push({
        set: code, itemId: it.id, catalogueId: it.catalogueId, item: itemLabel(p, it), ...src,
        quantity: per.reduce((s, x) => s + x.qty, 0),
        basis: `${it.qty} ${it.basis} | ${per.map((x) => x.basis).join(', ')}`,
        doors: ds.map((d) => d.mark),
      });
    }
  }
  const products = new Map<string, ProductLine>();
  for (const l of lines) {
    const key = l.catalogueId || `free:${l.item.toLowerCase()}|${l.manufacturer}|${l.model}`;
    const cur = products.get(key);
    if (cur) { cur.quantity += l.quantity; if (!cur.sets.includes(l.set)) cur.sets.push(l.set); }
    else products.set(key, { key, item: l.item, category: l.category, manufacturer: l.manufacturer, model: l.model, finish: l.finish, verified: l.verified, quantity: l.quantity, sets: [l.set] });
  }
  return { lines, products: [...products.values()].sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item)), unresolved };
}

// ---------- QA ----------

function issue(ruleId: string, severity: Severity, doorId: string, mark: string, field: string, message: string, check: string, source: string, action: string): Issue {
  return { ruleId, severity, doorId, mark, field, message, check, source, action };
}

export function validateHardwareSet(s: HardwareSet, p: Project): Issue[] {
  const out: Issue[] = [];
  const add = (ruleId: string, severity: Severity, message: string, check: string, source: string, action: string) =>
    out.push(issue(ruleId, severity, '', s.code || '(no code)', 'hardwareSet', message, check, source, action));
  if (!s.code.trim()) add('E-HWS-01', 'error', 'Hardware set has no code', 'code is blank', DATA, 'Enter the set code from the hardware schedule');
  else if (p.hardwareSets.filter((x) => x.code.trim() === s.code.trim()).length > 1)
    add('E-HWS-02', 'error', `Duplicate set code ${s.code}`, 'code appears more than once', DATA, 'Give each hardware set a unique code');
  if (!s.items.length) add('W-HWS-03', 'warning', 'Hardware set has no items', 'items = 0', DATA, 'Add the set items from the hardware schedule');
  const linked = s.items.filter((it) => it.catalogueId);
  const ids = linked.map((it) => it.catalogueId);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  for (const id of dups) {
    const c = p.catalogue.find((x) => x.id === id);
    add('W-HWS-04', 'warning', `Product listed twice: ${c?.description ?? id}`, 'same catalogue item on two set lines', LIB, 'Combine into one line with the total quantity');
  }
  for (const it of linked) if (!p.catalogue.some((c) => c.id === it.catalogueId))
    add('W-HWS-05', 'warning', `Set line "${it.item}" links to a product that is no longer in the catalogue`, `catalogueId ${it.catalogueId} not found`, LIB, 'Relink the line to a catalogue product');
  for (const it of s.items) if (!(it.qty > 0)) add('W-HWS-06', 'warning', `"${itemLabel(p, it)}" has quantity ${it.qty}`, 'qty > 0', DATA, 'Enter the quantity');
  for (const r of p.incompatibilities) {
    if (ids.includes(r.a) && ids.includes(r.b)) {
      const a = p.catalogue.find((c) => c.id === r.a), b = p.catalogue.find((c) => c.id === r.b);
      add('W-HWS-07', 'warning', `Incompatible: ${a?.description ?? r.a} + ${b?.description ?? r.b}`, r.reason || 'incompatibility rule', r.source || LIB, 'Replace one of the products or confirm with the hardware consultant');
    }
  }
  const free = s.items.filter((it) => !it.catalogueId).length;
  if (free) add('I-HWS-08', 'info', `${free} line(s) not linked to the catalogue`, 'catalogueId is blank', LIB, 'Link lines to catalogue products so product data and checks apply');
  const unverified = linked.filter((it) => p.catalogue.find((c) => c.id === it.catalogueId)?.verified === false).length;
  if (unverified) add('I-HWS-09', 'info', `${unverified} product(s) not verified against a manufacturer source`, 'catalogue verified = no', LIB, 'Enter manufacturer data with its source reference and mark it verified');
  return out;
}

const has = (p: Project, s: HardwareSet, cat: HardwareCategory) => s.items.some((it) => catalogueItem(p, it)?.category === cat);

export function validateDoorHardware(d: Door, p: Project): Issue[] {
  const out: Issue[] = [];
  const mark = d.mark || '(no mark)';
  const add = (ruleId: string, severity: Severity, field: string, message: string, check: string, source: string, action: string) =>
    out.push(issue(ruleId, severity, d.id, mark, field, message, check, source, action));
  const s = setFor(p, d);
  for (const o of d.hardwareOverrides) {
    if (!o.reason.trim()) add('E-HW-07', 'error', 'hardwareOverrides', 'Quantity override without a recorded reason', `override ${o.qty}`, DATA, 'Record why the quantity differs from the set rule');
    if (!s || !s.items.some((it) => it.id === o.itemId)) add('W-HW-08', 'warning', 'hardwareOverrides', 'Override refers to an item that is not in the assigned set', `itemId ${o.itemId}`, DATA, 'Remove the override or reassign the set');
  }
  if (!s) return out;
  const items = s.items.map((it) => ({ it, c: catalogueItem(p, it) }));
  if (isRated(d.fireRating)) {
    const no = items.filter((x) => x.c?.fireRated === 'no');
    if (no.length) add('W-HW-09', 'warning', 'hardwareSet', `Fire-rated door uses product(s) stated as not fire-rated: ${no.map((x) => x.c!.description).join(', ')}`, `door ${d.fireRating}; catalogue fireRated = no`, SPEC, 'Replace with fire-rated products or confirm with the fire consultant');
    const unknown = items.filter((x) => !x.c || x.c.fireRated === '').length;
    if (unknown) add('I-HW-10', 'info', 'hardwareSet', `Fire rating not stated for ${unknown} set item(s)`, 'catalogue fireRated blank or item not linked', SPEC, 'Record the fire test evidence for each product');
  }
  const ac = has(p, s, 'access-control');
  if (d.accessControl && !ac) add('W-HW-11', 'warning', 'accessControl', 'Access-controlled door, but its set has no access-control product', `set ${s.code}`, DATA, 'Resolve the access-control interface with the security consultant');
  if (!d.accessControl && ac) add('W-HW-12', 'warning', 'accessControl', 'Set contains access-control products, but the door is not marked access-controlled', `set ${s.code}`, DATA, 'Confirm the door access-control status');
  const powered = items.filter((x) => x.c?.powered);
  if (powered.length) add('I-HW-13', 'info', 'hardwareSet', `Electrical coordination needed: ${powered.map((x) => x.c!.description).join(', ')}`, 'powered products in set', SPEC, 'Confirm power, cabling and frame / leaf preparation with the electrical and security consultants');
  if (d.configuration && leafCount(d.configuration) === 2 && !d.configuration.startsWith('sliding') && !has(p, s, 'flush-bolt') && !has(p, s, 'coordinator') && !has(p, s, 'panic'))
    add('I-HW-14', 'info', 'hardwareSet', 'Pair door: set has no flush bolt, coordinator or exit device for the inactive leaf', `set ${s.code}`, SPEC, 'Confirm inactive-leaf hardware with the hardware consultant');
  return out;
}

export function setsInScope(p: Project, doors: Door[]): HardwareSet[] {
  const codes = new Set(doors.map((d) => d.hardwareSet.trim()).filter(Boolean));
  return p.hardwareSets.filter((s) => codes.has(s.code.trim()));
}

// ---------- catalogue CSV ----------

export const CATALOGUE_COLUMNS = ['category', 'manufacturer', 'model', 'description', 'finish', 'dimensions', 'mounting', 'fireRated', 'powered', 'sourceRef', 'verified', 'notes'] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());

function toCategory(v: string): HardwareCategory | null {
  const k = v.trim().toLowerCase();
  const byKey = (Object.keys(HARDWARE_CATEGORIES) as HardwareCategory[]).find((c) => c === k);
  if (byKey) return byKey;
  const byLabel = (Object.entries(HARDWARE_CATEGORIES) as [HardwareCategory, string][]).find(([, l]) => l.toLowerCase() === k);
  return byLabel ? byLabel[0] : null;
}

// Imports rows into catalogue items. Rows without a description or with an
// unknown category are reported, not guessed.
export function catalogueFromCsv(text: string): { items: CatalogueItem[]; errors: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], errors: ['File is empty'] };
  const head = rows[0].map((h) => h.trim());
  const idx = (k: string) => head.findIndex((h) => h.toLowerCase() === k.toLowerCase());
  const missing = ['category', 'description'].filter((k) => idx(k) < 0);
  if (missing.length) return { items: [], errors: [`Missing column(s): ${missing.join(', ')}. Expected: ${CATALOGUE_COLUMNS.join(', ')}`] };
  const items: CatalogueItem[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
    const category = toCategory(get('category'));
    if (!category) { errors.push(`Row ${i + 2}: unknown category "${get('category')}"`); return; }
    if (!get('description')) { errors.push(`Row ${i + 2}: description is blank`); return; }
    const fr = get('fireRated').toLowerCase();
    items.push({
      id: uid('cat'), category, manufacturer: get('manufacturer'), model: get('model'), description: get('description'), finish: get('finish'),
      dimensions: get('dimensions'), mounting: get('mounting'), fireRated: fr ? (yes(fr) ? 'yes' : /^(n|no|false|0)$/.test(fr) ? 'no' : '') : '',
      powered: yes(get('powered')), sourceRef: get('sourceRef'), verified: yes(get('verified')), notes: get('notes'),
    });
  });
  return { items, errors };
}

export function catalogueTable(items: CatalogueItem[]) {
  return {
    name: 'Hardware Catalogue',
    columns: [...CATALOGUE_COLUMNS],
    rows: items.map((c) => [c.category, c.manufacturer, c.model, c.description, c.finish, c.dimensions, c.mounting, c.fireRated, c.powered ? 'yes' : 'no', c.sourceRef, c.verified ? 'yes' : 'no', c.notes]),
  };
}
