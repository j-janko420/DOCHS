import type { Door, MaterialItem, MaterialKind, MaterialSlot, Project } from './types.js';
import { APPROVAL_LABEL, MATERIAL_KINDS, MATERIAL_SLOTS, leafCount } from './types.js';
import { isRated } from './classify.js';
import { uid } from './defaults.js';
import { parseCsv } from './hardware.js';
import type { Cell, Table } from './schedule.js';
import type { Issue, Severity } from './validate.js';

// Material and finish library: door material fields link to library items so
// schedules, QA and submittal status come from one source.

const DATA = 'DORSCH data completeness rule';
const LIB = 'Project material library';
const SPEC = 'Confirm against approved project specification / jurisdiction';
const APPROVED = new Set(['approved', 'approved-as-noted']);

export function materialFor(p: Project, d: Door, slot: MaterialSlot): MaterialItem | undefined {
  const id = d.materialIds[slot];
  return id ? p.materials.find((m) => m.id === id) : undefined;
}

// Linking copies the library name into the door's text field, so schedules,
// classification and drawings keep reading one value.
export function linkPatch(d: Door, slot: MaterialSlot, item: MaterialItem | null): Partial<Door> {
  const def = MATERIAL_SLOTS.find((s) => s.slot === slot)!;
  const ids = { ...d.materialIds };
  if (item) ids[slot] = item.id; else delete ids[slot];
  return item ? { materialIds: ids, [def.field]: item.name } : { materialIds: ids };
}

// Links unlinked door fields whose text exactly matches a library item of the
// right kind (case-insensitive). Nothing is linked on a partial match.
export function autoLink(p: Project): { project: Project; linked: number } {
  let linked = 0;
  const doors = p.doors.map((d) => {
    let ids = d.materialIds;
    for (const s of MATERIAL_SLOTS) {
      if (ids[s.slot]) continue;
      const text = String(d[s.field] ?? '').trim().toLowerCase();
      if (!text) continue;
      const hits = p.materials.filter((m) => m.kind === s.kind && m.name.trim().toLowerCase() === text);
      if (hits.length === 1) { ids = { ...ids, [s.slot]: hits[0].id }; linked++; }
    }
    return ids === d.materialIds ? d : { ...d, materialIds: ids };
  });
  return { project: { ...p, doors }, linked };
}

// ---------- QA ----------

function issue(ruleId: string, severity: Severity, d: Door | null, field: string, message: string, check: string, source: string, action: string): Issue {
  return { ruleId, severity, doorId: d?.id ?? '', mark: d ? d.mark || '(no mark)' : 'Material library', field, message, check, source, action };
}

const FIRE_SLOTS: MaterialSlot[] = ['leaf', 'core', 'frame', 'glazing'];

export function validateDoorMaterials(d: Door, p: Project): Issue[] {
  const out: Issue[] = [];
  const add = (ruleId: string, severity: Severity, field: string, message: string, check: string, source: string, action: string) => out.push(issue(ruleId, severity, d, field, message, check, source, action));
  const unlinked: string[] = [];
  const linked: { slot: MaterialSlot; label: string; m: MaterialItem }[] = [];
  for (const s of MATERIAL_SLOTS) {
    if (s.slot === 'glazing' && !d.visionPanel) continue;
    const id = d.materialIds[s.slot];
    const m = id ? p.materials.find((x) => x.id === id) : undefined;
    if (id && !m) add('W-MAT-04', 'warning', String(s.field), `${s.label} links to an item that is no longer in the material library`, `materialId ${id} not found`, LIB, 'Relink the field to a library item');
    else if (m) linked.push({ slot: s.slot, label: s.label, m });
    else if (String(d[s.field] ?? '').trim()) unlinked.push(s.label);
  }
  if (unlinked.length) add('I-MAT-03', 'info', 'materialIds', `Not linked to the material library: ${unlinked.join(', ')}`, 'text entered, no library link', LIB, 'Link the fields so source and submittal status apply');
  if (d.visionPanel && !d.glazingType.trim()) add('W-MAT-08', 'warning', 'glazingType', 'Vision panel without a glazing type', 'glazingType is blank', DATA, 'Enter the glazing type from the specification');
  if (isRated(d.fireRating)) {
    const fire = linked.filter((x) => FIRE_SLOTS.includes(x.slot));
    const no = fire.filter((x) => x.m.fireRated === 'no');
    if (no.length) add('W-MAT-05', 'warning', 'fireRating', `Fire-rated door uses material(s) stated as not fire-rated: ${no.map((x) => `${x.label} ${x.m.name}`).join(', ')}`, `door ${d.fireRating}; library fireRated = no`, SPEC, 'Change the material or confirm with the fire consultant');
    const unknown = fire.filter((x) => x.m.fireRated === '');
    if (unknown.length) add('I-MAT-06', 'info', 'fireRating', `Fire rating not stated for: ${unknown.map((x) => x.label).join(', ')}`, 'library fireRated blank', SPEC, 'Record the fire test evidence for each material');
  }
  const leaf = linked.find((x) => x.slot === 'leaf')?.m;
  if (leaf?.thickness != null && d.leafThickness != null && leaf.thickness !== d.leafThickness)
    add('W-MAT-07', 'warning', 'leafThickness', `Leaf thickness ${d.leafThickness} differs from library ${leaf.name} (${leaf.thickness})`, `${d.leafThickness} != ${leaf.thickness}`, LIB, 'Correct the leaf thickness or the leaf system');
  const bad = linked.filter((x) => x.m.approval === 'rejected' || x.m.approval === 'revise-resubmit');
  if (bad.length) add('W-MAT-10', 'warning', 'materialIds', `Submittal not accepted: ${bad.map((x) => `${x.m.name} (${APPROVAL_LABEL[x.m.approval]})`).join(', ')}`, 'library approval status', LIB, 'Resubmit or replace the material before production');
  if (d.status === 'approved') {
    const pending = linked.filter((x) => !APPROVED.has(x.m.approval) && x.m.approval !== 'rejected' && x.m.approval !== 'revise-resubmit');
    if (pending.length) add('W-MAT-11', 'warning', 'status', `Door approved but material submittal(s) not approved: ${pending.map((x) => x.m.name).join(', ')}`, 'door status approved; material approval pending', LIB, 'Obtain material approval or return the door to review');
  }
  return out;
}

export function validateMaterialLibrary(p: Project): Issue[] {
  const out: Issue[] = [];
  const seen = new Map<string, number>();
  for (const m of p.materials) { const k = `${m.kind}|${m.name.trim().toLowerCase()}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  for (const [k, n] of seen) if (n > 1) {
    const [kind, name] = k.split('|');
    out.push(issue('W-MLIB-01', 'warning', null, 'materials', `Duplicate ${MATERIAL_KINDS[kind as MaterialKind].toLowerCase()} "${name}" (${n} entries)`, 'same kind and name', LIB, 'Merge the entries so doors link to one item'));
  }
  for (const m of p.materials) if (!m.name.trim()) out.push(issue('W-MLIB-02', 'warning', null, 'materials', `Unnamed ${MATERIAL_KINDS[m.kind].toLowerCase()} in the library`, 'name is blank', LIB, 'Name the item or remove it'));
  return out;
}

// ---------- schedule ----------

export function materialSchedule(p: Project, doors: Door[]): Table {
  interface Row { kind: string; name: string; m?: MaterialItem; uses: Set<string>; doors: Set<string>; qty: number; faces: number }
  const rows = new Map<string, Row>();
  for (const d of doors) {
    const q = d.quantity ?? 0;
    const leaves = d.configuration ? leafCount(d.configuration) : 1;
    for (const s of MATERIAL_SLOTS) {
      if (s.slot === 'glazing' && !d.visionPanel) continue;
      const m = materialFor(p, d, s.slot);
      const text = String(d[s.field] ?? '').trim();
      if (!m && !text) continue;
      const key = m ? m.id : `free|${s.kind}|${text.toLowerCase()}`;
      const r = rows.get(key) ?? { kind: MATERIAL_KINDS[s.kind], name: m?.name ?? text, m, uses: new Set(), doors: new Set(), qty: 0, faces: 0 };
      r.uses.add(s.label);
      if (!r.doors.has(d.mark)) { r.doors.add(d.mark); r.qty += q; }
      if (s.slot === 'finish1' || s.slot === 'finish2') r.faces += q * leaves;
      rows.set(key, r);
    }
  }
  const out: Cell[][] = [...rows.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .map((r) => [r.kind, r.name, r.m?.manufacturer ?? '', r.m?.product ?? '', r.m?.code ?? '', r.m ? r.m.approvalRef : '', r.m ? APPROVAL_LABEL[r.m.approval] : 'NOT IN LIBRARY', r.m?.verified ? 'Yes' : 'No', [...r.uses].join('; '), [...r.doors].join(', '), r.qty, r.faces || '']);
  return { name: 'Material Schedule', columns: ['Kind', 'Name', 'Manufacturer', 'Product', 'Code', 'Submittal ref', 'Submittal status', 'Verified', 'Used as', 'Doors', 'Door qty', 'Leaf faces (finishes)'], rows: out };
}

// ---------- CSV ----------

export const MATERIAL_COLUMNS = ['kind', 'name', 'manufacturer', 'product', 'code', 'thickness', 'fireRated', 'fireRating', 'acoustic', 'sourceRef', 'approvalRef', 'approval', 'verified', 'notes'] as const;

export function materialTable(items: MaterialItem[]): Table {
  return {
    name: 'Material Library',
    columns: [...MATERIAL_COLUMNS],
    rows: items.map((m) => [m.kind, m.name, m.manufacturer, m.product, m.code, m.thickness ?? '', m.fireRated, m.fireRating, m.acoustic, m.sourceRef, m.approvalRef, m.approval, m.verified ? 'yes' : 'no', m.notes]),
  };
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());

export function materialsFromCsv(text: string): { items: MaterialItem[]; errors: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], errors: ['File is empty'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (k: string) => head.indexOf(k.toLowerCase());
  const missing = ['kind', 'name'].filter((k) => idx(k) < 0);
  if (missing.length) return { items: [], errors: [`Missing column(s): ${missing.join(', ')}. Expected: ${MATERIAL_COLUMNS.join(', ')}`] };
  const kinds = Object.entries(MATERIAL_KINDS) as [MaterialKind, string][];
  const approvals = Object.entries(APPROVAL_LABEL) as [MaterialItem['approval'], string][];
  const items: MaterialItem[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
    const kv = get('kind').toLowerCase();
    const kind = kinds.find(([k, l]) => k === kv || l.toLowerCase() === kv)?.[0];
    if (!kind) { errors.push(`Row ${i + 2}: unknown kind "${get('kind')}"`); return; }
    if (!get('name')) { errors.push(`Row ${i + 2}: name is blank`); return; }
    const av = get('approval').toLowerCase();
    const approval = approvals.find(([k, l]) => k === av || l.toLowerCase() === av)?.[0];
    if (av && approval === undefined) { errors.push(`Row ${i + 2}: unknown approval status "${get('approval')}"`); return; }
    const t = get('thickness');
    const thickness = t === '' ? null : Number(t);
    if (thickness !== null && !Number.isFinite(thickness)) { errors.push(`Row ${i + 2}: thickness "${t}" is not a number`); return; }
    const fr = get('fireRated').toLowerCase();
    items.push({
      id: uid('mat'), kind, name: get('name'), manufacturer: get('manufacturer'), product: get('product'), code: get('code'), thickness,
      fireRated: fr ? (yes(fr) ? 'yes' : /^(n|no|false|0)$/.test(fr) ? 'no' : '') : '', fireRating: get('fireRating'), acoustic: get('acoustic'),
      sourceRef: get('sourceRef'), approvalRef: get('approvalRef'), approval: approval ?? '', verified: yes(get('verified')), notes: get('notes'),
    });
  });
  return { items, errors };
}
