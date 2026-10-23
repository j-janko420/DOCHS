import type { Door } from './types.js';
import { isSliding, leafCount } from './types.js';

// Derived dimensions shared by validation, schedules and the CAD engine, so the
// three can never disagree. Formulae (all mm):
//   frame outer width   = S.O. width  - 2 x install gap
//   frame outer height  = S.O. height - install gap
//   aperture width      = frame outer width - 2 x frame width        (stop to stop)
//   aperture height     = frame outer height - frame width
//   leaf total (expect) = aperture width + 2 x rebate - 2 x edge gap - (leaves-1) x edge gap
//   leaf height (expect)= aperture height + rebate - edge gap - undercut
//   nominal clear width = aperture width - leaf thickness (single swing at 90 deg,
//                         excludes hardware projections)
export interface FrameFit {
  complete: boolean;
  missing: string[];
  frameOuterWidth: number;
  frameOuterHeight: number;
  apertureWidth: number;
  apertureHeight: number;
  expectedLeafTotal: number;
  expectedLeafHeight: number;
  actualLeafTotal: number;
  nominalClearWidth: number;
}

export const FRAME_FIELDS: (keyof Door)[] = ['openingWidth', 'openingHeight', 'frameWidth', 'rebateDepth', 'installGap', 'edgeGap'];

export function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function has(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function leafTotal(d: Door): number {
  return leafCount(d.configuration) === 2 ? num(d.leafWidth1) + num(d.leafWidth2) : num(d.leafWidth1);
}

export function frameFit(d: Door): FrameFit {
  const missing = FRAME_FIELDS.filter((k) => !has(d[k] as number | null)).map(String);
  const n = leafCount(d.configuration);
  const ow = num(d.openingWidth) - 2 * num(d.installGap);
  const oh = num(d.openingHeight) - num(d.installGap);
  const aw = ow - 2 * num(d.frameWidth);
  const ah = oh - num(d.frameWidth);
  const rb = isSliding(d.configuration) ? 0 : num(d.rebateDepth);
  return {
    complete: missing.length === 0,
    missing,
    frameOuterWidth: ow,
    frameOuterHeight: oh,
    apertureWidth: aw,
    apertureHeight: ah,
    expectedLeafTotal: aw + 2 * rb - 2 * num(d.edgeGap) - (n - 1) * num(d.edgeGap),
    expectedLeafHeight: ah + rb - num(d.edgeGap) - num(d.undercut),
    actualLeafTotal: leafTotal(d),
    nominalClearWidth: aw - num(d.leafThickness),
  };
}

export function parseHinges(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((x) => Number.isFinite(x));
}

// Hinge side as seen from the outside (front elevation), LH/RH/LHR/RHR convention.
export function hingeLeft(d: Door): boolean {
  return d.handing === 'LH' || d.handing === 'LHR';
}

// true = leaf swings away from the outside viewer (into the inside).
export function swingsIn(d: Door): boolean {
  return d.handing === 'LH' || d.handing === 'RH' || d.handing === '';
}
