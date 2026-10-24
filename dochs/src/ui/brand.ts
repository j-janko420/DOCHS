// DORSCH brand: name, tagline, door-frame mark. One place, used by the header,
// the sheets, the exports and the favicon.

export const BRAND = 'DORSCH';
export const TAGLINE = 'Door Schedule Solutions';
export const CREDIT = 'Designed by i3 Design';

// 3D door frame with the leaf ajar and light through the opening.
export const MARK_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
<linearGradient id="dm-f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4cb3ff"/><stop offset="1" stop-color="#1745c7"/></linearGradient>
<linearGradient id="dm-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123a9e"/><stop offset="1" stop-color="#091f5e"/></linearGradient>
<linearGradient id="dm-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2f8ff"/><stop offset="1" stop-color="#a9d2ff"/></linearGradient>
<linearGradient id="dm-d" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a1a44"/><stop offset="1" stop-color="#173a8f"/></linearGradient>
</defs>
<path d="M33 6l7-4v38l-7 4z" fill="url(#dm-s)"/>
<path d="M7 6l7-4h26l-7 4z" fill="#77c4ff"/>
<path fill-rule="evenodd" d="M7 6h26v38H7zM12.5 11.5v32.5h15V11.5z" fill="url(#dm-f)"/>
<path d="M12.5 11.5h15V44h-15z" fill="url(#dm-l)"/>
<path d="M12.5 11.5l9.5 3.2v26.2l-9.5 3.1z" fill="url(#dm-d)"/>
<circle cx="20" cy="28.6" r="1.05" fill="#bfe1ff"/>
</svg>`;

export function mark(cls = 'brand-mark'): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = MARK_SVG;
  return s;
}
