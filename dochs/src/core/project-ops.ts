import type { Door, Project } from './types.js';
import { blankDoor, blankProject, uid } from './defaults.js';

export const SCHEMA = 'dochs.project';
export const SCHEMA_VERSION = 1;

const show = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));

// Apply a change to a door and append one history record per changed field.
export function patchDoor(p: Project, id: string, patch: Partial<Door>, at = new Date().toISOString()): Project {
  return {
    ...p,
    doors: p.doors.map((d) => {
      if (d.id !== id) return d;
      const history = [...d.history];
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'history' || k === 'comments') continue;
        const before = show(d[k as keyof Door]);
        const after = show(v);
        if (before !== after) history.push({ at, field: k, from: before, to: after });
      }
      return { ...d, ...patch, history };
    }),
  };
}

export function duplicateDoor(p: Project, id: string): { project: Project; door: Door } {
  const src = p.doors.find((d) => d.id === id);
  if (!src) throw new Error('door not found');
  let mark = `${src.mark}-copy`;
  for (let i = 2; p.doors.some((d) => d.mark === mark); i++) mark = `${src.mark}-copy${i}`;
  const door: Door = { ...structuredClone(src), id: uid('door'), mark, status: 'draft', comments: [], history: [] };
  return { project: { ...p, doors: [...p.doors, door] }, door };
}

export function exportProject(p: Project): string {
  return JSON.stringify({ schema: SCHEMA, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), project: p }, null, 2);
}

// Accepts a DOCHS backup (or a bare project object) and fills fields added in
// later versions with blanks. Throws with a readable reason on invalid input.
export function importProject(text: string): Project {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('File is not valid JSON'); }
  const obj = raw as { schema?: string; project?: unknown };
  const pr = (obj && obj.schema === SCHEMA ? obj.project : raw) as Partial<Project> | null;
  if (!pr || typeof pr !== 'object' || !Array.isArray(pr.doors) || !Array.isArray(pr.floors) || !Array.isArray(pr.buildings))
    throw new Error('Not a DOCHS project: buildings, floors and doors are required');
  const base = blankProject(pr.name ?? 'Imported project');
  const project: Project = { ...base, ...pr, id: pr.id || base.id } as Project;
  project.categories = pr.categories ?? [];
  // v0.1 backups: set items had no id / catalogue link
  project.hardwareSets = (pr.hardwareSets ?? []).map((s) => ({
    ...s,
    items: (s.items ?? []).map((it) => ({ ...it, id: it.id || uid('hwi'), catalogueId: it.catalogueId ?? '' })),
  }));
  project.catalogue = pr.catalogue ?? [];
  project.materials = pr.materials ?? [];
  project.incompatibilities = pr.incompatibilities ?? [];
  project.revisions = pr.revisions ?? [];
  project.doors = pr.doors.map((d) => blankDoor({ ...(d as Partial<Door>), id: (d as Door).id || uid('door') }));
  return project;
}

export function removeFloor(p: Project, floorId: string): Project {
  if (p.doors.some((d) => d.floorId === floorId)) throw new Error('Floor has doors; move or delete them first');
  return { ...p, floors: p.floors.filter((f) => f.id !== floorId) };
}

export function removeBuilding(p: Project, id: string): Project {
  if (p.doors.some((d) => d.buildingId === id)) throw new Error('Building has doors; move or delete them first');
  return { ...p, buildings: p.buildings.filter((b) => b.id !== id), floors: p.floors.filter((f) => f.buildingId !== id) };
}

export function removeCategory(p: Project, id: string): Project {
  return { ...p, categories: p.categories.filter((c) => c.id !== id), doors: p.doors.map((d) => (d.categoryIds.includes(id) ? { ...d, categoryIds: d.categoryIds.filter((x) => x !== id) } : d)) };
}
