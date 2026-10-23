import type { CatalogueItem, Configuration, HardwareCategory, MaterialItem, MaterialKind, Project } from './types.js';
import { uid } from './defaults.js';

// DOCHS reference library: generic door types, materials, finishes and hardware
// types with their function. These are descriptions of product *types*, not
// manufacturer data: nothing here states a tested rating, size or model. Items
// copied into a project are marked unverified until a real product is entered.

export type Performance = 'non-fr' | 'fr' | 'acoustic' | 'fr-acoustic';

export interface DoorStyle {
  key: string;
  name: string;
  group: string;
  description: string;
  configurations: Configuration[];
  performance: Performance[];
  leaf: string; // material library names (reference names below)
  core: string;
  facing: string;
  finish: string;
  frame: string;
  frameFinish: string;
  glazed: 'none' | 'optional' | 'full';
}

const SWING: Configuration[] = ['single', 'double-equal', 'double-unequal'];
const ALL_SWING: Configuration[] = [...SWING, 'double-action-single', 'double-action-pair'];

export const DOOR_STYLES: DoorStyle[] = [
  { key: 'timber-flush', name: 'Timber flush door', group: 'Timber', description: 'Flush leaf with a timber-based core and veneer, laminate or paint-grade facing. The general interior door.', configurations: ALL_SWING, performance: ['non-fr', 'acoustic'], leaf: 'Timber', core: 'Particleboard core', facing: 'Timber veneer', finish: 'Clear lacquer', frame: 'Timber frame', frameFinish: 'Clear lacquer', glazed: 'optional' },
  { key: 'timber-fr', name: 'Fire-rated timber door', group: 'Fire-rated', description: 'Timber door assembly with a fire-resisting core, intumescent seals and certified hardware. Rating comes from the tested assembly, not the leaf alone.', configurations: SWING, performance: ['fr', 'fr-acoustic'], leaf: 'Timber', core: 'Fire-resisting mineral core', facing: 'Timber veneer', finish: 'Clear lacquer', frame: 'Timber frame', frameFinish: 'Clear lacquer', glazed: 'optional' },
  { key: 'timber-acoustic', name: 'Acoustic timber door', group: 'Acoustic', description: 'Heavy, dense leaf with acoustic core, perimeter seals and an automatic drop seal. Performance depends on the full tested set incl. frame and seals.', configurations: SWING, performance: ['acoustic', 'fr-acoustic'], leaf: 'Timber', core: 'Acoustic core', facing: 'Timber veneer', finish: 'Clear lacquer', frame: 'Timber frame', frameFinish: 'Clear lacquer', glazed: 'optional' },
  { key: 'timber-panelled', name: 'Solid timber panelled door', group: 'Timber', description: 'Stile-and-rail construction with raised or flat panels, usually solid hardwood.', configurations: SWING, performance: ['non-fr'], leaf: 'Solid hardwood', core: 'Stile and rail', facing: 'Solid timber', finish: 'Stain and lacquer', frame: 'Timber frame', frameFinish: 'Stain and lacquer', glazed: 'optional' },
  { key: 'laminate', name: 'Laminate (HPL) faced door', group: 'Timber', description: 'Flush door faced with high-pressure laminate for hard-wearing areas such as corridors, healthcare and education.', configurations: ALL_SWING, performance: ['non-fr', 'fr', 'acoustic'], leaf: 'Timber', core: 'Particleboard core', facing: 'High-pressure laminate (HPL)', finish: 'HPL integral finish', frame: 'Timber frame', frameFinish: 'Paint', glazed: 'optional' },
  { key: 'steel', name: 'Steel (hollow metal) door', group: 'Metal', description: 'Pressed steel leaf in a pressed steel frame for back-of-house, plant rooms and stairs.', configurations: SWING, performance: ['non-fr', 'fr', 'acoustic', 'fr-acoustic'], leaf: 'Steel', core: 'Honeycomb core', facing: 'Steel sheet', finish: 'Powder coat', frame: 'Pressed steel frame', frameFinish: 'Powder coat', glazed: 'optional' },
  { key: 'steel-fr', name: 'Fire-rated steel door', group: 'Fire-rated', description: 'Steel door assembly with a mineral or fire-rated infill, for stairs, risers and compartment walls.', configurations: SWING, performance: ['fr', 'fr-acoustic'], leaf: 'Steel', core: 'Fire-resisting mineral core', facing: 'Steel sheet', finish: 'Powder coat', frame: 'Pressed steel frame', frameFinish: 'Powder coat', glazed: 'optional' },
  { key: 'stainless', name: 'Stainless steel door', group: 'Metal', description: 'Stainless steel faced leaf for kitchens, labs, cleanrooms and feature entrances.', configurations: SWING, performance: ['non-fr', 'fr'], leaf: 'Stainless steel', core: 'Honeycomb core', facing: 'Stainless steel sheet', finish: 'Brushed (satin) stainless', frame: 'Stainless steel frame', frameFinish: 'Brushed (satin) stainless', glazed: 'optional' },
  { key: 'aluminium', name: 'Aluminium glazed door', group: 'Aluminium & glass', description: 'Aluminium stile-and-rail door with glazed infill, typical at entrances and shopfronts.', configurations: [...SWING, 'sliding-single', 'sliding-double'], performance: ['non-fr'], leaf: 'Aluminium', core: 'Glazed infill', facing: 'Aluminium profile', finish: 'Anodised', frame: 'Aluminium frame', frameFinish: 'Anodised', glazed: 'full' },
  { key: 'glass-frameless', name: 'Frameless glass door', group: 'Aluminium & glass', description: 'All-glass leaf on patch fittings or floor spring, for offices and retail.', configurations: ['single', 'double-equal', 'double-action-single', 'double-action-pair', 'sliding-single', 'sliding-double'], performance: ['non-fr'], leaf: 'Toughened glass', core: 'None (monolithic glass)', facing: 'Glass', finish: 'Clear glass', frame: 'Aluminium frame', frameFinish: 'Anodised', glazed: 'full' },
  { key: 'glass-fr', name: 'Fire-rated glazed door', group: 'Fire-rated', description: 'Framed door with fire-resisting glass. Glass type, frame and size must come from one tested system.', configurations: SWING, performance: ['fr'], leaf: 'Steel', core: 'Glazed infill', facing: 'Steel profile', finish: 'Powder coat', frame: 'Pressed steel frame', frameFinish: 'Powder coat', glazed: 'full' },
  { key: 'stone', name: 'Stone-clad door', group: 'Feature', description: 'Leaf clad in thin stone veneer on a lightweight substrate, usually on heavy pivots, for lobbies and concealed doors.', configurations: ['single', 'pivot'], performance: ['non-fr'], leaf: 'Stone-clad', core: 'Aluminium honeycomb', facing: 'Stone veneer', finish: 'Honed stone', frame: 'Concealed frame', frameFinish: 'Paint', glazed: 'none' },
  { key: 'pivot', name: 'Pivot door', group: 'Feature', description: 'Large or heavy leaf turning on a floor pivot / floor spring instead of hinges.', configurations: ['pivot'], performance: ['non-fr'], leaf: 'Timber', core: 'Particleboard core', facing: 'Timber veneer', finish: 'Clear lacquer', frame: 'Concealed frame', frameFinish: 'Paint', glazed: 'optional' },
  { key: 'sliding', name: 'Sliding / pocket door', group: 'Feature', description: 'Top-hung sliding leaf on a track, surface mounted or into a wall pocket.', configurations: ['sliding-single', 'sliding-double', 'pocket'], performance: ['non-fr'], leaf: 'Timber', core: 'Particleboard core', facing: 'Timber veneer', finish: 'Clear lacquer', frame: 'Timber frame', frameFinish: 'Paint', glazed: 'optional' },
  { key: 'flush-concealed', name: 'Flush concealed (invisible) door', group: 'Feature', description: 'Leaf finished flush with the wall on concealed hinges and a hidden frame.', configurations: ['single'], performance: ['non-fr', 'fr'], leaf: 'Timber', core: 'Particleboard core', facing: 'Paint-grade MDF', finish: 'Paint', frame: 'Concealed frame', frameFinish: 'Paint', glazed: 'none' },
];

// ---------- materials and finishes ----------

interface RefMaterial { kind: MaterialKind; name: string; note: string }

export const REFERENCE_MATERIALS: RefMaterial[] = [
  // leaf materials / systems
  { kind: 'leaf', name: 'Timber', note: 'Timber-based leaf (engineered core with lipped edges).' },
  { kind: 'leaf', name: 'Solid hardwood', note: 'Solid timber stile-and-rail leaf.' },
  { kind: 'leaf', name: 'Steel', note: 'Pressed / hollow metal steel leaf.' },
  { kind: 'leaf', name: 'Stainless steel', note: 'Stainless steel faced leaf.' },
  { kind: 'leaf', name: 'Aluminium', note: 'Aluminium stile-and-rail leaf.' },
  { kind: 'leaf', name: 'Toughened glass', note: 'Monolithic toughened safety glass leaf.' },
  { kind: 'leaf', name: 'Stone-clad', note: 'Thin stone veneer on a lightweight substrate.' },
  // cores
  { kind: 'core', name: 'Particleboard core', note: 'Solid particleboard / chipboard core, general purpose.' },
  { kind: 'core', name: 'Solid timber core', note: 'Laminated timber block core.' },
  { kind: 'core', name: 'Fire-resisting mineral core', note: 'Non-combustible mineral core used in fire-rated assemblies.' },
  { kind: 'core', name: 'Acoustic core', note: 'Dense / layered core for sound reduction.' },
  { kind: 'core', name: 'Honeycomb core', note: 'Lightweight honeycomb core (paper or aluminium).' },
  { kind: 'core', name: 'Aluminium honeycomb', note: 'Lightweight rigid substrate for stone or metal cladding.' },
  { kind: 'core', name: 'Stile and rail', note: 'Framed construction with panels.' },
  { kind: 'core', name: 'Glazed infill', note: 'Glass infill within a framed leaf.' },
  { kind: 'core', name: 'None (monolithic glass)', note: 'Single glass pane, no core.' },
  // facings
  { kind: 'facing', name: 'Timber veneer', note: 'Natural wood veneer (oak, walnut, ash, etc.).' },
  { kind: 'facing', name: 'High-pressure laminate (HPL)', note: 'Hard-wearing decorative laminate.' },
  { kind: 'facing', name: 'Paint-grade MDF', note: 'MDF skin for a painted finish.' },
  { kind: 'facing', name: 'Solid timber', note: 'Exposed solid timber.' },
  { kind: 'facing', name: 'Steel sheet', note: 'Galvanised steel skin.' },
  { kind: 'facing', name: 'Stainless steel sheet', note: 'Stainless steel skin.' },
  { kind: 'facing', name: 'Aluminium profile', note: 'Extruded aluminium sections.' },
  { kind: 'facing', name: 'Steel profile', note: 'Steel glazing sections.' },
  { kind: 'facing', name: 'Glass', note: 'Exposed glass face.' },
  { kind: 'facing', name: 'Stone veneer', note: 'Thin natural stone facing.' },
  // finishes
  { kind: 'finish', name: 'Clear lacquer', note: 'Clear lacquer over natural veneer.' },
  { kind: 'finish', name: 'Stain and lacquer', note: 'Stained timber with a lacquer topcoat.' },
  { kind: 'finish', name: 'Paint', note: 'Painted finish (colour by reference code).' },
  { kind: 'finish', name: 'HPL integral finish', note: 'Laminate colour / pattern, no further finish.' },
  { kind: 'finish', name: 'Powder coat', note: 'Polyester powder coating (RAL or similar code).' },
  { kind: 'finish', name: 'Anodised', note: 'Anodised aluminium (natural or coloured).' },
  { kind: 'finish', name: 'Brushed (satin) stainless', note: 'Satin / brushed stainless steel.' },
  { kind: 'finish', name: 'Mirror stainless', note: 'Polished stainless steel.' },
  { kind: 'finish', name: 'PVD coated', note: 'PVD colour coating on stainless (brass, bronze, black, etc.).' },
  { kind: 'finish', name: 'Honed stone', note: 'Matt honed stone surface.' },
  { kind: 'finish', name: 'Polished stone', note: 'Gloss polished stone surface.' },
  { kind: 'finish', name: 'Clear glass', note: 'Clear glass, no applied finish.' },
  { kind: 'finish', name: 'Frosted / acid-etched glass', note: 'Obscured glass for privacy.' },
  // frames
  { kind: 'frame', name: 'Timber frame', note: 'Hardwood or engineered timber lining / frame.' },
  { kind: 'frame', name: 'Pressed steel frame', note: 'Pressed / hollow metal steel frame.' },
  { kind: 'frame', name: 'Stainless steel frame', note: 'Stainless steel frame.' },
  { kind: 'frame', name: 'Aluminium frame', note: 'Extruded aluminium frame.' },
  { kind: 'frame', name: 'Concealed frame', note: 'Hidden / flush-to-wall frame system.' },
  // glazing
  { kind: 'glazing', name: 'Clear toughened glass', note: 'Toughened safety glass.' },
  { kind: 'glazing', name: 'Laminated safety glass', note: 'Laminated glass, holds together when broken.' },
  { kind: 'glazing', name: 'Fire-resisting glass', note: 'Glass from a fire-tested system; rating per tested assembly.' },
  { kind: 'glazing', name: 'Acoustic laminated glass', note: 'Laminated glass with an acoustic interlayer.' },
  { kind: 'glazing', name: 'Wired glass', note: 'Glass with embedded wire mesh.' },
  { kind: 'glazing', name: 'Obscured glass', note: 'Patterned / frosted glass for privacy.' },
];

// ---------- hardware types ----------

export interface HardwareType { category: HardwareCategory; name: string; func: string; powered?: boolean }

export const HARDWARE_TYPES: HardwareType[] = [
  // hinges
  { category: 'hinge', name: 'Butt hinge', func: 'Standard leaf-to-frame hinge, usually 3 per leaf (4 for tall or heavy leaves).' },
  { category: 'hinge', name: 'Ball-bearing butt hinge', func: 'Butt hinge with bearings for heavy or high-use doors and doors with closers.' },
  { category: 'hinge', name: 'Concealed hinge', func: 'Hidden inside leaf and frame when closed; for flush and invisible doors.' },
  { category: 'hinge', name: 'Spring hinge', func: 'Self-closing hinge with a built-in spring.' },
  { category: 'hinge', name: 'Double-action spring hinge', func: 'Lets the leaf swing both ways and return to centre.' },
  { category: 'hinge', name: 'Rising butt hinge', func: 'Leaf lifts as it opens and closes by gravity; clears carpets.' },
  { category: 'hinge', name: 'Continuous (piano) hinge', func: 'Full-height hinge for heavy-duty or high-abuse doors.' },
  { category: 'hinge', name: 'Electric power-transfer hinge', func: 'Hinge with wiring through it to power locks / readers in the leaf.', powered: true },
  { category: 'pivot', name: 'Floor pivot', func: 'Bottom pivot carrying the leaf weight.' },
  { category: 'pivot', name: 'Top pivot', func: 'Top locating pivot used with a floor pivot or floor spring.' },
  { category: 'pivot', name: 'Offset pivot set', func: 'Pivots set in from the leaf edge, for heavy or tall leaves.' },
  // locks and latches
  { category: 'lock', name: 'Tubular latch', func: 'Holds the door closed; operated by lever both sides. No locking (passage).' },
  { category: 'lock', name: 'Mortice sashlock', func: 'Latch plus key-operated deadbolt (office / entrance function).' },
  { category: 'lock', name: 'Mortice deadlock', func: 'Key-operated deadbolt only; door held by a separate latch or closer.' },
  { category: 'lock', name: 'Bathroom / privacy lock', func: 'Latch plus thumbturn bolt inside and emergency release outside.' },
  { category: 'lock', name: 'Night latch (rim)', func: 'Surface-mounted latch, key outside, knob inside.' },
  { category: 'lock', name: 'Storeroom lock', func: 'Outside lever always locked; key to enter; free exit inside.' },
  { category: 'lock', name: 'Classroom lock', func: 'Outside lever locked or unlocked by key from outside.' },
  { category: 'lock', name: 'Electromechanical mortice lock', func: 'Mortice lock released electrically (fail-safe or fail-secure).', powered: true },
  { category: 'lock', name: 'Electric strike', func: 'Frame keep that releases the latch electrically.', powered: true },
  { category: 'lock', name: 'Electromagnetic lock', func: 'Magnet on frame holding an armature on the leaf; releases when power is cut.', powered: true },
  { category: 'lock', name: 'Hook lock (sliding)', func: 'Hook bolt for sliding and pocket doors.' },
  // cylinders
  { category: 'cylinder', name: 'Euro double cylinder', func: 'Key both sides.' },
  { category: 'cylinder', name: 'Euro cylinder and thumbturn', func: 'Key outside, thumbturn inside (escape without key).' },
  { category: 'cylinder', name: 'Euro single cylinder', func: 'Key one side only (e.g. with exit devices).' },
  { category: 'cylinder', name: 'Rim cylinder', func: 'For night latches and rim exit devices.' },
  { category: 'cylinder', name: 'Master-keyed cylinder', func: 'Part of a master key system with grand master / master / change keys.' },
  // handles
  { category: 'handle', name: 'Lever on round rose', func: 'Lever handle on a round rose; operates latches and sashlocks.' },
  { category: 'handle', name: 'Lever on backplate', func: 'Lever on a full backplate with keyhole / cylinder cut-out.' },
  { category: 'handle', name: 'Knob set', func: 'Turning knob (check accessibility requirements before use).' },
  { category: 'handle', name: 'Fixed / dummy lever', func: 'Non-operating lever used as a pull.' },
  { category: 'pull', name: 'Pull handle (D / bar)', func: 'Fixed pull on the pull side of push/pull doors.' },
  { category: 'pull', name: 'Back-to-back pull handles', func: 'Pull handles on both faces, e.g. glass and pivot doors.' },
  { category: 'pull', name: 'Push plate', func: 'Plate on the push side to protect the leaf.' },
  { category: 'pull', name: 'Flush pull', func: 'Recessed pull for sliding and pocket doors.' },
  // closers
  { category: 'closer', name: 'Overhead closer (scissor arm)', func: 'Surface closer with a projecting arm; returns the door closed.' },
  { category: 'closer', name: 'Overhead closer (slide arm)', func: 'Surface closer with a slide channel; neater look.' },
  { category: 'closer', name: 'Concealed overhead closer', func: 'Closer hidden in the leaf / frame head.' },
  { category: 'closer', name: 'Floor spring', func: 'Closer in the floor below a pivoting leaf; single or double action.' },
  { category: 'closer', name: 'Electromagnetic hold-open closer', func: 'Holds the door open; releases on fire alarm.', powered: true },
  { category: 'closer', name: 'Automatic door operator', func: 'Powered opening (swing or sliding), push-button or sensor activated.', powered: true },
  // panic / exit
  { category: 'panic', name: 'Panic bar (push bar)', func: 'Horizontal bar across the leaf releasing the latch: emergency exit by untrained public.' },
  { category: 'panic', name: 'Touch bar exit device', func: 'Flat touch-bar version of a panic exit device.' },
  { category: 'panic', name: 'Vertical rod exit device', func: 'Exit device throwing bolts top and bottom, typical on pairs.' },
  { category: 'panic', name: 'Emergency push pad', func: 'Push pad releasing the lock for trained occupants (emergency exit).' },
  // bolts and coordinators
  { category: 'flush-bolt', name: 'Manual flush bolt', func: 'Hand-operated bolt in the edge of the inactive leaf of a pair.' },
  { category: 'flush-bolt', name: 'Automatic flush bolt', func: 'Bolt that throws automatically when the active leaf closes.' },
  { category: 'coordinator', name: 'Door selector / coordinator', func: 'Makes the leaves of a pair close in the right order.' },
  // seals and thresholds
  { category: 'seal', name: 'Perimeter seal', func: 'Weather / draught / acoustic seal in the frame rebate.' },
  { category: 'seal', name: 'Intumescent seal', func: 'Expands in fire to close the leaf-to-frame gap.' },
  { category: 'seal', name: 'Smoke seal', func: 'Brush or blade seal limiting smoke leakage.' },
  { category: 'seal', name: 'Automatic drop seal', func: 'Seal that drops to the floor as the door closes (acoustic / smoke).' },
  { category: 'seal', name: 'Meeting stile seal', func: 'Seal between the leaves of a pair.' },
  { category: 'threshold', name: 'Flush threshold plate', func: 'Level threshold under the leaf.' },
  { category: 'threshold', name: 'Weather bar / sill', func: 'External threshold shedding water.' },
  { category: 'threshold', name: 'Acoustic threshold', func: 'Raised threshold for acoustic doors.' },
  // stops and protection
  { category: 'stop', name: 'Floor stop', func: 'Stops the leaf hitting walls.' },
  { category: 'stop', name: 'Wall stop', func: 'Wall-mounted buffer.' },
  { category: 'stop', name: 'Overhead stop / holder', func: 'Limits opening and can hold the door open.' },
  { category: 'protection', name: 'Kick plate', func: 'Protects the bottom of the leaf.' },
  { category: 'protection', name: 'Armour plate', func: 'Taller protection plate for trolley / high-abuse areas.' },
  { category: 'protection', name: 'Edge guard', func: 'Protects leaf edges from impact.' },
  // access control and electrical
  { category: 'access-control', name: 'Card / fob reader', func: 'Reads credentials to release the lock.', powered: true },
  { category: 'access-control', name: 'Keypad', func: 'PIN entry to release the lock.', powered: true },
  { category: 'access-control', name: 'Door position contact', func: 'Reports door open / closed to security.', powered: true },
  { category: 'access-control', name: 'Request-to-exit button', func: 'Releases the lock from the secure side.', powered: true },
  { category: 'access-control', name: 'Emergency break-glass unit', func: 'Cuts power to a fail-safe lock in an emergency.', powered: true },
  { category: 'electrical', name: 'Power supply unit', func: 'Supplies electric locks / readers.', powered: true },
  { category: 'electrical', name: 'Power transfer loop', func: 'Exposed cable loop from frame to leaf.', powered: true },
  // sliding gear
  { category: 'sliding-gear', name: 'Top-hung sliding track', func: 'Overhead track and hangers carrying a sliding leaf.' },
  { category: 'sliding-gear', name: 'Soft-close damper', func: 'Slows and closes a sliding leaf at the end of travel.' },
  { category: 'sliding-gear', name: 'Floor guide', func: 'Keeps a sliding leaf in line at the bottom.' },
];

// ---------- hardware functions (presets for the designer) ----------

export interface HardwareFunction {
  key: string;
  name: string;
  description: string;
  lines: { type: string; qty: number; basis: 'per-door' | 'per-leaf' }[];
  accessControl?: boolean;
}

export const HARDWARE_FUNCTIONS: HardwareFunction[] = [
  { key: 'passage', name: 'Passage', description: 'Latch only, no locking. Corridors, meeting rooms.', lines: [{ type: 'Tubular latch', qty: 1, basis: 'per-door' }, { type: 'Lever on round rose', qty: 1, basis: 'per-door' }, { type: 'Floor stop', qty: 1, basis: 'per-door' }] },
  { key: 'privacy', name: 'Privacy (WC / bathroom)', description: 'Thumbturn inside, emergency release outside.', lines: [{ type: 'Bathroom / privacy lock', qty: 1, basis: 'per-door' }, { type: 'Lever on round rose', qty: 1, basis: 'per-door' }, { type: 'Wall stop', qty: 1, basis: 'per-door' }] },
  { key: 'office', name: 'Office (lockable)', description: 'Lever both sides, key-locked deadbolt.', lines: [{ type: 'Mortice sashlock', qty: 1, basis: 'per-door' }, { type: 'Euro cylinder and thumbturn', qty: 1, basis: 'per-door' }, { type: 'Lever on round rose', qty: 1, basis: 'per-door' }, { type: 'Floor stop', qty: 1, basis: 'per-door' }] },
  { key: 'storeroom', name: 'Storeroom', description: 'Always locked outside, key to enter.', lines: [{ type: 'Storeroom lock', qty: 1, basis: 'per-door' }, { type: 'Euro single cylinder', qty: 1, basis: 'per-door' }, { type: 'Lever on round rose', qty: 1, basis: 'per-door' }] },
  { key: 'fire-closer', name: 'Fire door with closer', description: 'Self-closing, latching; seals for fire / smoke.', lines: [{ type: 'Mortice sashlock', qty: 1, basis: 'per-door' }, { type: 'Lever on round rose', qty: 1, basis: 'per-door' }, { type: 'Overhead closer (slide arm)', qty: 1, basis: 'per-leaf' }, { type: 'Intumescent seal', qty: 1, basis: 'per-door' }, { type: 'Smoke seal', qty: 1, basis: 'per-door' }] },
  { key: 'exit', name: 'Emergency exit', description: 'Panic hardware for public escape routes.', lines: [{ type: 'Panic bar (push bar)', qty: 1, basis: 'per-leaf' }, { type: 'Overhead closer (scissor arm)', qty: 1, basis: 'per-leaf' }, { type: 'Floor stop', qty: 1, basis: 'per-door' }] },
  { key: 'access', name: 'Access controlled', description: 'Card reader, electric lock, contact and exit button.', accessControl: true, lines: [{ type: 'Electromechanical mortice lock', qty: 1, basis: 'per-door' }, { type: 'Lever on backplate', qty: 1, basis: 'per-door' }, { type: 'Card / fob reader', qty: 1, basis: 'per-door' }, { type: 'Door position contact', qty: 1, basis: 'per-door' }, { type: 'Request-to-exit button', qty: 1, basis: 'per-door' }, { type: 'Electric power-transfer hinge', qty: 1, basis: 'per-door' }, { type: 'Overhead closer (slide arm)', qty: 1, basis: 'per-door' }] },
  { key: 'push-pull', name: 'Push / pull', description: 'No latch; pull handle and push plate with closer.', lines: [{ type: 'Pull handle (D / bar)', qty: 1, basis: 'per-leaf' }, { type: 'Push plate', qty: 1, basis: 'per-leaf' }, { type: 'Overhead closer (slide arm)', qty: 1, basis: 'per-leaf' }] },
  { key: 'sliding', name: 'Sliding', description: 'Track, pulls and hook lock.', lines: [{ type: 'Top-hung sliding track', qty: 1, basis: 'per-door' }, { type: 'Flush pull', qty: 2, basis: 'per-leaf' }, { type: 'Soft-close damper', qty: 1, basis: 'per-leaf' }] },
  { key: 'none', name: 'No hardware set yet', description: 'Assign later.', lines: [] },
];

export const HINGE_CHOICES = ['Butt hinge', 'Ball-bearing butt hinge', 'Concealed hinge', 'Rising butt hinge', 'Continuous (piano) hinge', 'Spring hinge'];

// ---------- copy into a project ----------

const blankCatalogue = (t: HardwareType): CatalogueItem => ({
  id: uid('cat'), category: t.category, manufacturer: '', model: '', description: t.name, finish: '', dimensions: '', mounting: '', fireRated: '',
  powered: Boolean(t.powered), sourceRef: '', verified: false, notes: `DOCHS reference type: ${t.func}`,
});

const blankMaterial = (m: RefMaterial): MaterialItem => ({
  id: uid('mat'), kind: m.kind, name: m.name, manufacturer: '', product: '', code: '', thickness: null, fireRated: '', fireRating: '', acoustic: '',
  sourceRef: '', approvalRef: '', approval: '', verified: false, notes: `DOCHS reference type: ${m.note}`,
});

// Returns the project with the named reference hardware types present in the
// catalogue (matched by description), plus the catalogue ids by type name.
export function ensureHardwareTypes(p: Project, names: string[]): { project: Project; ids: Record<string, string> } {
  const catalogue = [...p.catalogue];
  const ids: Record<string, string> = {};
  for (const n of names) {
    let c = catalogue.find((x) => x.description.toLowerCase() === n.toLowerCase());
    if (!c) {
      const t = HARDWARE_TYPES.find((x) => x.name === n);
      if (!t) throw new Error(`Unknown hardware type ${n}`);
      c = blankCatalogue(t);
      catalogue.push(c);
    }
    ids[n] = c.id;
  }
  return { project: { ...p, catalogue }, ids };
}

export function ensureMaterials(p: Project, wanted: { kind: MaterialKind; name: string }[]): { project: Project; ids: Record<string, string> } {
  const materials = [...p.materials];
  const ids: Record<string, string> = {};
  for (const w of wanted) {
    if (!w.name) continue;
    let m = materials.find((x) => x.kind === w.kind && x.name.toLowerCase() === w.name.toLowerCase());
    if (!m) {
      const ref = REFERENCE_MATERIALS.find((x) => x.kind === w.kind && x.name === w.name) ?? { kind: w.kind, name: w.name, note: 'Added from Door Designer.' };
      m = blankMaterial(ref);
      materials.push(m);
    }
    ids[`${w.kind}|${w.name}`] = m.id;
  }
  return { project: { ...p, materials }, ids };
}

// Adds every reference item not already present (by name) to the project libraries.
export function installReference(p: Project, what: { hardware?: boolean; materials?: boolean }): { project: Project; added: number } {
  let added = 0;
  let next = p;
  if (what.hardware) {
    const missing = HARDWARE_TYPES.filter((t) => !next.catalogue.some((c) => c.description.toLowerCase() === t.name.toLowerCase()));
    next = { ...next, catalogue: [...next.catalogue, ...missing.map(blankCatalogue)] };
    added += missing.length;
  }
  if (what.materials) {
    const missing = REFERENCE_MATERIALS.filter((m) => !next.materials.some((x) => x.kind === m.kind && x.name.toLowerCase() === m.name.toLowerCase()));
    next = { ...next, materials: [...next.materials, ...missing.map(blankMaterial)] };
    added += missing.length;
  }
  return { project: next, added };
}
