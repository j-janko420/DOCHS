// DOCHS data model. All lengths are millimetres. `null` / '' means "not specified"
// and is never replaced by an invented value: validation flags it for review.

export type Configuration =
  | 'single'
  | 'double-equal'
  | 'double-unequal'
  | 'double-action-single'
  | 'double-action-pair'
  | 'pivot'
  | 'sliding-single'
  | 'sliding-double'
  | 'pocket';

export type Handing = 'LH' | 'RH' | 'LHR' | 'RHR';
export type FramePosition = 'centre' | 'flush-outside' | 'flush-inside';
export type DoorStatus = 'draft' | 'for-review' | 'approved' | 'on-hold';

export interface Comment {
  at: string;
  by: string;
  text: string;
  resolved: boolean;
}

export interface ChangeRecord {
  at: string;
  field: string;
  from: string;
  to: string;
}

export interface Door {
  id: string;
  // identity
  mark: string;
  doorType: string;
  buildingId: string;
  floorId: string;
  room: string;
  location: string;
  quantity: number | null;
  // configuration
  configuration: Configuration | '';
  handing: Handing | '';
  openingAngle: number | null;
  // opening and leaf
  openingWidth: number | null; // structural opening (S.O.) width
  openingHeight: number | null; // S.O. height from finished floor
  leafWidth1: number | null;
  leafWidth2: number | null;
  leafHeight: number | null;
  leafThickness: number | null;
  undercut: number | null;
  requiredClearWidth: number | null; // project requirement, blank = no check
  // frame and wall
  frameMaterial: string;
  frameFinish: string;
  frameProfile: string;
  frameWidth: number | null; // jamb/head face width including stop
  frameDepth: number | null;
  rebateDepth: number | null;
  installGap: number | null; // S.O. to back of frame, per side and head
  edgeGap: number | null; // frame/leaf and meeting-stile gap
  wallThickness: number | null;
  wallType: string;
  framePosition: FramePosition | '';
  // leaf construction
  leafMaterial: string;
  leafCore: string;
  leafFacing: string;
  finishSide1: string;
  finishSide2: string;
  // openings in leaf
  visionPanel: boolean;
  vpWidth: number | null;
  vpHeight: number | null;
  vpFromTop: number | null;
  louvre: boolean;
  louvreWidth: number | null;
  louvreHeight: number | null;
  louvreFromBottom: number | null;
  kickPlate: boolean;
  kickPlateHeight: number | null;
  // performance
  fireRating: string;
  acousticRating: string;
  smokeSeal: boolean;
  accessControl: boolean;
  // hardware
  hardwareSet: string;
  handleHeight: number | null;
  backset: number | null;
  hingePositions: string; // comma list, mm from bottom of leaf to hinge centre
  pivotOffset: number | null;
  // installation
  threshold: string;
  floorFinish: string;
  // references and workflow
  sourceRef: string;
  specRef: string;
  revision: string;
  remarks: string;
  categoryIds: string[];
  status: DoorStatus;
  comments: Comment[];
  history: ChangeRecord[];
}

export interface Building {
  id: string;
  name: string;
}

export interface Floor {
  id: string;
  buildingId: string;
  name: string;
  order: number;
}

export interface Category {
  id: string;
  name: string;
}

export interface HardwareItem {
  item: string;
  qty: number;
  basis: 'per-door' | 'per-leaf';
  manufacturer: string;
  model: string;
  finish: string;
}

export interface HardwareSet {
  code: string;
  description: string;
  items: HardwareItem[];
}

export interface Revision {
  rev: string;
  date: string;
  description: string;
  by: string;
}

export interface Project {
  id: string;
  name: string;
  number: string;
  client: string;
  consultant: string;
  location: string;
  drawingPrefix: string;
  revision: string;
  date: string;
  status: string;
  preparedBy: string;
  checkedBy: string;
  approvedBy: string;
  isSample: boolean;
  buildings: Building[];
  floors: Floor[];
  categories: Category[];
  hardwareSets: HardwareSet[];
  revisions: Revision[];
  doors: Door[];
}

export const CONFIG_LABEL: Record<Configuration, string> = {
  single: 'Single leaf',
  'double-equal': 'Double leaf (equal)',
  'double-unequal': 'Double leaf (unequal)',
  'double-action-single': 'Double-action single',
  'double-action-pair': 'Double-action pair',
  pivot: 'Pivot',
  'sliding-single': 'Sliding single',
  'sliding-double': 'Sliding double',
  pocket: 'Pocket',
};

export function leafCount(c: Configuration | ''): number {
  return c === 'double-equal' || c === 'double-unequal' || c === 'double-action-pair' || c === 'sliding-double' ? 2 : 1;
}

export function isSwing(c: Configuration | ''): boolean {
  return c === 'single' || c === 'double-equal' || c === 'double-unequal' || c === 'pivot' || c === 'double-action-single' || c === 'double-action-pair';
}

export function isSliding(c: Configuration | ''): boolean {
  return c === 'sliding-single' || c === 'sliding-double' || c === 'pocket';
}
