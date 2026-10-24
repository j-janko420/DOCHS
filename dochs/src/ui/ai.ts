import type { Target } from '../core/importer.js';
import { TARGETS } from '../core/importer.js';
import { isDemo } from './state.js';

// Optional connection to the DORSCH API server (server/ in this repository).
// The token is kept in this browser only; provider API keys stay on the server.

export interface AiServer { url: string; token: string; provider: 'anthropic' | 'xai' | 'openai_compatible' }

const KEY = 'dochs.server';

export function aiServer(): AiServer | null {
  if (isDemo()) return null;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AiServer | null;
    return s && s.url && s.token ? s : null;
  } catch { return null; }
}

export function saveAiServer(s: AiServer | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

async function call<T>(s: AiServer, path: string, body?: unknown): Promise<T> {
  const res = await fetch(s.url.replace(/\/+$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${s.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Server returned HTTP ${res.status}`);
  return data as T;
}

export async function testServer(s: AiServer): Promise<string> {
  const r = await call<{ providers: { id: string; configured: boolean }[] }>(s, '/v1/providers');
  const p = r.providers.find((x) => x.id === s.provider);
  if (!p) throw new Error(`Provider ${s.provider} is not offered by this server`);
  if (!p.configured) throw new Error(`Provider ${s.provider} has no API key on the server`);
  return `Connected. Providers with keys: ${r.providers.filter((x) => x.configured).map((x) => x.id).join(', ')}`;
}

// Asks the server for a column matching. Only known field keys are accepted,
// whatever the server returns; the user reviews the result before importing.
export async function suggestMapping(s: AiServer, headers: string[], samples: string[][]): Promise<{ mapping: Target[]; notes: string[] }> {
  const r = await call<{ mapping: unknown[]; notes: unknown[] }>(s, '/v1/dochs/suggest-mapping', {
    provider: s.provider,
    headers: headers.map((h) => h.slice(0, 200)),
    samples: samples.slice(0, 5).map((row) => row.slice(0, 80).map((c) => c.slice(0, 200))),
  });
  const known = new Set<string>(TARGETS.map((t) => t.key));
  const mapping = headers.map((_, i) => { const v = r.mapping?.[i]; return (typeof v === 'string' && known.has(v) ? v : '') as Target; });
  return { mapping, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] };
}

// Reads an image / scanned PDF with the server's model. The model only
// transcribes what is printed (tab-separated table rows, one line per line);
// DORSCH then runs its own extraction and cross-checks on that text.
export async function extractText(s: AiServer, name: string, mediaType: string, bytes: Uint8Array, role: string): Promise<{ text: string; notes: string[] }> {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const r = await call<{ text: unknown; notes: unknown[] }>(s, '/v1/dochs/extract', { provider: s.provider, role, file_name: name.slice(0, 200), media_type: mediaType, data_base64: btoa(bin) });
  return { text: typeof r.text === 'string' ? r.text : '', notes: Array.isArray(r.notes) ? r.notes.map(String) : [] };
}
