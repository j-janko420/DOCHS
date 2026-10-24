// Minimal XLSX reader (no dependencies): ZIP central directory + raw-deflate via
// the platform DecompressionStream, shared strings and cell values. Formulas are
// read as their cached values. Enough to import door schedules; not a general
// spreadsheet engine.

export interface Sheet {
  name: string;
  rows: string[][]; // dense grid, '' for empty cells
}

interface Entry { name: string; method: number; compSize: number; offset: number }

export function entries(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx (zip) file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw' = 'deflate-raw'): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new Error('This browser cannot read compressed files; use a current Chrome, Edge, Firefox or Safari');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readEntry(buf: Uint8Array, e: Entry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`Corrupt zip entry ${e.name}`);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const raw = buf.subarray(start, start + e.compSize);
  const data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!data) throw new Error(`Unsupported compression in ${e.name}`);
  return new TextDecoder().decode(data);
}

export const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
const text = (frag: string) => unxml([...frag.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(input: Uint8Array): Promise<Sheet[]> {
  const list = entries(input);
  const get = async (name: string) => { const e = list.find((x) => x.name === name); return e ? readEntry(input, e) : ''; };
  const shared = [...(await get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const wb = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    let path = target.get(rid) ?? '';
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
    const xml = await get(path);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rn = Number(/r="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1;
      const row: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? '';
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 's') val = v !== undefined ? shared[Number(v)] ?? '' : '';
        else if (t === 'inlineStr') val = text(body);
        else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else val = v !== undefined ? unxml(v) : '';
        const ci = ref ? colIndex(ref) : row.length;
        while (row.length < ci) row.push('');
        row[ci] = val.replace(/\r\n?/g, '\n');
      }
      while (rows.length < rn) rows.push([]);
      rows[rn] = row;
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    sheets.push({ name, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) });
  }
  return sheets;
}
