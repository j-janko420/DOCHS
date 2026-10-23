import type { Project } from '../core/types.js';
import { sampleProject } from '../core/defaults.js';
import { SAMPLES } from '../core/samples.js';
import type { DoorFilter } from '../core/classify.js';
import type { SheetSize } from '../cad/sheet.js';

const KEY = 'dochs.v1';

export interface UiState {
  view: string;
  filter: DoorFilter;
  selectedDoorId: string;
  sheetSize: SheetSize;
  mainScale: number; // 0 = auto
  hiddenLayers: string[];
}

interface Persisted {
  projects: Project[];
  currentId: string;
  ui: Partial<UiState>;
}

let projects: Project[] = [];
let currentId = '';
let storageOk = true;
let demo = false;
export const ui: UiState = { view: 'dashboard', filter: {}, selectedDoorId: '', sheetSize: 'A3', mainScale: 0, hiddenLayers: [] };
const listeners = new Set<() => void>();

// Demo mode (?demo in the URL): sample projects only, nothing read from or
// written to this browser's storage, so a shared link never touches real work.
export function demoOnly(): boolean {
  return (globalThis as { DOCHS_DEMO?: boolean }).DOCHS_DEMO === true;
}

export function isDemo(): boolean {
  return demo;
}

export function load() {
  // ?demo in the URL, or a host page that sets window.DOCHS_DEMO (hosts that drop the query string)
  demo = /[?&]demo\b/.test(location.search) || demoOnly();
  if (demo) {
    projects = SAMPLES.map((s) => s.build());
    const want = /[?&]demo=([a-z]+)/.exec(location.search)?.[1];
    currentId = projects[Math.max(0, SAMPLES.findIndex((s) => s.key === want))].id;
    return;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Persisted;
      projects = s.projects ?? [];
      currentId = s.currentId;
      Object.assign(ui, s.ui ?? {});
    }
  } catch {
    storageOk = false;
  }
  if (!projects.length) projects = [sampleProject()];
  if (!projects.some((p) => p.id === currentId)) currentId = projects[0].id;
}

export function storageAvailable(): boolean {
  return storageOk;
}

function persist() {
  if (demo) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ projects, currentId, ui: { filter: ui.filter, selectedDoorId: ui.selectedDoorId, sheetSize: ui.sheetSize, mainScale: ui.mainScale, hiddenLayers: ui.hiddenLayers } }));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export function project(): Project {
  return projects.find((p) => p.id === currentId)!;
}

export function allProjects(): Project[] {
  return projects;
}

export function setProject(next: Project) {
  projects = projects.map((p) => (p.id === next.id ? next : p));
  changed();
}

export function addProject(p: Project) {
  projects = [...projects.filter((x) => x.id !== p.id), p];
  currentId = p.id;
  ui.filter = {};
  ui.selectedDoorId = '';
  changed();
}

export function switchProject(id: string) {
  currentId = id;
  ui.filter = {};
  ui.selectedDoorId = '';
  changed();
}

export function deleteProject(id: string) {
  projects = projects.filter((p) => p.id !== id);
  if (!projects.length) projects = [sampleProject()];
  if (currentId === id) currentId = projects[0].id;
  changed();
}

export function setUi(patch: Partial<UiState>) {
  Object.assign(ui, patch);
  changed();
}

let scheduled = false;
export function changed() {
  persist();
  if (scheduled) return;
  scheduled = true;
  // deferred so focus has moved (e.g. Tab) before the view is rebuilt
  setTimeout(() => { scheduled = false; listeners.forEach((f) => f()); }, 0);
}

export function subscribe(f: () => void) {
  listeners.add(f);
}
