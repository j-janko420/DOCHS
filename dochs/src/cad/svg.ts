import type { Entity, Pt } from './entities.js';
import { LAYERS, dimGeometry } from './entities.js';

// SVG preview of the same model-space entities written to DXF. Preview only:
// the CAD deliverable is the DXF file.

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const f = (v: number) => (Math.round(v * 100) / 100).toString();

const DASH: Record<string, number[]> = { CONTINUOUS: [], DASHED: [6, 3], HIDDEN: [3, 1.5], CENTER: [12, 3, 3, 3] };

export interface SvgOptions {
  width: number; // model units
  height: number;
  S: number; // model units per paper mm
  hiddenLayers?: Set<string>;
  paperMm?: [number, number]; // when set, width/height attributes in mm for true-scale print
  background?: string;
}

export function toSvg(es: Entity[], o: SvgOptions): string {
  const H = o.height;
  const P = (p: Pt) => `${f(p[0])},${f(H - p[1])}`;
  const groups = new Map<string, string[]>();
  const push = (layer: string, s: string) => { if (!groups.has(layer)) groups.set(layer, []); groups.get(layer)!.push(s); };
  const text = (layer: string, p: Pt, h: number, s: string, align?: string, valign?: string, rot?: number) => {
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const base = valign === 'middle' ? 'central' : valign === 'top' ? 'hanging' : 'alphabetic';
    const x = f(p[0]), y = f(H - p[1]);
    const tr = rot ? ` transform="rotate(${-rot} ${x} ${y})"` : '';
    push(layer, `<text x="${x}" y="${y}" font-size="${f(h)}" text-anchor="${anchor}" dominant-baseline="${base}"${tr}>${esc(s)}</text>`);
  };
  for (const e of es) {
    if (o.hiddenLayers?.has(e.layer)) continue;
    switch (e.t) {
      case 'line': push(e.layer, `<line x1="${f(e.a[0])}" y1="${f(H - e.a[1])}" x2="${f(e.b[0])}" y2="${f(H - e.b[1])}"/>`); break;
      case 'poly': push(e.layer, `<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map(P).join(' ')}"/>`); break;
      case 'circle': push(e.layer, `<circle cx="${f(e.c[0])}" cy="${f(H - e.c[1])}" r="${f(e.r)}"/>`); break;
      case 'arc': {
        const a0 = (e.a0 * Math.PI) / 180, a1 = (e.a1 * Math.PI) / 180;
        const sweep = (((e.a1 - e.a0) % 360) + 360) % 360 || 360;
        const s: Pt = [e.c[0] + e.r * Math.cos(a0), e.c[1] + e.r * Math.sin(a0)];
        const t: Pt = [e.c[0] + e.r * Math.cos(a1), e.c[1] + e.r * Math.sin(a1)];
        push(e.layer, `<path d="M${P(s)} A${f(e.r)},${f(e.r)} 0 ${sweep > 180 ? 1 : 0} 0 ${P(t)}"/>`);
        break;
      }
      case 'text': text(e.layer, e.p, e.h, e.s, e.align, e.valign, e.rot); break;
      case 'dim': {
        const g = dimGeometry(e);
        for (const [a, b] of g.lines) push(e.layer, `<line x1="${f(a[0])}" y1="${f(H - a[1])}" x2="${f(b[0])}" y2="${f(H - b[1])}"/>`);
        text(e.layer, g.textPos, e.h, g.text, 'center', 'base', g.textRot);
        break;
      }
      case 'hatch': break;
      case 'image': push(e.layer, `<image href="${e.src}" x="${f(e.p[0])}" y="${f(H - e.p[1] - e.h)}" width="${f(e.w)}" height="${f(e.h)}" preserveAspectRatio="none"/>`); break;
    }
  }
  const body = LAYERS.filter((l) => groups.has(l.name)).map((l) => {
    const dash = DASH[l.ltype].map((x) => f(x * o.S)).join(' ');
    return `<g data-layer="${l.name}" stroke="${l.svg}" fill="none" stroke-width="${f(l.weight * o.S)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round">` +
      groups.get(l.name)!.filter((s) => s.startsWith('<image')).join('') +
      `<g fill="${l.svg}" stroke="none" font-family="Arial, Helvetica, sans-serif">${groups.get(l.name)!.filter((s) => s.startsWith('<text')).join('')}</g>` +
      groups.get(l.name)!.filter((s) => !s.startsWith('<text') && !s.startsWith('<image')).join('') + '</g>';
  }).join('');
  const size = o.paperMm ? ` width="${o.paperMm[0]}mm" height="${o.paperMm[1]}mm"` : '';
  const bg = o.background ? `<rect x="0" y="0" width="${f(o.width)}" height="${f(H)}" fill="${o.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(o.width)} ${f(H)}"${size}>${bg}${body}</svg>`;
}
