import type { Configuration, Door, Project } from './types.js';
import { leafCount } from './types.js';

const OPERATION: Record<Configuration, [string, string]> = {
  single: ['swing', 'Swing'], 'double-equal': ['swing', 'Swing'], 'double-unequal': ['swing', 'Swing'],
  'double-action-single': ['double-action', 'Double-action'], 'double-action-pair': ['double-action', 'Double-action'],
  pivot: ['pivot', 'Pivot'], 'sliding-single': ['sliding', 'Sliding'], 'sliding-double': ['sliding', 'Sliding'], pocket: ['pocket', 'Pocket'],
};

// A classification is "group:value". Automatic ones are derived from door data;
// project categories are assigned by the user. A door belongs to several at once.
export interface Classification {
  key: string;
  group: string;
  label: string;
}

const NONE = /^(|-|none|n\/?a|nfr|non[- ]?rated|non[- ]?fire[- ]?rated|non[- ]?acoustic|no)$/i;

export function isRated(v: string): boolean {
  return !NONE.test(v.trim());
}

export function classify(d: Door, p: Project): Classification[] {
  const out: Classification[] = [];
  const add = (group: string, value: string, label: string) => out.push({ key: `${group}:${value.toLowerCase()}`, group, label });
  if (d.configuration) {
    add('leaf', leafCount(d.configuration) === 2 ? 'double' : 'single', leafCount(d.configuration) === 2 ? 'Double leaf' : 'Single leaf');
    add('operation', OPERATION[d.configuration][0], OPERATION[d.configuration][1]);
  }
  if (d.leafMaterial.trim()) add('material', d.leafMaterial.trim(), d.leafMaterial.trim());
  if (d.visionPanel || /glaz|glass/i.test(d.leafMaterial + ' ' + d.leafFacing)) add('feature', 'glazed', 'Glazed');
  if (isRated(d.fireRating)) add('feature', 'fire-rated', 'Fire-rated');
  if (isRated(d.acousticRating)) add('feature', 'acoustic', 'Acoustic');
  if (d.accessControl) add('feature', 'access-controlled', 'Access-controlled');
  if (d.louvre) add('feature', 'louvred', 'Louvred');
  for (const id of d.categoryIds) {
    const c = p.categories.find((x) => x.id === id);
    if (c) out.push({ key: `custom:${c.id}`, group: 'custom', label: c.name });
  }
  return out;
}

export function allClassifications(p: Project): Classification[] {
  const seen = new Map<string, Classification>();
  for (const d of p.doors) for (const c of classify(d, p)) if (!seen.has(c.key)) seen.set(c.key, c);
  for (const c of p.categories) seen.set(`custom:${c.id}`, { key: `custom:${c.id}`, group: 'custom', label: c.name });
  const order = ['leaf', 'operation', 'material', 'feature', 'custom'];
  return [...seen.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.label.localeCompare(b.label));
}

export interface DoorFilter {
  buildingId?: string;
  floorId?: string;
  categoryKeys?: string[]; // door must match all
  status?: string;
  search?: string;
}

export function filterDoors(p: Project, f: DoorFilter): Door[] {
  const q = (f.search ?? '').trim().toLowerCase();
  return sortDoors(p, p.doors.filter((d) => {
    if (f.buildingId && d.buildingId !== f.buildingId) return false;
    if (f.floorId && d.floorId !== f.floorId) return false;
    if (f.status && d.status !== f.status) return false;
    if (f.categoryKeys?.length) {
      const keys = new Set(classify(d, p).map((c) => c.key));
      if (!f.categoryKeys.every((k) => keys.has(k))) return false;
    }
    if (q && ![d.mark, d.room, d.location, d.doorType, d.hardwareSet, d.remarks].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  }));
}

export function sortDoors(p: Project, doors: Door[]): Door[] {
  const fo = (d: Door) => p.floors.find((f) => f.id === d.floorId)?.order ?? 9999;
  const bo = (d: Door) => p.buildings.findIndex((b) => b.id === d.buildingId);
  return [...doors].sort((a, b) => bo(a) - bo(b) || fo(a) - fo(b) || a.mark.localeCompare(b.mark, undefined, { numeric: true }));
}

export function floorName(p: Project, id: string): string {
  return p.floors.find((f) => f.id === id)?.name ?? '';
}

export function buildingName(p: Project, id: string): string {
  return p.buildings.find((b) => b.id === id)?.name ?? '';
}
