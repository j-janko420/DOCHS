// Minimal PDF text reader (no dependencies). Reads the text layer of PDFs made by
// CAD, Office, Revit and Bluebeam exports: objects (incl. object streams), Flate
// streams, page tree, fonts with ToUnicode CMaps / simple encodings, form
// XObjects, page rotation. Scanned PDFs (images only) have no text layer: the
// result then has no items and the caller must say so, never guess.

export interface TextItem { x: number; y: number; s: string; size: number; w: number; vertical: boolean; note?: boolean }
export interface PdfPage { width: number; height: number; items: TextItem[] }
export interface PdfText { pages: PdfPage[]; title: string; producer: string }

type PVal = number | boolean | null | PName | PStr | PRef | PVal[] | PDict;
class PName { constructor(readonly n: string) {} }
class PStr { constructor(readonly b: string) {} } // binary (one char per byte)
class PRef { constructor(readonly num: number) {} }
type PDict = { [k: string]: PVal };

interface PObj { v: PVal; s0?: number; s1?: number; data?: Uint8Array }

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = '()<>[]{}/%';

function bin(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

class Lexer {
  i = 0;
  constructor(readonly s: string, start = 0) { this.i = start; }
  skip() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && WS.has(s.charCodeAt(this.i))) this.i++;
      if (s[this.i] === '%') { while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++; continue; }
      return;
    }
  }
  // Returns a value, or an operator/keyword as { op }.
  next(): PVal | { op: string } | undefined {
    this.skip();
    const s = this.s;
    if (this.i >= s.length) return undefined;
    const c = s[this.i];
    if (c === '/') {
      let j = ++this.i;
      while (j < s.length && !WS.has(s.charCodeAt(j)) && !DELIM.includes(s[j])) j++;
      const n = s.slice(this.i, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.i = j;
      return new PName(n);
    }
    if (c === '(') return this.literal();
    if (c === '<') {
      if (s[this.i + 1] === '<') { this.i += 2; return this.dict(); }
      const j = s.indexOf('>', this.i);
      const hex = s.slice(this.i + 1, j < 0 ? s.length : j).replace(/[^0-9a-fA-F]/g, '');
      this.i = j < 0 ? s.length : j + 1;
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] ?? '0')), 16));
      return new PStr(out);
    }
    if (c === '[') {
      this.i++;
      const arr: PVal[] = [];
      for (;;) {
        this.skip();
        if (this.s[this.i] === ']') { this.i++; return arr; }
        const v = this.value();
        if (v === undefined) return arr;
        arr.push(v);
      }
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.i++; return { op: c }; }
    let j = this.i;
    while (j < s.length && !WS.has(s.charCodeAt(j)) && !DELIM.includes(s[j])) j++;
    if (j === this.i) j++;
    const tok = s.slice(this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) return Number(tok);
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return { op: tok };
  }
  // A full value: resolves "n g R" references.
  value(): PVal | undefined {
    const v = this.next();
    if (v === undefined) return undefined;
    if (typeof v === 'object' && v !== null && 'op' in v) return null;
    if (typeof v === 'number' && Number.isInteger(v)) {
      const save = this.i;
      const g = this.next();
      if (typeof g === 'number' && Number.isInteger(g)) {
        const r = this.next();
        if (r && typeof r === 'object' && 'op' in r && r.op === 'R') return new PRef(v);
      }
      this.i = save;
    }
    return v as PVal;
  }
  dict(): PDict {
    const d: PDict = {};
    for (;;) {
      this.skip();
      if (this.s.startsWith('>>', this.i)) { this.i += 2; return d; }
      const k = this.next();
      if (!(k instanceof PName)) { if (k === undefined) return d; continue; }
      const v = this.value();
      if (v === undefined) return d;
      d[k.n] = v;
    }
  }
  literal(): PStr {
    const s = this.s;
    let depth = 0, out = '';
    this.i++;
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === '\\') {
        const n = s[this.i++];
        const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (n in map) out += map[n];
        else if (n >= '0' && n <= '7') {
          let o = n;
          while (o.length < 3 && s[this.i] >= '0' && s[this.i] <= '7') o += s[this.i++];
          out += String.fromCharCode(parseInt(o, 8) & 255);
        } else if (n === '\r') { if (s[this.i] === '\n') this.i++; } else if (n !== '\n') out += n;
      } else if (c === '(') { depth++; out += c; } else if (c === ')') { if (depth-- === 0) break; out += c; } else out += c;
    }
    return new PStr(out);
  }
}

async function inflateLoose(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new Error('This browser cannot read compressed PDF streams');
  const chunks: Uint8Array[] = [];
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate')).getReader();
  try {
    for (;;) { const r = await reader.read(); if (r.done) break; chunks.push(r.value); }
  } catch { /* trailing junk after the zlib stream is common: keep what decoded */ }
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function unpredict(data: Uint8Array, parms: PDict | undefined): Uint8Array {
  const pred = Number(parms?.Predictor ?? 1);
  if (pred < 10) return data;
  const colors = Number(parms?.Colors ?? 1), bpc = Number(parms?.BitsPerComponent ?? 8), cols = Number(parms?.Columns ?? 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8)), rowLen = Math.ceil((colors * bpc * cols) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const t = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - rowLen + i] : 0, c = r && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v = raw;
      if (t === 1) v = raw + a; else if (t === 2) v = raw + b; else if (t === 3) v = raw + ((a + b) >> 1);
      else if (t === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

function ascii85(s: string): Uint8Array {
  const out: number[] = [];
  const src = s.replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  let tuple: number[] = [];
  for (const ch of src) {
    if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let v = 0; for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0; for (const t of tuple) v = v * 85 + t;
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return new Uint8Array(out);
}

export class PdfDoc {
  objs = new Map<number, PObj>();
  raw: Uint8Array;
  s: string;
  private cache = new Map<number, Uint8Array>();

  constructor(buf: Uint8Array) {
    this.raw = buf;
    this.s = bin(buf);
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.s))) {
      const lx = new Lexer(this.s, m.index + m[0].length);
      const v = lx.value();
      if (v === undefined) continue;
      const o: PObj = { v };
      lx.skip();
      if (this.s.startsWith('stream', lx.i)) {
        let s0 = lx.i + 6;
        if (this.s[s0] === '\r') s0++;
        if (this.s[s0] === '\n') s0++;
        const len = (v as PDict).Length;
        let s1 = -1;
        if (typeof len === 'number' && /^\s*endstream/.test(this.s.slice(s0 + len, s0 + len + 20))) s1 = s0 + len;
        if (s1 < 0) { s1 = this.s.indexOf('endstream', s0); if (s1 < 0) s1 = this.s.length; }
        o.s0 = s0; o.s1 = s1;
        re.lastIndex = s1;
      }
      this.objs.set(Number(m[1]), o);
    }
  }

  async init() {
    for (const [, o] of [...this.objs]) {
      const d = o.v as PDict;
      if (!d || typeof d !== 'object' || !(d.Type instanceof PName) || d.Type.n !== 'ObjStm') continue;
      try {
        const data = bin(await this.stream(o));
        const n = Number(this.get(d.N)), first = Number(this.get(d.First));
        const head = new Lexer(data);
        const pairs: [number, number][] = [];
        for (let i = 0; i < n; i++) pairs.push([Number(head.next()), Number(head.next())]);
        for (const [num, off] of pairs) {
          if (this.objs.has(num)) continue;
          const v = new Lexer(data, first + off).value();
          if (v !== undefined) this.objs.set(num, { v });
        }
      } catch { /* unreadable object stream: skip */ }
    }
  }

  get(v: PVal | undefined, depth = 0): PVal | undefined {
    if (v instanceof PRef) return depth > 20 ? undefined : this.get(this.objs.get(v.num)?.v, depth + 1);
    return v;
  }
  dict(v: PVal | undefined): PDict | undefined {
    const d = this.get(v);
    return d && typeof d === 'object' && !Array.isArray(d) && !(d instanceof PName) && !(d instanceof PStr) ? (d as PDict) : undefined;
  }
  obj(v: PVal | undefined): PObj | undefined {
    return v instanceof PRef ? this.objs.get(v.num) : undefined;
  }

  async stream(o: PObj | undefined): Promise<Uint8Array> {
    if (!o || o.s0 === undefined) return new Uint8Array();
    const d = o.v as PDict;
    let data = this.raw.subarray(o.s0, o.s1);
    const fl = this.get(d.Filter);
    const filters = (Array.isArray(fl) ? fl : fl ? [fl] : []).map((f) => (this.get(f) as PName)?.n);
    const pa = this.get(d.DecodeParms);
    const parms = (Array.isArray(pa) ? pa : [pa]).map((x) => this.dict(x));
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      if (f === 'FlateDecode' || f === 'Fl') data = unpredict(await inflateLoose(data), parms[i]);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') {
        const hex = bin(data).replace(/[^0-9a-fA-F]/g, '');
        data = new Uint8Array(hex.length >> 1).map((_, k) => parseInt(hex.substr(k * 2, 2), 16));
      } else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(bin(data));
      else return new Uint8Array(); // image codecs, LZW: not text
    }
    return data;
  }

  async streamOf(v: PVal | undefined): Promise<Uint8Array> {
    const o = this.obj(v);
    if (!o) return new Uint8Array();
    const key = (v as PRef).num;
    if (!this.cache.has(key)) this.cache.set(key, await this.stream(o));
    return this.cache.get(key)!;
  }

  catalog(): PDict | undefined {
    const tr = /trailer\s*<</g;
    let root: PVal | undefined;
    let m: RegExpExecArray | null;
    while ((m = tr.exec(this.s))) { const d = new Lexer(this.s, m.index + m[0].length - 2).value() as PDict | undefined; if (d && typeof d === 'object' && d.Root) root = d.Root; }
    if (!root) for (const o of this.objs.values()) { const d = o.v as PDict; if (d && typeof d === 'object' && (d.Type as PName)?.n === 'XRef' && d.Root) root = d.Root; }
    let cat = this.dict(root);
    if (!cat) for (const o of this.objs.values()) { const d = o.v as PDict; if (d && typeof d === 'object' && (d.Type as PName)?.n === 'Catalog') { cat = d; break; } }
    return cat;
  }

  info(): PDict | undefined {
    for (const o of this.objs.values()) { const d = o.v as PDict; if (d && typeof d === 'object' && !Array.isArray(d) && (d.Producer || d.Creator) && !d.Type) return d; }
    return undefined;
  }

  pages(): { d: PDict; res: PDict | undefined; box: number[]; rotate: number }[] {
    const out: { d: PDict; res: PDict | undefined; box: number[]; rotate: number }[] = [];
    const seen = new Set<PDict>();
    const walk = (node: PDict | undefined, res: PDict | undefined, box: number[] | undefined, rot: number) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      const r = this.dict(node.Resources) ?? res;
      const mb = this.get(node.MediaBox);
      const b = Array.isArray(mb) ? mb.map((x) => Number(this.get(x))) : box;
      const ro = node.Rotate !== undefined ? Number(this.get(node.Rotate)) : rot;
      const kids = this.get(node.Kids);
      if (Array.isArray(kids)) for (const k of kids) walk(this.dict(k), r, b, ro);
      else out.push({ d: node, res: r, box: b ?? [0, 0, 612, 792], rotate: ((ro % 360) + 360) % 360 });
    };
    const cat = this.catalog();
    walk(this.dict(cat?.Pages), undefined, undefined, 0);
    if (!out.length) for (const o of this.objs.values()) { const d = o.v as PDict; if (d && typeof d === 'object' && (d.Type as PName)?.n === 'Page') out.push({ d, res: this.dict(d.Resources), box: [0, 0, 612, 792], rotate: 0 }); }
    return out;
  }
}

// ---------- fonts ----------

const WIN_ANSI_HI: Record<number, string> = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const GLYPH: Record<string, string> = { space: ' ', period: '.', comma: ',', hyphen: '-', minus: '-', endash: '–', emdash: '—', colon: ':', semicolon: ';', slash: '/', backslash: '\\', parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', ampersand: '&', percent: '%', plus: '+', equal: '=', underscore: '_', quotesingle: "'", quotedbl: '"', quoteright: '’', quoteleft: '‘', numbersign: '#', at: '@', asterisk: '*', degree: '°', multiply: '×', plusminus: '±', exclam: '!', question: '?', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', bullet: '•', less: '<', greater: '>', dollar: '$', sterling: '£', Euro: '€', mu: 'µ', twosuperior: '²', threesuperior: '³' };

function glyphChar(name: string): string {
  if (name.length === 1) return name;
  if (GLYPH[name]) return GLYPH[name];
  const u = /^uni([0-9A-Fa-f]{4})/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  return '';
}

interface Font {
  bytes: 1 | 2;
  ranges: { lo: number; hi: number; n: number }[]; // codespace
  map: Map<number, string>;
  simple: Map<number, string> | null;
  widths: Map<number, number>;
  dw: number;
  vertical: boolean;
}

function utf16(b: string): string {
  let out = '';
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode((b.charCodeAt(i) << 8) | b.charCodeAt(i + 1));
  return out;
}
const hexStr = (h: string) => { let s = ''; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return s; };
const hexNum = (h: string) => parseInt(h || '0', 16);

export function parseCMap(text: string): { map: Map<number, string>; ranges: { lo: number; hi: number; n: number }[] } {
  const map = new Map<number, string>();
  const ranges: { lo: number; hi: number; n: number }[] = [];
  for (const blk of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g))
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) ranges.push({ lo: hexNum(m[1]), hi: hexNum(m[2]), n: m[1].length >> 1 });
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hexNum(m[1]), utf16(hexStr(m[2])));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = hexNum(m[1]), hi = Math.min(hexNum(m[2]), lo + 65535);
      if (m[3] !== undefined) {
        const base = hexStr(m[3]);
        for (let c = lo; c <= hi; c++) {
          const last = ((base.charCodeAt(base.length - 2) << 8) | base.charCodeAt(base.length - 1)) + (c - lo);
          map.set(c, utf16(base.slice(0, -2) + String.fromCharCode((last >> 8) & 255, last & 255)));
        }
      } else {
        const list = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16(hexStr(x[1])));
        list.forEach((u, k) => map.set(lo + k, u));
      }
    }
  }
  return { map, ranges };
}

async function loadFont(doc: PdfDoc, fv: PVal | undefined): Promise<Font> {
  const f = doc.dict(fv) ?? {};
  const sub = (doc.get(f.Subtype) as PName)?.n;
  const font: Font = { bytes: sub === 'Type0' ? 2 : 1, ranges: [], map: new Map(), simple: null, widths: new Map(), dw: sub === 'Type0' ? 1000 : 500, vertical: false };
  if (f.ToUnicode) {
    const cm = parseCMap(bin(await doc.streamOf(f.ToUnicode)));
    font.map = cm.map;
    if (sub === 'Type0') font.ranges = cm.ranges;
  }
  if (sub === 'Type0') {
    const enc = doc.get(f.Encoding);
    if (enc instanceof PName && /-V$/.test(enc.n)) font.vertical = true;
    if (enc instanceof PRef || (enc && !(enc instanceof PName))) { /* embedded CMap: code lengths from its codespace */
      const cm = parseCMap(bin(await doc.streamOf(f.Encoding)));
      if (cm.ranges.length) font.ranges = cm.ranges;
    }
    const desc = doc.get(f.DescendantFonts);
    const d0 = doc.dict(Array.isArray(desc) ? desc[0] : desc);
    if (d0) {
      if (d0.DW !== undefined) font.dw = Number(doc.get(d0.DW));
      const w = doc.get(d0.W);
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length;) {
          const c0 = Number(doc.get(w[i]));
          const nx = doc.get(w[i + 1]);
          if (Array.isArray(nx)) { nx.forEach((x, k) => font.widths.set(c0 + k, Number(doc.get(x)))); i += 2; } else {
            const c1 = Number(nx), ww = Number(doc.get(w[i + 2]));
            for (let c = c0; c <= c1 && c - c0 < 65536; c++) font.widths.set(c, ww);
            i += 3;
          }
        }
      }
    }
    // codespace of Identity-H is 2 bytes; mixed-length ToUnicode ranges are honoured below
    if (!font.ranges.length || font.ranges.every((r) => r.n === 1)) font.ranges = font.ranges.length ? font.ranges : [{ lo: 0, hi: 0xffff, n: 2 }];
  } else {
    const fc = Number(doc.get(f.FirstChar) ?? 0);
    const ws = doc.get(f.Widths);
    if (Array.isArray(ws)) ws.forEach((x, k) => font.widths.set(fc + k, Number(doc.get(x))));
    const enc = doc.get(f.Encoding);
    const simple = new Map<number, string>();
    for (let c = 32; c < 256; c++) simple.set(c, WIN_ANSI_HI[c] ?? String.fromCharCode(c));
    const encDict = doc.dict(enc);
    const diffs = encDict ? doc.get(encDict.Differences) : undefined;
    if (Array.isArray(diffs)) {
      let code = 0;
      for (const x of diffs) {
        const v = doc.get(x);
        if (typeof v === 'number') code = v;
        else if (v instanceof PName) { const ch = glyphChar(v.n); if (ch) simple.set(code, ch); code++; }
      }
    }
    font.simple = simple;
  }
  return font;
}

function decode(font: Font, b: string): { ch: string; code: number; space: boolean }[] {
  const out: { ch: string; code: number; space: boolean }[] = [];
  if (font.bytes === 1) {
    for (let i = 0; i < b.length; i++) {
      const c = b.charCodeAt(i);
      out.push({ ch: font.map.get(c) ?? font.simple?.get(c) ?? (c >= 32 ? String.fromCharCode(c) : ''), code: c, space: c === 32 });
    }
    return out;
  }
  for (let i = 0; i < b.length;) {
    let n = 2;
    for (const len of [1, 2, 3, 4]) {
      if (i + len > b.length) break;
      let v = 0; for (let k = 0; k < len; k++) v = (v << 8) | b.charCodeAt(i + k);
      if (font.ranges.some((r) => r.n === len && v >= r.lo && v <= r.hi)) { n = len; break; }
    }
    let c = 0; for (let k = 0; k < n && i + k < b.length; k++) c = (c << 8) | b.charCodeAt(i + k);
    out.push({ ch: font.map.get(c) ?? '', code: c, space: n === 1 && c === 32 });
    i += n;
  }
  return out;
}

// ---------- content interpretation ----------

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const ID: M = [1, 0, 0, 1, 0, 0];

interface Glyphs { x: number; y: number; x2: number; y2: number; s: string; size: number; dir: number }

async function runContent(doc: PdfDoc, data: string, res: PDict | undefined, ctm0: M, out: Glyphs[], fonts: Map<PVal, Font>, depth: number) {
  if (depth > 8) return;
  const lx = new Lexer(data);
  const stack: (PVal | { op: string })[] = [];
  let ctm = ctm0;
  const gstack: M[] = [];
  let tm: M = ID, tlm: M = ID;
  let font: Font | null = null, fs = 1, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
  const fontRes = doc.dict(res?.Font);
  const xres = doc.dict(res?.XObject);
  const getFont = async (name: string) => {
    const ref = fontRes?.[name];
    if (ref === undefined) return null;
    if (!fonts.has(ref)) fonts.set(ref, await loadFont(doc, ref));
    return fonts.get(ref)!;
  };
  const show = (b: string) => {
    if (!font) return;
    const trm = mul([fs * th, 0, 0, fs, 0, rise], mul(tm, ctm));
    let txt = '';
    let adv = 0;
    for (const g of decode(font, b)) {
      txt += g.ch;
      const w = (font.widths.get(g.code) ?? font.dw) / 1000;
      const a = (w * fs + tc + (g.space ? tw : 0)) * th;
      adv += a;
      tm = mul([1, 0, 0, 1, a, 0], tm);
    }
    const end = mul(tm, ctm);
    const size = Math.hypot(trm[2], trm[3]);
    if (txt.trim()) out.push({ x: trm[4], y: trm[5], x2: end[4], y2: end[5], s: txt, size, dir: Math.atan2(trm[1], trm[0]) });
    void adv;
  };
  const num = (k: number) => Number(stack[stack.length - k]);
  for (;;) {
    const t = lx.next();
    if (t === undefined) break;
    if (!(t && typeof t === 'object' && 'op' in t)) { stack.push(t); continue; }
    const op = t.op;
    switch (op) {
      case 'q': gstack.push(ctm); break;
      case 'Q': ctm = gstack.pop() ?? ctm; break;
      case 'cm': ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
      case 'BT': tm = ID; tlm = ID; break;
      case 'Tf': { const n = stack[stack.length - 2]; fs = num(1); font = n instanceof PName ? await getFont(n.n) : null; break; }
      case 'Tc': tc = num(1); break;
      case 'Tw': tw = num(1); break;
      case 'Tz': th = num(1) / 100; break;
      case 'TL': tl = num(1); break;
      case 'Ts': rise = num(1); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; break;
      case 'TD': tl = -num(1); tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; break;
      case 'Tm': tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; tm = tlm; break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
      case 'Tj': { const s = stack[stack.length - 1]; if (s instanceof PStr) show(s.b); break; }
      case "'": { tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; const s = stack[stack.length - 1]; if (s instanceof PStr) show(s.b); break; }
      case '"': { tw = num(3); tc = num(2); tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; const s = stack[stack.length - 1]; if (s instanceof PStr) show(s.b); break; }
      case 'TJ': {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) for (const e of arr) {
          if (e instanceof PStr) show(e.b);
          else if (typeof e === 'number') {
            const a = (-e / 1000) * fs * th;
            // a large negative kern is a visual word gap: make it a space
            if (-e > 250 && out.length) out[out.length - 1].s += ' ';
            tm = mul([1, 0, 0, 1, a, 0], tm);
          }
        }
        break;
      }
      case 'Do': {
        const n = stack[stack.length - 1];
        const ref = n instanceof PName ? xres?.[n.n] : undefined;
        const xo = doc.obj(ref);
        const xd = xo?.v as PDict | undefined;
        if (xd && (doc.get(xd.Subtype) as PName)?.n === 'Form') {
          const mat = doc.get(xd.Matrix);
          const fm: M = Array.isArray(mat) && mat.length === 6 ? (mat.map((x) => Number(doc.get(x))) as M) : ID;
          await runContent(doc, bin(await doc.streamOf(ref)), doc.dict(xd.Resources) ?? res, mul(fm, ctm), out, fonts, depth + 1);
        }
        break;
      }
      case 'BI': {
        const j = data.indexOf('EI', lx.i);
        lx.i = j < 0 ? data.length : j + 2;
        break;
      }
    }
    stack.length = 0;
  }
}

function toItems(glyphs: Glyphs[], box: number[], rotate: number): PdfPage {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0, H = y1 - y0;
  // page rotation -> display coordinates (y up, origin bottom-left)
  const rot = (x: number, y: number): [number, number] => {
    const u = x - x0, v = y - y0;
    if (rotate === 90) return [v, W - u];
    if (rotate === 180) return [W - u, H - v];
    if (rotate === 270) return [H - v, u];
    return [u, v];
  };
  const dw = rotate === 90 || rotate === 270 ? H : W, dh = rotate === 90 || rotate === 270 ? W : H;
  const prelim = glyphs.map((g) => {
    const [ax, ay] = rot(g.x, g.y), [bx, by] = rot(g.x2, g.y2);
    const ang = Math.atan2(by - ay, bx - ax);
    const horiz = Math.abs(Math.sin(ang)) < 0.2 && Math.cos(ang) > 0 || (bx === ax && by === ay && Math.abs(Math.sin(g.dir + (rotate * Math.PI) / 180)) < 0.2);
    return { x: ax, y: ay, x2: bx, y2: by, s: g.s, size: g.size, vertical: !horiz };
  });
  // merge horizontal runs on the same baseline that touch
  const hz = prelim.filter((g) => !g.vertical).sort((a, b) => b.y - a.y || a.x - b.x);
  const items: TextItem[] = [];
  let cur: (typeof hz)[number] | null = null;
  for (const g of hz) {
    if (cur && Math.abs(g.y - cur.y) < cur.size * 0.3 && g.x >= cur.x2 - cur.size * 0.5 && g.x - cur.x2 < cur.size * 0.35 && Math.abs(g.size - cur.size) < cur.size * 0.3) {
      const gap = g.x - cur.x2;
      cur.s += (gap > cur.size * 0.12 && !cur.s.endsWith(' ') && !g.s.startsWith(' ') ? ' ' : '') + g.s;
      cur.x2 = g.x2;
    } else {
      if (cur) items.push({ x: cur.x, y: cur.y, s: cur.s.replace(/\s+/g, ' ').trim(), size: cur.size, w: cur.x2 - cur.x, vertical: false });
      cur = { ...g };
    }
  }
  if (cur) items.push({ x: cur.x, y: cur.y, s: cur.s.replace(/\s+/g, ' ').trim(), size: cur.size, w: cur.x2 - cur.x, vertical: false });
  for (const g of prelim.filter((x) => x.vertical)) items.push({ x: g.x, y: g.y, s: g.s.replace(/\s+/g, ' ').trim(), size: g.size, w: Math.hypot(g.x2 - g.x, g.y2 - g.y), vertical: true });
  return { width: dw, height: dh, items: items.filter((i) => i.s) };
}

function strOf(doc: PdfDoc, v: PVal | undefined): string {
  const x = doc.get(v);
  if (!(x instanceof PStr)) return '';
  return x.b.startsWith('\xfe\xff') ? utf16(x.b.slice(2)) : x.b;
}

export async function readPdfText(buf: Uint8Array): Promise<PdfText> {
  if (bin(buf.subarray(0, 1024)).indexOf('%PDF') < 0) throw new Error('Not a PDF file');
  if (/\/Encrypt\s/.test(bin(buf.subarray(Math.max(0, buf.length - 4096))))) {
    // encrypted with an empty user password is common for "protected" CAD prints; the text is still encrypted, so say so
    throw new Error('This PDF is encrypted. Save an unprotected copy (Print to PDF) and upload that.');
  }
  const doc = new PdfDoc(buf);
  await doc.init();
  const fonts = new Map<PVal, Font>();
  const pages: PdfPage[] = [];
  const str = (v: PVal | undefined) => strOf(doc, v);
  for (const pg of doc.pages()) {
    const c = doc.get(pg.d.Contents);
    const refs = Array.isArray(c) ? c : [pg.d.Contents];
    let data = '';
    for (const r of refs) data += bin(await doc.streamOf(r)) + '\n';
    const glyphs: Glyphs[] = [];
    await runContent(doc, data, pg.res, ID, glyphs, fonts, 0);
    const page = toItems(glyphs, pg.box, pg.rotate);
    // review markups (Bluebeam / Acrobat comments, text boxes, callouts) carry legends and notes
    const annots = doc.get(pg.d.Annots);
    if (Array.isArray(annots)) for (const a of annots) {
      const ad = doc.dict(a);
      const sub = (doc.get(ad?.Subtype) as PName | undefined)?.n ?? '';
      if (!ad || /^(Link|Widget|Popup)$/.test(sub)) continue;
      const txt = str(ad.Contents);
      if (!txt.trim()) continue;
      const rect = doc.get(ad.Rect);
      const [ax0, , , ay1] = Array.isArray(rect) ? rect.map((x) => Number(doc.get(x))) : [0, 0, 0, 0];
      txt.split(/\r\n|\r|\n/).forEach((ln, k) => {
        const t = ln.replace(/\s+/g, ' ').trim();
        if (t) page.items.push({ x: ax0 - pg.box[0], y: ay1 - pg.box[1] - 10 * (k + 1), s: t, size: 8, w: t.length * 4.5, vertical: false, note: true });
      });
    }
    pages.push(page);
  }
  const info = doc.info();
  return { pages, title: str(info?.Title), producer: str(info?.Producer) || str(info?.Creator) };
}

// ---------- layout helpers ----------

// Text lines of a page, top to bottom, with cells split at wide gaps.
export function pageLines(pg: PdfPage): { y: number; cells: { x: number; s: string; x2: number }[] }[] {
  const items = pg.items.filter((i) => !i.vertical && !i.note).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; its: TextItem[] }[] = [];
  for (const it of items) {
    const l = lines.find((L) => Math.abs(L.y - it.y) < Math.max(L.size, it.size) * 0.45);
    if (l) l.its.push(it); else lines.push({ y: it.y, size: it.size, its: [it] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => {
    const its = l.its.sort((a, b) => a.x - b.x);
    const cells: { x: number; s: string; x2: number }[] = [];
    for (const it of its) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.x2 < l.size * 0.9) { last.s += ' ' + it.s; last.x2 = it.x + it.w; } else cells.push({ x: it.x, s: it.s, x2: it.x + it.w });
    }
    return { y: l.y, cells };
  });
}

// Reconstructs a table grid from aligned text: column starts are clustered
// across lines, each cell goes to the column whose span it starts in.
export function pageTable(pg: PdfPage): string[][] {
  const lines = pageLines(pg);
  const tol = Math.max(4, pg.width * 0.006);
  const starts: number[] = [];
  for (const l of lines) for (const c of l.cells) starts.push(c.x);
  starts.sort((a, b) => a - b);
  const cols: { x: number; n: number }[] = [];
  for (const x of starts) {
    const c = cols[cols.length - 1];
    if (c && x - c.x < tol) { c.x = (c.x * c.n + x) / (c.n + 1); c.n++; } else cols.push({ x, n: 1 });
  }
  // keep columns used by at least two lines (a real column), merge the rest into the nearest
  const real = cols.filter((c) => c.n >= 2).map((c) => c.x);
  const xs = real.length ? real : cols.map((c) => c.x);
  return lines.map((l) => {
    const row = new Array<string>(xs.length).fill('');
    for (const c of l.cells) {
      let k = 0;
      for (let i = 0; i < xs.length; i++) if (xs[i] <= c.x + tol) k = i;
      row[k] = row[k] ? `${row[k]} ${c.s}` : c.s;
    }
    return row;
  });
}

export function pageText(pg: PdfPage): string[] {
  return pageLines(pg).map((l) => l.cells.map((c) => c.s).join('  '));
}

// ---------- vector content (title blocks) ----------

export interface PdfVector {
  width: number; // pt, display orientation
  height: number;
  paths: { pts: [number, number][]; closed: boolean }[];
  texts: { x: number; y: number; s: string; size: number; rot: number }[];
  images: { x: number; y: number; w: number; h: number; jpeg: Uint8Array }[];
  truncated: boolean;
}

const MAX_SEGS = 40000;

async function runPaths(doc: PdfDoc, data: string, res: PDict | undefined, ctm0: M, out: PdfVector, depth: number) {
  if (depth > 8) return;
  const lx = new Lexer(data);
  const stack: (PVal | { op: string })[] = [];
  let ctm = ctm0;
  const gstack: { ctm: M; fw: boolean; sw: boolean }[] = [];
  let fillWhite = false, strokeWhite = false;
  let sub: [number, number][] = [];
  let subs: { pts: [number, number][]; closed: boolean }[] = [];
  let cur: [number, number] = [0, 0];
  const T = (x: number, y: number): [number, number] => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]];
  const xres = doc.dict(res?.XObject);
  const num = (k: number) => Number(stack[stack.length - k]);
  const flush = () => { if (sub.length > 1) subs.push({ pts: sub, closed: false }); sub = []; };
  const paint = () => {
    flush();
    for (const s of subs) {
      if (out.paths.length > MAX_SEGS) { out.truncated = true; break; }
      out.paths.push(s);
    }
    subs = [];
  };
  for (;;) {
    const t = lx.next();
    if (t === undefined) break;
    if (!(t && typeof t === 'object' && 'op' in t)) { stack.push(t); continue; }
    switch (t.op) {
      case 'q': gstack.push({ ctm, fw: fillWhite, sw: strokeWhite }); break;
      case 'Q': { const g = gstack.pop(); if (g) { ctm = g.ctm; fillWhite = g.fw; strokeWhite = g.sw; } break; }
      case 'cm': ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
      // white fills are masks / backgrounds: outlining them would draw boxes that are not on the print
      case 'g': case 'rg': case 'sc': case 'scn': case 'k': case 'G': case 'RG': case 'SC': case 'SCN': case 'K': {
        const vals = stack.filter((x): x is number => typeof x === 'number');
        const white = vals.length > 0 && (/^[kK]$/.test(t.op) ? vals.every((v) => v < 0.05) : vals.every((v) => v > 0.95));
        if (t.op === t.op.toLowerCase()) fillWhite = white; else strokeWhite = white;
        break;
      }
      case 'm': flush(); cur = [num(2), num(1)]; sub = [T(cur[0], cur[1])]; break;
      case 'l': cur = [num(2), num(1)]; sub.push(T(cur[0], cur[1])); break;
      case 'c': case 'v': case 'y': {
        const p3: [number, number] = [num(2), num(1)];
        const p1: [number, number] = t.op === 'v' ? cur : [num(6), num(5)];
        const p2: [number, number] = t.op === 'y' ? p3 : t.op === 'v' ? [num(4), num(3)] : [num(4), num(3)];
        const p0 = cur;
        for (let i = 1; i <= 6; i++) {
          const u = i / 6, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
          sub.push(T(a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]));
        }
        cur = p3;
        break;
      }
      case 're': {
        flush();
        const [x, y, w, h] = [num(4), num(3), num(2), num(1)];
        subs.push({ pts: [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)], closed: true });
        cur = [x, y];
        break;
      }
      case 'h': if (sub.length > 1) { subs.push({ pts: sub, closed: true }); sub = []; } break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': {
        if (t.op === 's' || t.op === 'b' || t.op === 'b*') { if (sub.length > 1) { subs.push({ pts: sub, closed: true }); sub = []; } }
        const fillOnly = /^[fF]\*?$/.test(t.op), strokeOnly = /^[sS]$/.test(t.op);
        if ((fillOnly && fillWhite) || (strokeOnly && strokeWhite) || (!fillOnly && !strokeOnly && fillWhite && strokeWhite)) { sub = []; subs = []; } else paint();
        break;
      }
      case 'n': sub = []; subs = []; break;
      case 'Do': {
        const nm = stack[stack.length - 1];
        const ref = nm instanceof PName ? xres?.[nm.n] : undefined;
        const xo = doc.obj(ref);
        const xd = xo?.v as PDict | undefined;
        const st = (doc.get(xd?.Subtype) as PName | undefined)?.n;
        if (xd && st === 'Form') {
          const mat = doc.get(xd.Matrix);
          const fm: M = Array.isArray(mat) && mat.length === 6 ? (mat.map((x) => Number(doc.get(x))) as M) : ID;
          await runPaths(doc, bin(await doc.streamOf(ref)), doc.dict(xd.Resources) ?? res, mul(fm, ctm), out, depth + 1);
        } else if (xd && st === 'Image' && xo?.s0 !== undefined) {
          const fl = doc.get(xd.Filter);
          const f0 = (Array.isArray(fl) ? doc.get(fl[0]) : fl) as PName | undefined;
          if (f0?.n === 'DCTDecode' && !Array.isArray(fl)) {
            const [x0, y0] = T(0, 0), [x1, y1] = T(1, 1);
            out.images.push({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), jpeg: doc.raw.slice(xo.s0, xo.s1) });
          }
        }
        break;
      }
      case 'BI': { const j = data.indexOf('EI', lx.i); lx.i = j < 0 ? data.length : j + 2; break; }
    }
    stack.length = 0;
  }
}

// Vector content of one page (paths flattened to polylines, text, JPEG images)
// in pt, origin bottom-left of the displayed page.
export async function readPdfVector(buf: Uint8Array, pageIndex = 0): Promise<PdfVector> {
  const doc = new PdfDoc(buf);
  await doc.init();
  const pg = doc.pages()[pageIndex];
  if (!pg) throw new Error('PDF page not found');
  const c = doc.get(pg.d.Contents);
  let data = '';
  for (const r of Array.isArray(c) ? c : [pg.d.Contents]) data += bin(await doc.streamOf(r)) + '\n';
  const [x0, y0, x1, y1] = pg.box, W = x1 - x0, H = y1 - y0, rotate = pg.rotate;
  const raw: PdfVector = { width: W, height: H, paths: [], texts: [], images: [], truncated: false };
  await runPaths(doc, data, pg.res, ID, raw, 0);
  const glyphs: Glyphs[] = [];
  await runContent(doc, data, pg.res, ID, glyphs, new Map(), 0);
  const rot = (x: number, y: number): [number, number] => {
    const u = x - x0, v = y - y0;
    if (rotate === 90) return [v, W - u];
    if (rotate === 180) return [W - u, H - v];
    if (rotate === 270) return [H - v, u];
    return [u, v];
  };
  const turned = rotate === 90 || rotate === 270;
  return {
    width: turned ? H : W,
    height: turned ? W : H,
    paths: raw.paths.map((p) => ({ closed: p.closed, pts: p.pts.map(([x, y]) => rot(x, y)) })),
    texts: glyphs.map((g) => { const [x, y] = rot(g.x, g.y); return { x, y, s: g.s.replace(/\s+/g, ' ').trim(), size: g.size, rot: ((g.dir * 180) / Math.PI) - rotate }; }).filter((t) => t.s),
    images: raw.images.map((im) => {
      const [ax, ay] = rot(im.x, im.y), [bx, by] = rot(im.x + im.w, im.y + im.h);
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), jpeg: im.jpeg };
    }),
    truncated: raw.truncated,
  };
}
