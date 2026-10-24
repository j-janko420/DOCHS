import type { Door, HardwareItem, Project } from './types.js';
import { leafCount } from './types.js';
import { setFor } from './hardware.js';
import { hardwareCategory } from './intake.js';

// What a door looks like, derived from its record and hardware set: face
// finishes, frame, glazing and the visible hardware with where it sits. The
// renderer draws this; nothing here is invented beyond the stated defaults
// (listed in `assumptions`) used where the record is blank.

export type Surface = 'timber' | 'paint' | 'laminate' | 'glass' | 'metal' | 'stone';
export interface Look { surface: Surface; color: string; frosted?: boolean; label: string }
export type Metal = 'satin' | 'polished' | 'black' | 'brass' | 'bronze' | 'chrome' | 'white' | 'aluminium' | 'grey';
export type HwKind = 'lever' | 'pull' | 'push-plate' | 'kick-plate' | 'closer' | 'panic' | 'hinge' | 'cylinder' | 'thumbturn' | 'card-lock' | 'reader' | 'viewer' | 'flush-bolt' | 'floor-spring' | 'sign' | 'drop-seal' | 'stop' | 'track' | 'indicator';
export type Side = 'outside' | 'inside';

export interface HwVisual { kind: HwKind; side: Side | 'both' | 'edge' | 'wall'; metal: Metal; label: string; qty: number; length?: number; height?: number }

export interface RenderSpec {
  mark: string;
  soW: number; soH: number; // structural opening
  leafW: number[]; // per leaf
  leafH: number;
  T: number;
  fw: number; fd: number; // frame face width, depth
  wallT: number;
  undercut: number;
  frame: Look;
  face: Record<Side, Look>;
  edge: Look;
  vision: { w: number; h: number; fromTop: number; look: Look } | null;
  louvre: { w: number; h: number; fromBottom: number } | null;
  hingeLeftFromOutside: boolean;
  pushSide: Side;
  handleH: number;
  backset: number;
  hinges: number[]; // positions from bottom of leaf
  pair: boolean;
  sliding: boolean;
  hardware: HwVisual[];
  assumptions: string[];
}

const RAL: Record<string, string> = {
  '9010': '#f1ece1', '9016': '#f1f0ea', '9001': '#e9e0d2', '9003': '#f4f4f0', '9005': '#0e0e10', '9006': '#a1a1a0', '9007': '#878581', '7016': '#383e42', '7021': '#2f3234',
  '7035': '#c5c7c4', '7038': '#b0b3af', '7024': '#474a50', '7015': '#51565c', '1013': '#e3d9c6', '1015': '#e6d2b5', '5010': '#0e4c96', '5011': '#1a2b3c', '3000': '#a72920', '6005': '#114232', '8017': '#45322e',
};
const WOOD: [RegExp, string][] = [[/walnut/i, '#6a4630'], [/wenge|ebony/i, '#3b2a20'], [/teak|iroko|cherry/i, '#9a6a3c'], [/mahogany|sapele/i, '#7b3f2a'], [/ash|maple|birch|beech|pine|light oak/i, '#d8b98a'], [/smoked|dark oak/i, '#7d5a3c'], [/oak|veneer|timber|wood|hardwood/i, '#b98a55']];
const NAMED: [RegExp, string][] = [[/white/i, '#f2f1ec'], [/ivory|cream|off.?white|magnolia/i, '#ece4d2'], [/black|anthracite/i, '#232527'], [/charcoal|dark grey|dark gray/i, '#3d4247'], [/light grey|light gray|silver/i, '#c9ccce'], [/grey|gray/i, '#8a8f94'], [/blue|navy/i, '#284a7a'], [/green/i, '#3c6b4f'], [/red/i, '#9b2f2a'], [/beige|sand/i, '#d6c6a8'], [/brown|bronze/i, '#6d4c35']];

export function lookFor(text: string, fallback: Look): Look {
  const t = text.trim();
  if (!t) return fallback;
  if (/glass|glaz|clear|frosted|obscure|sandblast|toughened|laminated glass/i.test(t)) return { surface: 'glass', color: '#b9d6e6', frosted: /frost|obscure|sandblast|satin glass|etched/i.test(t), label: t };
  if (/marble|granite|stone|quartz|terrazzo|porcelain/i.test(t)) return { surface: 'stone', color: /black|nero|dark/i.test(t) ? '#2c2c2e' : /grey|gray/i.test(t) ? '#9b9b98' : '#e3ddd2', label: t };
  if (/stainless|brushed|satin steel|\bss\b|sss|pvd|chrome|alumin|anodi|metal|zinc|brass|bronze|copper/i.test(t) && !/paint|powder/i.test(t)) {
    const c = /brass|gold|champagne/i.test(t) ? '#b8975a' : /bronze|copper/i.test(t) ? '#7a5a3e' : /black/i.test(t) ? '#2a2c2f' : /anodi|alumin/i.test(t) ? '#b9bec4' : '#c4c8cb';
    return { surface: 'metal', color: c, label: t };
  }
  const ral = /RAL\s*(\d{4})/i.exec(t);
  const named = NAMED.find(([re]) => re.test(t))?.[1];
  const color = ral ? RAL[ral[1]] ?? '#d0ccc4' : named;
  if (/lamin|hpl|formica|melamine/i.test(t)) return { surface: 'laminate', color: color ?? WOOD.find(([re]) => re.test(t))?.[1] ?? '#e8e4dc', label: t };
  const wood = WOOD.find(([re]) => re.test(t))?.[1];
  if (wood && !/paint|lacquer.*(white|black|ral)/i.test(t)) return { surface: 'timber', color: wood, label: t };
  if (/paint|lacquer|powder|primer|enamel|coat|ral|mdf/i.test(t) || color) return { surface: 'paint', color: color ?? '#e9e6df', label: t };
  if (/steel/i.test(t)) return { surface: 'paint', color: '#d9dadb', label: t };
  return fallback;
}

export function metalFor(text: string): Metal {
  const t = text.toLowerCase();
  if (/black|blk|\bmb\b|us19|10b|matt?e? black/.test(t)) return 'black';
  if (/brass|gold|us3\b|us4\b|pb\b|champagne/.test(t)) return 'brass';
  if (/bronze|us10|613|oil rubbed/.test(t)) return 'bronze';
  if (/polished|pss|us32\b|chrome|pcp|us26\b/.test(t)) return /chrome|pcp|us26\b/.test(t) ? 'chrome' : 'polished';
  if (/white|ral\s*9016|ral\s*9010/.test(t)) return 'white';
  if (/alumin|anodi|silver|689|us28|sprayed/.test(t)) return 'aluminium';
  if (/grey|gray/.test(t)) return 'grey';
  return 'satin';
}

const mmIn = (s: string): number[] => [...s.matchAll(/(\d{2,4})\s*(?:mm)?/g)].map((m) => Number(m[1]));

function visual(it: HardwareItem, pushSide: Side): HwVisual[] {
  const text = `${it.item} ${it.model}`;
  const cat = hardwareCategory(it.item);
  const metal = metalFor(`${it.finish} ${it.item}`);
  const pull: Side = pushSide === 'outside' ? 'inside' : 'outside';
  const base = { metal, label: it.item, qty: it.qty };
  const t = text.toLowerCase();
  if (/sign|plaque|indicator plate/.test(t)) return [{ ...base, kind: 'sign', side: 'both' }];
  if (/viewer|spy ?hole/.test(t)) return [{ ...base, kind: 'viewer', side: 'both' }];
  switch (cat) {
    case 'hinge': return [{ ...base, kind: 'hinge', side: pull }];
    case 'pivot': return [];
    case 'handle':
      if (/pull/.test(t)) return [{ ...base, kind: 'pull', side: /back.?to.?back|both|pair/.test(t) ? 'both' : pull, length: mmIn(text).find((n) => n >= 150 && n <= 1800) ?? 300 }];
      return [{ ...base, kind: 'lever', side: 'both' }];
    case 'pull':
      if (/push ?plate|finger ?plate/.test(t)) return [{ ...base, kind: 'push-plate', side: pushSide }];
      return [{ ...base, kind: 'pull', side: /back.?to.?back|both/.test(t) ? 'both' : pull, length: mmIn(text).find((n) => n >= 150 && n <= 1800) ?? 300 }];
    case 'lock':
      if (/hotel|card|rfid|electronic lock/.test(t)) return [{ ...base, kind: 'card-lock', side: 'outside' }];
      if (/bathroom|privacy|wc|indicator/.test(t)) return [{ ...base, kind: 'indicator', side: 'outside' }, { ...base, kind: 'thumbturn', side: 'inside' }];
      return [];
    case 'cylinder':
      if (/thumb ?turn/.test(t)) return [{ ...base, kind: 'cylinder', side: 'outside' }, { ...base, kind: 'thumbturn', side: 'inside' }];
      return [{ ...base, kind: 'cylinder', side: /double/.test(t) ? 'both' : 'outside' }];
    case 'closer':
      if (/floor spring/.test(t)) return [{ ...base, kind: 'floor-spring', side: 'both' }];
      if (/concealed|transom|cam ?action|in.?leaf/.test(t)) return [];
      return [{ ...base, kind: 'closer', side: /parallel|push side/.test(t) ? pushSide : pull }];
    case 'panic': return [{ ...base, kind: 'panic', side: pushSide }];
    case 'protection':
      if (/protector/.test(t)) return [];
      return [{ ...base, kind: 'kick-plate', side: it.qty >= 2 && !/pair/.test(t) ? 'both' : pushSide, height: /armou?r/.test(t) ? 900 : mmIn(text).filter((n) => n >= 100 && n <= 1000).sort((a, b) => a - b)[0] ?? 200 }];
    case 'flush-bolt': return [{ ...base, kind: 'flush-bolt', side: 'edge' }];
    case 'access-control': return /reader|keypad/.test(t) ? [{ ...base, kind: 'reader', side: 'wall' }] : [];
    case 'seal': return /drop|automatic|threshold seal/.test(t) ? [{ ...base, kind: 'drop-seal', side: pushSide }] : [];
    case 'stop': return /overhead|holder/.test(t) ? [] : [{ ...base, kind: 'stop', side: pull }];
    case 'sliding-gear': return /track|hanger|gear/.test(t) ? [{ ...base, kind: 'track', side: 'both' }] : [];
    default: return [];
  }
}

export function renderSpec(p: Project, d: Door): RenderSpec {
  const assumptions: string[] = [];
  const n = leafCount(d.configuration);
  const pair = n === 2;
  const fw = d.frameWidth ?? 50, fd = d.frameDepth ?? Math.max(100, d.wallThickness ?? 100);
  const gap = d.installGap ?? 5, rb = d.rebateDepth ?? 15, eg = d.edgeGap ?? 3, uc = d.undercut ?? 8;
  // a blank opening is derived from the stated leaf size (and the other way round), using the frame-fit rule
  const leafSum = pair ? (d.leafWidth1 ?? 0) + (d.leafWidth2 ?? d.leafWidth1 ?? 0) : d.leafWidth1 ?? 0;
  let soW = d.openingWidth ?? 0, soH = d.openingHeight ?? 0;
  if (!soW) { soW = leafSum ? Math.round(leafSum + 2 * gap + 2 * fw - 2 * rb + (n + 1) * eg) : 1000; assumptions.push(leafSum ? `S.O. width blank: ${soW} mm from the leaf width` : 'S.O. width blank: 1000 mm shown'); }
  if (!soH) { soH = d.leafHeight ? Math.round(d.leafHeight + gap + fw - rb + eg + uc) : 2200; assumptions.push(d.leafHeight ? `S.O. height blank: ${soH} mm from the leaf height` : 'S.O. height blank: 2200 mm shown'); }
  const aperture = soW - 2 * gap - 2 * fw;
  const leafW = pair ? [d.leafWidth1 ?? aperture / 2, d.leafWidth2 ?? d.leafWidth1 ?? aperture / 2] : [d.leafWidth1 ?? aperture];
  if (!d.leafWidth1) assumptions.push('Leaf width blank: drawn from the frame aperture');
  const leafH = d.leafHeight ?? soH - gap - fw;
  const T = d.leafThickness ?? (assumptions.push('Leaf thickness blank: 54 mm shown'), 54);
  const mat = (slot: keyof Door['materialIds']) => { const id = d.materialIds?.[slot]; const m = id ? p.materials.find((x) => x.id === id) : undefined; return m ? `${m.name} ${m.code}` : ''; };
  const edge = lookFor(`${mat('leaf')} ${d.leafMaterial} ${d.leafFacing}`, { surface: 'timber', color: '#c9b08a', label: d.leafMaterial || 'leaf' });
  const glassLeaf = /glass/i.test(d.leafMaterial) && !/vision/i.test(d.leafMaterial);
  const faceText = (fin: string, slot: 'finish1' | 'finish2') => `${mat(slot)} ${fin} ${d.leafFacing} ${glassLeaf ? 'glass' : ''}`;
  const face = {
    outside: lookFor(faceText(d.finishSide1, 'finish1'), edge),
    inside: lookFor(faceText(d.finishSide2 || d.finishSide1, 'finish2'), edge),
  };
  if (!d.finishSide1 && !mat('finish1')) assumptions.push('Finish blank: leaf material colour shown');
  const frame = lookFor(`${mat('frameFinish')} ${d.frameFinish} ${mat('frame')} ${d.frameMaterial}`, { surface: 'paint', color: '#d6d8da', label: d.frameMaterial || 'frame' });
  const vision = d.visionPanel ? { w: d.vpWidth ?? 150, h: d.vpHeight ?? 600, fromTop: d.vpFromTop ?? 250, look: lookFor(`${mat('glazing')} ${d.glazingType} glass`, { surface: 'glass', color: '#b9d6e6', label: 'glass' }) } : null;
  const handing = d.handing || 'RH';
  const hingeLeftFromOutside = handing === 'LH' || handing === 'LHR';
  const pushSide: Side = handing.endsWith('R') ? 'inside' : 'outside';
  const set = setFor(p, d);
  const hardware: HwVisual[] = [];
  for (const it of set?.items ?? []) hardware.push(...visual(it, pushSide));
  if (!set) assumptions.push(d.hardwareSet ? `Hardware set ${d.hardwareSet} not found: generic lever and hinges shown` : 'No hardware set: generic lever and hinges shown');
  if (!hardware.some((x) => x.kind === 'hinge') && !/pivot|sliding|pocket/.test(d.configuration)) hardware.push({ kind: 'hinge', side: pushSide === 'outside' ? 'inside' : 'outside', metal: 'satin', label: 'Hinge (assumed)', qty: 3 });
  if (!hardware.some((x) => ['lever', 'pull', 'push-plate', 'panic', 'card-lock'].includes(x.kind))) hardware.push({ kind: 'lever', side: 'both', metal: hardware[0]?.metal ?? 'satin', label: 'Lever (assumed)', qty: 1 });
  if (d.kickPlate && !hardware.some((x) => x.kind === 'kick-plate')) hardware.push({ kind: 'kick-plate', side: pushSide, metal: 'satin', label: 'Kick plate', qty: 1, height: d.kickPlateHeight ?? 200 });
  const hinges = (d.hingePositions || '').split(/[,;\s]+/).map(Number).filter((x) => x > 0);
  return {
    mark: d.mark, soW, soH, leafW, leafH, T, fw, fd, wallT: d.wallThickness ?? fd, undercut: uc,
    frame, face, edge, vision,
    louvre: d.louvre ? { w: d.louvreWidth ?? 400, h: d.louvreHeight ?? 300, fromBottom: d.louvreFromBottom ?? 150 } : null,
    hingeLeftFromOutside, pushSide, handleH: d.handleHeight ?? 1050, backset: d.backset ?? 60,
    hinges: hinges.length ? hinges : leafH > 2300 ? [250, 900, 1550, leafH - 250] : [250, leafH / 2, leafH - 250],
    pair, sliding: /sliding|pocket/.test(d.configuration), hardware, assumptions,
  };
}
