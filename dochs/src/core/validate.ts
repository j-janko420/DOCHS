import type { Door, Project } from './types.js';
import { isSliding, isSwing, leafCount } from './types.js';
import { frameFit, has, parseHinges } from './geometry.js';
import { isRated } from './classify.js';
import { setsInScope, validateDoorHardware, validateHardwareSet } from './hardware.js';
import { validateDoorMaterials, validateMaterialLibrary } from './materials.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  ruleId: string;
  severity: Severity;
  doorId: string;
  mark: string;
  field: string;
  message: string;
  check: string; // calculation or check performed
  source: string; // where the requirement comes from
  action: string; // corrective action
}

const GEO = 'DOCHS geometric consistency rule';
const DATA = 'DOCHS data completeness rule';
const PRJ = 'Project-defined requirement (door record)';
const SPEC = 'Confirm against approved project specification / jurisdiction';
export const FIT_TOLERANCE = 2; // mm

export function validateDoor(d: Door, p: Project): Issue[] {
  const out: Issue[] = [];
  const add = (ruleId: string, severity: Severity, field: string, message: string, check: string, source: string, action: string) =>
    out.push({ ruleId, severity, doorId: d.id, mark: d.mark || '(no mark)', field, message, check, source, action });
  const c = d.configuration;
  const n = leafCount(c);

  if (!d.mark.trim()) add('E-ID-01', 'error', 'mark', 'Door mark is missing', 'mark is blank', DATA, 'Enter the door mark from the door schedule / key plan');
  else if (p.doors.some((o) => o.id !== d.id && o.mark.trim().toLowerCase() === d.mark.trim().toLowerCase()))
    add('E-ID-02', 'error', 'mark', `Duplicate door mark ${d.mark}`, 'mark appears more than once in the project', DATA, 'Give each door record a unique mark, or use the quantity field');
  if (!p.floors.some((f) => f.id === d.floorId && f.buildingId === d.buildingId))
    add('E-ID-03', 'error', 'floorId', 'Building / floor not assigned', 'floor must belong to the selected building', DATA, 'Select the building and floor');
  if (!has(d.quantity) || d.quantity < 1) add('W-ID-04', 'warning', 'quantity', 'Quantity not specified', 'quantity >= 1', DATA, 'Enter the quantity of identical doors');
  if (!c) add('E-CFG-01', 'error', 'configuration', 'Door configuration not specified', 'configuration is blank', DATA, 'Select the leaf configuration');
  if (c && !d.handing) add('W-CFG-02', 'warning', 'handing', isSliding(c) ? 'Slide direction (handing) not specified' : 'Handing not specified', 'handing is blank', DATA, 'Enter handing (LH/RH/LHR/RHR) per the project handing convention');
  if (c && isSwing(c) && !has(d.openingAngle)) add('I-CFG-03', 'info', 'openingAngle', 'Opening angle not specified - plan drawn at 90 deg', 'openingAngle is blank', DATA, 'Enter the opening angle if the plan must show a restricted swing');
  if (c === 'pivot' && !has(d.pivotOffset)) add('W-CFG-04', 'warning', 'pivotOffset', 'Pivot offset not specified - drawn at leaf edge', 'pivotOffset is blank', DATA, 'Enter the pivot centre offset from the manufacturer data');

  if (!has(d.openingWidth) || !has(d.openingHeight)) add('E-DIM-01', 'error', 'openingWidth', 'Structural opening width / height missing', 'openingWidth and openingHeight required', DATA, 'Enter S.O. dimensions');
  if (!has(d.leafWidth1) || (n === 2 && !has(d.leafWidth2))) add('E-DIM-02', 'error', 'leafWidth1', n === 2 ? 'Both leaf widths are required for a pair' : 'Leaf width missing', `${n} leaf width(s) required`, DATA, 'Enter leaf width(s)');
  if (!has(d.leafHeight)) add('E-DIM-03', 'error', 'leafHeight', 'Leaf height missing', 'leafHeight required', DATA, 'Enter leaf height');
  if (!has(d.leafThickness)) add('E-DIM-04', 'error', 'leafThickness', 'Leaf thickness missing', 'leafThickness required', DATA, 'Enter leaf thickness');
  if (c === 'double-equal' && has(d.leafWidth1) && has(d.leafWidth2) && d.leafWidth1 !== d.leafWidth2)
    add('E-DIM-05', 'error', 'leafWidth2', 'Equal pair has unequal leaves', `${d.leafWidth1} != ${d.leafWidth2}`, GEO, 'Correct leaf widths or change configuration to unequal pair');
  if (c === 'double-unequal' && has(d.leafWidth1) && has(d.leafWidth2) && d.leafWidth1 === d.leafWidth2)
    add('W-DIM-06', 'warning', 'configuration', 'Unequal pair has equal leaves', `${d.leafWidth1} = ${d.leafWidth2}`, GEO, 'Change configuration to equal pair or correct leaf widths');
  if (has(d.leafHeight) && has(d.openingHeight) && !isSliding(c) && d.leafHeight > d.openingHeight)
    add('E-DIM-07', 'error', 'leafHeight', `Leaf height ${d.leafHeight} > structural opening height ${d.openingHeight}`, `${d.leafHeight} > ${d.openingHeight}`, GEO, 'Confirm the S.O. or the leaf height before production');
  const fit = frameFit(d);
  const lt = fit.actualLeafTotal;
  if (has(d.openingWidth) && has(d.leafWidth1) && !isSliding(c) && lt > d.openingWidth)
    add('E-DIM-08', 'error', 'leafWidth1', `Leaf total ${lt} > structural opening width ${d.openingWidth}`, `${lt} > ${d.openingWidth}`, GEO, 'Confirm the S.O. or the leaf widths before production');

  if (!fit.complete) {
    add('W-FRM-01', 'warning', 'frameWidth', 'Frame data incomplete - sections and fit check not possible', `missing: ${fit.missing.join(', ')}`, DATA, 'Enter frame width, rebate, install gap and edge gap from the approved frame profile');
  } else if (c && has(d.leafWidth1) && has(d.leafHeight)) {
    if (isSliding(c)) {
      if (lt < fit.apertureWidth)
        add('W-DIM-09', 'warning', 'leafWidth1', `Sliding leaf total ${lt} does not cover aperture ${fit.apertureWidth}`, `${lt} < ${fit.apertureWidth}`, GEO, 'Confirm sliding leaf overlap against the track system');
    } else {
      const dw = lt - fit.expectedLeafTotal;
      if (Math.abs(dw) > FIT_TOLERANCE)
        add('W-DIM-10', 'warning', 'leafWidth1', `Leaf width does not fit frame (${dw > 0 ? '+' : ''}${dw} mm)`, `aperture ${fit.apertureWidth} + 2x rebate ${d.rebateDepth} - gaps = ${fit.expectedLeafTotal}; leaves = ${lt}; tolerance ${FIT_TOLERANCE}`, GEO, 'Correct leaf width(s) or frame / gap parameters');
      const dh = num(d.leafHeight) - fit.expectedLeafHeight;
      if (Math.abs(dh) > FIT_TOLERANCE)
        add('W-DIM-11', 'warning', 'leafHeight', `Leaf height does not fit frame (${dh > 0 ? '+' : ''}${dh} mm)`, `aperture ${fit.apertureHeight} + rebate ${d.rebateDepth} - edge gap ${d.edgeGap} - undercut ${num(d.undercut)} = ${fit.expectedLeafHeight}; leaf = ${d.leafHeight}`, GEO, 'Correct leaf height, undercut or frame parameters');
    }
  }
  if (has(d.frameDepth) && has(d.wallThickness) && d.frameDepth > d.wallThickness)
    add('W-FRM-02', 'warning', 'frameDepth', `Frame depth ${d.frameDepth} > wall thickness ${d.wallThickness}`, `${d.frameDepth} > ${d.wallThickness}`, GEO, 'Confirm wall type / frame profile interface');
  if (!has(d.wallThickness)) add('W-FRM-03', 'warning', 'wallThickness', 'Wall thickness missing - plan shows frame depth only', 'wallThickness is blank', DATA, 'Enter the wall thickness');
  if (has(d.requiredClearWidth) && fit.complete && isSwing(c) && n === 1 && has(d.leafThickness) && fit.nominalClearWidth < d.requiredClearWidth)
    add('E-CLR-01', 'error', 'requiredClearWidth', `Nominal clear width ${fit.nominalClearWidth} < required ${d.requiredClearWidth}`, `aperture ${fit.apertureWidth} - leaf thickness ${d.leafThickness} = ${fit.nominalClearWidth} (excludes hardware projection)`, PRJ, 'Increase opening / leaf width or confirm the requirement');

  if (d.visionPanel) {
    if (!has(d.vpWidth) || !has(d.vpHeight) || !has(d.vpFromTop)) add('W-VP-01', 'warning', 'vpWidth', 'Vision panel size / position incomplete', 'vpWidth, vpHeight, vpFromTop required', DATA, 'Enter vision panel size and position');
    else if (has(d.leafWidth1) && has(d.leafHeight) && (d.vpWidth >= Math.min(d.leafWidth1, has(d.leafWidth2) && n === 2 ? d.leafWidth2 : Infinity) || d.vpFromTop + d.vpHeight >= d.leafHeight))
      add('E-VP-02', 'error', 'vpWidth', 'Vision panel does not fit within the leaf', `vp ${d.vpWidth}x${d.vpHeight} @ ${d.vpFromTop} from top vs leaf`, GEO, 'Correct vision panel size or position');
  }
  if (d.louvre && (!has(d.louvreWidth) || !has(d.louvreHeight) || !has(d.louvreFromBottom))) add('W-LV-01', 'warning', 'louvreWidth', 'Louvre size / position incomplete', 'louvre width, height, from bottom required', DATA, 'Enter louvre data');
  if (d.kickPlate && !has(d.kickPlateHeight)) add('W-KP-01', 'warning', 'kickPlateHeight', 'Kick plate height missing', 'kickPlateHeight required', DATA, 'Enter kick plate height');

  if (!d.leafMaterial.trim() || !d.finishSide1.trim()) add('W-MAT-01', 'warning', 'leafMaterial', 'Leaf material / finish not specified', 'leafMaterial and finishSide1 required', DATA, 'Enter material and finish from the specification');
  if (!d.frameMaterial.trim()) add('W-MAT-02', 'warning', 'frameMaterial', 'Frame material not specified', 'frameMaterial required', DATA, 'Enter frame material');

  if (!d.hardwareSet.trim()) add('W-HW-01', 'warning', 'hardwareSet', 'Hardware set not assigned', 'hardwareSet is blank', DATA, 'Assign the hardware set from the hardware schedule');
  else if (!p.hardwareSets.some((h) => h.code === d.hardwareSet.trim()))
    add('W-HW-02', 'warning', 'hardwareSet', `Hardware set ${d.hardwareSet} not in project library`, 'set code not found', DATA, 'Add the set to the hardware library or correct the code');
  const hinges = parseHinges(d.hingePositions);
  if (d.hingePositions.trim() && has(d.leafHeight) && hinges.some((h) => h <= 0 || h >= num(d.leafHeight)))
    add('E-HW-03', 'error', 'hingePositions', 'Hinge position outside leaf height', `positions ${hinges.join(', ')} vs leaf ${d.leafHeight}`, GEO, 'Correct hinge positions (mm from bottom of leaf)');
  if (has(d.handleHeight) && has(d.leafHeight) && (d.handleHeight <= num(d.undercut) || d.handleHeight >= num(d.undercut) + d.leafHeight))
    add('E-HW-04', 'error', 'handleHeight', 'Handle height outside the leaf', `FFL ${d.handleHeight} vs leaf ${num(d.undercut)}..${num(d.undercut) + d.leafHeight}`, GEO, 'Correct handle height (mm from finished floor)');
  if (d.accessControl && !d.hardwareSet.trim()) add('W-HW-05', 'warning', 'accessControl', 'Access-controlled door without hardware set', 'accessControl and no set', DATA, 'Resolve access-control interface with the security consultant');

  if (isRated(d.fireRating)) {
    add('I-FR-01', 'info', 'fireRating', `Fire rating ${d.fireRating}: compliance not assessed by DOCHS`, 'rating present', SPEC, 'Confirm certified assembly, frame, seals, glazing and hardware with the fire consultant');
    if (!d.smokeSeal) add('W-FR-02', 'warning', 'smokeSeal', 'Fire-rated door without smoke seal recorded', 'smokeSeal = no', SPEC, 'Confirm whether smoke seals are required');
    if (d.visionPanel) add('I-FR-03', 'info', 'visionPanel', 'Fire-rated door with vision panel', 'visionPanel = yes', SPEC, 'Confirm fire-rated glazing system and size limits');
  }
  if (isRated(d.acousticRating) && !d.threshold.trim()) add('W-AC-01', 'warning', 'threshold', 'Acoustic door without threshold / seal detail', 'threshold is blank', SPEC, 'Specify drop seal or threshold for the acoustic rating');

  out.push(...validateDoorHardware(d, p));
  out.push(...validateDoorMaterials(d, p));

  const open = d.comments.filter((x) => !x.resolved).length;
  if (open) add('W-REV-01', 'warning', 'comments', `${open} unresolved review comment(s)`, 'comments not resolved', DATA, 'Resolve or respond to review comments');
  if (d.status === 'approved' && out.some((i) => i.severity === 'error'))
    add('E-REV-02', 'error', 'status', 'Door is approved but has open errors', 'status = approved with errors', DATA, 'Fix errors or return the door to review');
  if (!d.sourceRef.trim()) add('I-SRC-01', 'info', 'sourceRef', 'No source drawing reference', 'sourceRef is blank', DATA, 'Record the source drawing / sheet');
  return out;
}

function num(v: number | null): number {
  return v ?? 0;
}

export function validateProject(p: Project): Issue[] {
  return [...p.doors.flatMap((d) => validateDoor(d, p)), ...p.hardwareSets.flatMap((hs) => validateHardwareSet(hs, p)), ...validateMaterialLibrary(p)];
}

// Door issues for the given doors plus set-level issues for the sets they use.
export function validateScope(p: Project, doors: Door[]): Issue[] {
  return [...doors.flatMap((d) => validateDoor(d, p)), ...setsInScope(p, doors).flatMap((hs) => validateHardwareSet(hs, p))];
}

export function counts(issues: Issue[]): Record<Severity, number> {
  return {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
}

// Doors with hard errors cannot drive issued drawings.
export function drawable(d: Door, p: Project): { ok: boolean; errors: Issue[] } {
  const errors = validateDoor(d, p).filter((i) => i.severity === 'error' && i.ruleId !== 'E-REV-02');
  return { ok: errors.length === 0, errors };
}
