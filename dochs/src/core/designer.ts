import type { Configuration, Door, Handing, HardwareItem, MaterialKind, MaterialSlot, Project } from './types.js';
import { MATERIAL_SLOTS, isSliding, leafCount } from './types.js';
import { blankDoor, uid } from './defaults.js';
import { DOOR_STYLES, HARDWARE_FUNCTIONS, ensureHardwareTypes, ensureMaterials, type Performance } from './reference.js';

// Door Designer: turns a structural opening plus clicked options into a door
// record. Frame, gap, hinge, handle and vision panel values are *starting
// assumptions* shown to the user and recorded on the door for verification.

export type Vision = 'none' | 'narrow' | 'standard' | 'full';

export interface DesignInput {
  soWidth: number;
  soHeight: number;
  wallThickness: number;
  styleKey: string;
  configuration: Configuration;
  handing: Handing;
  unequalRatio: number; // share of leaf 1 for unequal pairs
  performance: Performance;
  fireRating: string;
  acousticRating: string;
  leafMaterial: string;
  core: string;
  facing: string;
  finish1: string;
  finish2: string;
  frameMaterial: string;
  frameFinish: string;
  vision: Vision;
  glazingType: string;
  kickPlate: boolean;
  hardwareFunction: string;
  hinge: string;
  // starting assumptions (editable)
  leafThickness: number;
  installGap: number;
  frameWidth: number;
  rebateDepth: number;
  edgeGap: number;
  undercut: number;
  slidingOverlap: number;
  handleHeight: number;
}

export const ASSUMPTION_NOTE = 'Created in the DOCHS Door Designer. Frame width, rebate, gaps, undercut, leaf thickness, hinge, handle and vision panel values are starting assumptions: verify against the selected manufacturer system before approval.';

export function defaultDesign(): DesignInput {
  return applyStyle({
    soWidth: 1000, soHeight: 2200, wallThickness: 150, styleKey: 'timber-flush', configuration: 'single', handing: 'LH', unequalRatio: 0.65,
    performance: 'non-fr', fireRating: '', acousticRating: '', leafMaterial: '', core: '', facing: '', finish1: '', finish2: '', frameMaterial: '', frameFinish: '',
    vision: 'none', glazingType: '', kickPlate: false, hardwareFunction: 'passage', hinge: 'Butt hinge',
    leafThickness: 45, installGap: 5, frameWidth: 50, rebateDepth: 15, edgeGap: 3, undercut: 8, slidingOverlap: 50, handleHeight: 1050,
  }, 'timber-flush');
}

// Choosing a style fills materials and sensible defaults; every value stays editable.
export function applyStyle(d: DesignInput, key: string): DesignInput {
  const s = DOOR_STYLES.find((x) => x.key === key) ?? DOOR_STYLES[0];
  const performance = s.performance.includes(d.performance) ? d.performance : s.performance[0];
  const configuration = s.configurations.includes(d.configuration) ? d.configuration : s.configurations[0];
  const glass = s.key === 'glass-frameless';
  return withPerformance({
    ...d, styleKey: s.key, configuration, performance,
    leafMaterial: s.leaf, core: s.core, facing: s.facing, finish1: s.finish, finish2: s.finish, frameMaterial: s.frame, frameFinish: s.frameFinish,
    vision: s.glazed === 'full' ? 'full' : s.glazed === 'none' ? 'none' : d.vision,
    glazingType: s.glazed === 'none' ? '' : d.glazingType || 'Clear toughened glass',
    leafThickness: glass ? 12 : s.group === 'Metal' || s.key === 'steel-fr' ? 54 : d.leafThickness,
    rebateDepth: glass || isSliding(configuration) ? 0 : d.rebateDepth || 15,
    hardwareFunction: isSliding(configuration) ? 'sliding' : d.hardwareFunction === 'sliding' ? 'passage' : d.hardwareFunction,
  }, performance);
}

export function withPerformance(d: DesignInput, perf: Performance): DesignInput {
  const fr = perf === 'fr' || perf === 'fr-acoustic';
  const ac = perf === 'acoustic' || perf === 'fr-acoustic';
  return {
    ...d, performance: perf,
    fireRating: fr ? d.fireRating || '60 min' : '',
    acousticRating: ac ? d.acousticRating || '35 dB' : '',
    core: fr ? 'Fire-resisting mineral core' : ac && !fr ? 'Acoustic core' : d.core === 'Fire-resisting mineral core' || d.core === 'Acoustic core' ? (DOOR_STYLES.find((s) => s.key === d.styleKey)?.core ?? d.core) : d.core,
    glazingType: d.vision === 'none' ? d.glazingType : fr ? 'Fire-resisting glass' : ac ? 'Acoustic laminated glass' : d.glazingType === 'Fire-resisting glass' || d.glazingType === 'Acoustic laminated glass' ? 'Clear toughened glass' : d.glazingType,
    leafThickness: fr || ac ? Math.max(d.leafThickness, 54) : d.leafThickness,
    hardwareFunction: fr && ['passage', 'office', 'storeroom'].includes(d.hardwareFunction) ? 'fire-closer' : d.hardwareFunction,
  };
}

export interface DesignResult {
  door: Door;
  leaves: number[];
  leafHeight: number;
  aperture: number;
  clearWidth: number | null;
  errors: string[];
  notes: string[];
}

export function designDoor(i: DesignInput): DesignResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const c = i.configuration;
  const n = leafCount(c);
  const sliding = isSliding(c);
  const da = c.startsWith('double-action');
  const rb = sliding || da ? 0 : i.rebateDepth;
  const g = i.installGap, fw = i.frameWidth, eg = i.edgeGap;
  const aperture = i.soWidth - 2 * g - 2 * fw;
  const apertureH = i.soHeight - g - fw;
  let leaves: number[];
  if (sliding) {
    leaves = n === 2 ? [Math.round(aperture / 2 + i.slidingOverlap), Math.round(aperture / 2 + i.slidingOverlap)] : [Math.round(aperture + 2 * i.slidingOverlap)];
    notes.push(`Sliding leaf = aperture + ${i.slidingOverlap} mm overlap each side (assumption).`);
  } else {
    const total = aperture + 2 * rb - 2 * eg - (n - 1) * eg;
    if (n === 1) leaves = [total];
    else if (c === 'double-unequal') { const l1 = Math.round(total * i.unequalRatio); leaves = [l1, total - l1]; }
    else leaves = [Math.floor(total / 2), Math.floor(total / 2)];
  }
  const leafHeight = apertureH + rb - eg - i.undercut;
  if (aperture <= 0 || leafHeight <= 0) errors.push('Opening is too small for the frame and gap values.');
  if (leaves.some((l) => l < 300)) errors.push('A leaf would be narrower than 300 mm: check the opening, configuration or split.');
  if (i.soWidth > 6000 || i.soHeight > 6000) errors.push('Opening over 6000 mm: check the units are millimetres.');
  if (i.wallThickness < i.leafThickness) errors.push('Wall is thinner than the leaf.');
  const minLeaf = Math.min(...leaves);
  // vision panel sizes are proportional starting points, kept inside the leaf
  let vp: Partial<Door> = { visionPanel: false };
  if (i.vision !== 'none' && minLeaf > 300) {
    const w = i.vision === 'narrow' ? 150 : i.vision === 'standard' ? Math.min(300, minLeaf - 200) : minLeaf - 2 * 100;
    const fromTop = i.vision === 'full' ? 100 : 300;
    const h = i.vision === 'full' ? leafHeight - 2 * 100 : Math.min(i.vision === 'narrow' ? 1000 : 1200, leafHeight - fromTop - 700);
    if (w > 50 && h > 100) vp = { visionPanel: true, vpWidth: w, vpHeight: h, vpFromTop: fromTop, glazingType: i.glazingType };
  }
  const hinges = sliding || c === 'pivot' ? '' : (leafHeight > 2400 ? [250, Math.round(leafHeight / 3), Math.round((2 * leafHeight) / 3), leafHeight - 250] : [250, Math.round(leafHeight / 2), leafHeight - 250]).join(',');
  const fn = HARDWARE_FUNCTIONS.find((f) => f.key === i.hardwareFunction);
  const style = DOOR_STYLES.find((s) => s.key === i.styleKey);
  const door = blankDoor({
    doorType: style?.name ?? '', quantity: 1, configuration: c, handing: i.handing, openingAngle: sliding ? null : 90,
    openingWidth: i.soWidth, openingHeight: i.soHeight, leafWidth1: leaves[0], leafWidth2: n === 2 ? leaves[1] : null, leafHeight, leafThickness: i.leafThickness, undercut: i.undercut,
    frameMaterial: i.frameMaterial, frameFinish: i.frameFinish, frameWidth: fw, frameDepth: i.wallThickness, rebateDepth: rb, installGap: g, edgeGap: eg,
    wallThickness: i.wallThickness, framePosition: 'centre',
    leafMaterial: i.leafMaterial, leafCore: i.core, leafFacing: i.facing, finishSide1: i.finish1, finishSide2: i.finish2,
    ...vp,
    kickPlate: i.kickPlate, kickPlateHeight: i.kickPlate ? 200 : null,
    fireRating: i.fireRating, acousticRating: i.acousticRating, smokeSeal: i.performance === 'fr' || i.performance === 'fr-acoustic',
    accessControl: Boolean(fn?.accessControl),
    handleHeight: sliding || i.hardwareFunction === 'push-pull' ? null : i.handleHeight, hingePositions: hinges,
    pivotOffset: c === 'pivot' ? 100 : null,
    threshold: i.performance === 'acoustic' || i.performance === 'fr-acoustic' ? 'Automatic drop seal' : 'Flush',
    sourceRef: 'DOCHS Door Designer', remarks: ASSUMPTION_NOTE, status: 'draft',
  });
  const clearWidth = !sliding && n === 1 ? aperture - i.leafThickness : null;
  return { door, leaves, leafHeight, aperture, clearWidth, errors, notes };
}

const SLOT_KIND: Record<MaterialSlot, MaterialKind> = Object.fromEntries(MATERIAL_SLOTS.map((s) => [s.slot, s.kind])) as Record<MaterialSlot, MaterialKind>;

// Hardware lines for the chosen function, hinge type and configuration.
export function hardwareLines(i: DesignInput): { type: string; qty: number; basis: 'per-door' | 'per-leaf' }[] {
  const fn = HARDWARE_FUNCTIONS.find((f) => f.key === i.hardwareFunction);
  if (!fn || !fn.lines.length) return [];
  const c = i.configuration;
  const lines = [...fn.lines];
  if (c === 'pivot') lines.unshift({ type: 'Floor pivot', qty: 1, basis: 'per-leaf' }, { type: 'Top pivot', qty: 1, basis: 'per-leaf' });
  else if (c.startsWith('double-action')) lines.unshift({ type: 'Double-action spring hinge', qty: 3, basis: 'per-leaf' });
  else if (!isSliding(c)) {
    const h = designDoor(i).leafHeight;
    lines.unshift({ type: i.hinge, qty: i.hinge === 'Continuous (piano) hinge' ? 1 : h > 2400 ? 4 : 3, basis: 'per-leaf' });
  }
  if (leafCount(c) === 2 && !isSliding(c) && fn.key !== 'exit') lines.push({ type: 'Automatic flush bolt', qty: 2, basis: 'per-door' }, { type: 'Door selector / coordinator', qty: 1, basis: 'per-door' });
  if (i.kickPlate) lines.push({ type: 'Kick plate', qty: 1, basis: 'per-leaf' });
  if ((i.performance === 'acoustic' || i.performance === 'fr-acoustic')) lines.push({ type: 'Perimeter seal', qty: 1, basis: 'per-door' }, { type: 'Automatic drop seal', qty: 1, basis: 'per-leaf' });
  return lines;
}

export interface AddOptions { mark: string; buildingId: string; floorId: string; room: string; quantity: number }

// Adds the designed door to the project: missing library items are added as
// unverified reference entries, door fields are linked, and the hardware set is
// reused when an identical one exists or created as DD-xx.
export function addDesignedDoor(p: Project, i: DesignInput, o: AddOptions): { project: Project; door: Door } {
  const r = designDoor(i);
  if (r.errors.length) throw new Error(r.errors[0]);
  let door: Door = { ...r.door, id: uid('door'), mark: o.mark.trim(), buildingId: o.buildingId, floorId: o.floorId, room: o.room, quantity: o.quantity };
  if (!door.mark) throw new Error('Enter a door mark');
  if (p.doors.some((d) => d.mark.trim().toLowerCase() === door.mark.toLowerCase())) throw new Error(`Door mark ${door.mark} already exists`);
  // materials
  const wanted = MATERIAL_SLOTS.map((s) => ({ slot: s.slot, kind: SLOT_KIND[s.slot], name: String(door[s.field] ?? '') })).filter((w) => w.name && (w.slot !== 'glazing' || door.visionPanel));
  const m = ensureMaterials(p, wanted);
  let project = m.project;
  const materialIds: Door['materialIds'] = {};
  for (const w of wanted) materialIds[w.slot] = m.ids[`${w.kind}|${w.name}`];
  door = { ...door, materialIds };
  // hardware
  const lines = hardwareLines(i);
  if (lines.length) {
    const hw = ensureHardwareTypes(project, lines.map((l) => l.type));
    project = hw.project;
    const sig = (items: { catalogueId: string; qty: number; basis: string }[]) => items.map((x) => `${x.catalogueId}:${x.qty}:${x.basis}`).sort().join('|');
    const want = lines.map((l) => ({ catalogueId: hw.ids[l.type], qty: l.qty, basis: l.basis }));
    let set = project.hardwareSets.find((s) => sig(s.items) === sig(want));
    if (!set) {
      let k = 1;
      while (project.hardwareSets.some((s) => s.code === `DD-${String(k).padStart(2, '0')}`)) k++;
      const fn = HARDWARE_FUNCTIONS.find((f) => f.key === i.hardwareFunction)!;
      const items: HardwareItem[] = lines.map((l) => ({ id: uid('hwi'), catalogueId: hw.ids[l.type], item: l.type, qty: l.qty, basis: l.basis, manufacturer: '', model: '', finish: '' }));
      set = { code: `DD-${String(k).padStart(2, '0')}`, description: `Designer: ${fn.name}${i.performance !== 'non-fr' ? ` (${i.performance.toUpperCase()})` : ''}`, items };
      project = { ...project, hardwareSets: [...project.hardwareSets, set] };
    }
    door = { ...door, hardwareSet: set.code };
  }
  return { project: { ...project, doors: [...project.doors, door] }, door };
}
