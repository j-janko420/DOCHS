import { zip } from '../core/export.js';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = Boolean(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, c: Child) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) c.forEach((x) => append(el, x));
  else el.append(c instanceof Node ? c : String(c));
}

interface HostDownloads { save(r: { filename: string; data: string | Uint8Array }): Promise<unknown> }
interface Host { use(name: string): Promise<HostDownloads | null> }
// File types the claude.ai viewer accepts; anything else (e.g. .dxf) is wrapped in a zip there.
const HOST_TYPES = /\.(csv|xlsx|zip|svg|json|txt|pdf|html|md)$/i;

// Saves a generated file. Inside the claude.ai artifact viewer page-started
// downloads are blocked, so the viewer's save prompt is used instead.
export async function download(name: string, data: string | Uint8Array, type: string) {
  const host = (window as unknown as { claude?: Host }).claude;
  if (host?.use) {
    const dl = await host.use('downloads').catch(() => null);
    if (dl) {
      const wrap = !HOST_TYPES.test(name);
      const filename = wrap ? name.replace(/\.[^.]+$/, '') + '.zip' : name;
      try {
        await dl.save({ filename, data: wrap ? zip([{ name, data }]) : data });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'declined') toast(`Could not save ${filename}: ${code ?? 'unavailable'}`, 'err');
      }
      return;
    }
  }
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'dochs';
}

export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.remove(), 4200);
}

// Two-step button: first click arms it, second click within 4 s runs the action.
export function confirmButton(label: string, cls: string, action: () => void, armedLabel = 'Click again to confirm'): HTMLButtonElement {
  const b = h('button', { class: cls }, label);
  let timer = 0;
  b.addEventListener('click', () => {
    if (timer) { clearTimeout(timer); timer = 0; action(); return; }
    b.textContent = armedLabel;
    timer = window.setTimeout(() => { timer = 0; b.textContent = label; }, 4000);
  });
  return b;
}

export const sevBadge = (s: string) => h('span', { class: `badge sev-${s}` }, s);
