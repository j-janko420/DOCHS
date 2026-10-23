import type { DoorStatus, Project } from './types.js';
import { blankProject, sampleProject } from './defaults.js';
import { addDesignedDoor, applyStyle, defaultDesign, withPerformance, type DesignInput } from './designer.js';
import type { Performance } from './reference.js';
import { csvRows, importRows } from './importer.js';

// Sample projects for the demo. All names, rooms and references are invented
// and anonymised; values are illustrative, not project or manufacturer data.

interface Spec { mark: string; floor: number; room: string; style: string; config: DesignInput['configuration']; w: number; h: number; perf: Performance; fr?: string; ac?: string; fn: string; handing?: DesignInput['handing']; vision?: DesignInput['vision']; status?: DoorStatus; qty?: number }

function build(p0: Project, specs: Spec[]): Project {
  let p = p0;
  const floors = p.floors.slice().sort((a, b) => a.order - b.order);
  for (const s of specs) {
    let i = applyStyle({ ...defaultDesign(), soWidth: s.w, soHeight: s.h, wallThickness: 200 }, s.style);
    i = withPerformance({ ...i, configuration: s.config, handing: s.handing ?? 'LH', vision: s.vision ?? i.vision, hardwareFunction: s.fn }, s.perf);
    i = { ...i, fireRating: s.fr ?? i.fireRating, acousticRating: s.ac ?? i.acousticRating, hardwareFunction: s.fn };
    const f = floors[s.floor];
    const r = addDesignedDoor(p, i, { mark: s.mark, buildingId: f.buildingId, floorId: f.id, room: s.room, quantity: s.qty ?? 1 });
    p = { ...r.project, doors: r.project.doors.map((d) => (d.id === r.door.id ? { ...d, status: s.status ?? 'draft', sourceRef: 'Sample', location: s.room } : d)) };
  }
  return p;
}

export function sampleHospitality(): Project {
  const base = blankProject('Sample Hospitality Level (anonymised)');
  const b = base.buildings[0];
  const p0: Project = {
    ...base, id: 'prj_sample_hosp', number: 'SAMPLE-HOSP', client: 'Sample hospitality client', consultant: 'Sample interior designer', location: '-', drawingPrefix: 'HSP', isSample: true,
    buildings: [{ ...b, name: 'Tower' }],
    floors: [{ id: 'flr_hosp_31', buildingId: b.id, name: 'Level 31', order: 31 }, { id: 'flr_hosp_32', buildingId: b.id, name: 'Level 32', order: 32 }],
    categories: [{ id: 'cat_foh', name: 'Front of house' }, { id: 'cat_boh', name: 'Back of house' }],
  };
  const p = build(p0, [
    { mark: 'L32-301', floor: 1, room: 'Lift lobby 1 to guest corridor', style: 'timber-fr', config: 'double-equal', w: 1800, h: 2400, perf: 'fr', fr: '60 min', fn: 'fire-closer', vision: 'standard', status: 'approved' },
    { mark: 'L32-303', floor: 1, room: 'Lift lobby 2 to guest corridor', style: 'timber-fr', config: 'double-equal', w: 1800, h: 2400, perf: 'fr', fr: '60 min', fn: 'fire-closer', vision: 'standard', status: 'for-review' },
    { mark: 'L32-102', floor: 1, room: 'Guest corridor to private lounge', style: 'timber-acoustic', config: 'single', w: 1100, h: 2600, perf: 'acoustic', ac: '40 dB', fn: 'office', handing: 'RH' },
    { mark: 'L32-201', floor: 1, room: 'Guest corridor to stair 1', style: 'steel-fr', config: 'single', w: 1100, h: 2200, perf: 'fr', fr: '90 min', fn: 'exit', status: 'for-review' },
    { mark: 'L32-104', floor: 1, room: 'Guest corridor to service corridor', style: 'laminate', config: 'double-unequal', w: 1500, h: 2400, perf: 'non-fr', fn: 'push-pull', handing: 'LHR' },
    { mark: 'L32-023', floor: 1, room: 'Guest corridor to gaming room 3', style: 'timber-acoustic', config: 'single', w: 1200, h: 2700, perf: 'acoustic', ac: '40 dB', fn: 'access' },
    { mark: 'L32-313', floor: 1, room: 'Guest corridor to private suite', style: 'sliding', config: 'sliding-double', w: 2200, h: 2700, perf: 'non-fr', fn: 'sliding' },
    { mark: 'L32-030', floor: 1, room: 'Lobby feature door', style: 'stone', config: 'pivot', w: 1300, h: 2900, perf: 'non-fr', fn: 'push-pull' },
    { mark: 'L32-025', floor: 1, room: 'Reception to office', style: 'glass-frameless', config: 'single', w: 1000, h: 2400, perf: 'non-fr', fn: 'access', handing: 'RH' },
    { mark: 'L32-040', floor: 1, room: 'Corridor to WC', style: 'laminate', config: 'single', w: 950, h: 2200, perf: 'non-fr', fn: 'privacy', qty: 2 },
    { mark: 'L31-012', floor: 0, room: 'Service corridor to plant', style: 'steel', config: 'double-equal', w: 1800, h: 2200, perf: 'non-fr', fn: 'storeroom' },
    { mark: 'L31-015', floor: 0, room: 'Staff corridor to store', style: 'flush-concealed', config: 'single', w: 900, h: 2400, perf: 'non-fr', fn: 'storeroom', handing: 'RH' },
  ]);
  const boh = new Set(['L32-104', 'L32-201', 'L31-012', 'L31-015']);
  return { ...p, doors: p.doors.map((d) => ({ ...d, categoryIds: [boh.has(d.mark) ? 'cat_boh' : 'cat_foh'] })) };
}

// A schedule in imperial units, built through the importer, to show import,
// unit conversion and how missing frame data is flagged rather than invented.
export const SCHOOL_CSV = `NO.,LEVEL,FROM ROOM,TO ROOM,TYPE,LEAVES,WIDTH,HEIGHT,DOOR MATERIAL,FIRE RATING,HARDWARE SET,REMARKS
101,Level 1,Corridor 100,Classroom 101,D2,1,3'-0",7'-0",Wood,,HW-1,
102,Level 1,Corridor 100,Classroom 102,D2,1,3'-0",7'-0",Wood,,HW-1,
103,Level 1,Corridor 100,Stair A,D3,1,3'-0",7'-0",Hollow metal,1 HR,HW-3,Stair door
104,Level 1,Corridor 100,Mechanical,D1,2,72",84",Hollow metal,2H,HW-2,Pair: 2 x 36"
105,Level 1,Classroom 101,Storage 105,D4,1,2'-8",7'-0",Wood,,HW-4,
201,Level 2,Corridor 200,Classroom 201,D2,1,3'-0",7'-0",Wood,,HW-1,
202,Level 2,Corridor 200,Stair A,D3,1,3'-0",7'-0",Hollow metal,90 min,HW-3,
TOTAL,,,,,,,,,,,7 doors`;

export function sampleSchoolImport(): Project {
  const base = blankProject('Sample School Wing (imported, imperial)');
  const p0: Project = { ...base, id: 'prj_sample_school', number: 'SAMPLE-SCH', client: 'Sample school board', drawingPrefix: 'SCH', isSample: true, floors: [] };
  const rows = csvRows(SCHOOL_CSV);
  const map = ['mark', 'floor', 'fromRoom', 'toRoom', 'doorType', 'leaves', 'doorWidth', 'doorHeight', 'leafMaterial', 'fireRating', 'hardwareSet', 'remarks'] as const;
  const r = importRows({ ...p0, floors: [{ id: 'flr_tmp', buildingId: p0.buildings[0].id, name: 'Level 1', order: 0 }] }, rows, {
    fileName: 'sample-school.csv', sheetName: 'Door schedule', headerRow: 0, mapping: [...map], units: 'auto', buildingId: p0.buildings[0].id, defaultFloorId: 'flr_tmp', existing: 'skip',
  });
  return r.project;
}

export const SAMPLES: { key: string; name: string; description: string; build: () => Project }[] = [
  { key: 'office', name: 'Sample Office Building', description: '8 doors over 5 floors: singles, pairs, sliding, pivot, double-action, fire and acoustic.', build: sampleProject },
  { key: 'hospitality', name: 'Sample Hospitality Level (anonymised)', description: '12 doors on two levels: FR lift-lobby pairs, acoustic gaming-room doors, stair doors, sliding suite door, stone pivot, glass door.', build: sampleHospitality },
  { key: 'school', name: 'Sample School Wing (imported, imperial)', description: 'Built by importing a CSV schedule in feet-inches: shows unit conversion and how missing frame data is flagged in QA.', build: sampleSchoolImport },
];
