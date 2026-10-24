import { entries, readEntry, unxml } from './xlsx-read.js';

// Word (.docx) reader: body paragraphs and tables from word/document.xml.
export interface DocxRead { lines: string[]; tables: string[][][] }

const runText = (xml: string) => unxml([...xml.matchAll(/<w:(t|tab|br)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)/g)].map((m) => (m[1] === 't' ? m[2] ?? '' : m[1] === 'tab' ? '\t' : '\n')).join(''));
const paras = (xml: string) => [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => runText(m[0]));

export async function readDocx(buf: Uint8Array): Promise<DocxRead> {
  const list = entries(buf);
  const e = list.find((x) => x.name === 'word/document.xml');
  if (!e) throw new Error('Not a Word .docx file (word/document.xml missing)');
  const xml = await readEntry(buf, e);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const lines: string[] = [];
  const tables: string[][][] = [];
  // walk top-level blocks in order; nested tables are flattened into their cell text
  const re = /<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) {
      const rows = [...m[1].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => paras(c[0]).join(' ').replace(/\s+/g, ' ').trim()));
      tables.push(rows);
      for (const r of rows) lines.push(r.filter(Boolean).join('\t'));
    } else for (const ln of runText(m[0]).split('\n')) if (ln.trim()) lines.push(ln);
  }
  return { lines, tables };
}
