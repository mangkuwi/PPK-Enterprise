/**
 * Pemindai OOXML (WordprocessingML) berbasis teks mentah. TIDAK mem-parse lalu men-serialize ulang XML,
 * sehingga semua byte di luar isi elemen <w:t> yang diedit tetap identik dengan sumber.
 */
export interface Seg { tagStart: number; contentStart: number; contentEnd: number; openTag: string; text: string }
export interface Item { start: number; end: number; seg?: Seg; virt?: string }
export interface TableRef { tbl: number; tr: number; tc: number }
export interface Para {
  part: string;
  index: number; // urutan kemunculan <w:p> pada part
  xmlStart: number;
  xmlEnd: number;
  text: string;
  items: Item[];
  table?: TableRef;
  inTc: boolean;
  depth: number; // 0 = paragraf tingkat atas (bukan di dalam kotak teks)
  hasField: boolean;
  hasNested: boolean;
  hasDrawing: boolean;
  isList: boolean;
  align?: string;
  style?: string;
  bold?: boolean;
  underline?: boolean;
  size?: number; // pt
  pageBreakBefore?: boolean;
  hasPageBreak?: boolean;
}
export interface Row { tbl: number; tr: number; xmlStart: number; xmlEnd: number; depth: number; paraIdx: number[]; cells: number }
export interface Scan { part: string; xml: string; paras: Para[]; rows: Row[]; tables: number }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    return ENT[e] ?? '';
  });
}
export const encodeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TAG = /<(\/?)w:(p|t|tab|br|cr|tc|tr|tbl|pPr|fldChar|fldSimple|noBreakHyphen|drawing|pict)(?=[\s/>])([^>]*)>/g;
const attr = (s: string, name: string) => new RegExp(`w:${name}="([^"]*)"`).exec(s)?.[1];
const onOff = (rpr: string, tag: string) => {
  const m = new RegExp(`<w:${tag}(?:\\s+([^>]*?))?\\/?>`).exec(rpr);
  if (!m) return false;
  const v = /w:val="([^"]*)"/.exec(m[1] ?? '')?.[1];
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
};

interface OpenPara { para: Para; pPr?: string }

export function scanPart(part: string, xml: string): Scan {
  const paras: Para[] = [];
  const rows: Row[] = [];
  const pStack: OpenPara[] = [];
  const tblStack: Array<{ id: number; tr: number; tc: number; rowIdx: number }> = [];
  const rowStack: Row[] = [];
  let tables = 0;
  let pCounter = 0;
  let inPPr = false; let pPrStart = 0;
  let tcDepth = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml))) {
    const closing = m[1] === '/';
    const name = m[2];
    const attrs = m[3] ?? '';
    const selfClose = attrs.trimEnd().endsWith('/');
    const top = pStack[pStack.length - 1];
    switch (name) {
      case 'tbl':
        if (closing) { tblStack.pop(); } else { tblStack.push({ id: tables++, tr: -1, tc: -1, rowIdx: -1 }); }
        break;
      case 'tr':
        if (closing) { const r = rowStack.pop(); if (r) r.xmlEnd = m.index + m[0].length; if (tblStack.length) tblStack[tblStack.length - 1].tc = -1; }
        else if (!selfClose) {
          const t = tblStack[tblStack.length - 1];
          if (t) {
            t.tr++; t.tc = -1;
            const r: Row = { tbl: t.id, tr: t.tr, xmlStart: m.index, xmlEnd: -1, depth: tblStack.length - 1, paraIdx: [], cells: 0 };
            rows.push(r); rowStack.push(r);
          }
        }
        break;
      case 'tc':
        if (closing) { tcDepth--; }
        else if (!selfClose) { tcDepth++; const t = tblStack[tblStack.length - 1]; if (t) { t.tc++; const r = rowStack[rowStack.length - 1]; if (r) r.cells++; } }
        break;
      case 'p': {
        if (closing) {
          const op = pStack.pop();
          if (op) {
            op.para.xmlEnd = m.index + m[0].length;
            finalize(op.para);
            if (op.pPr) applyPPr(op.para, op.pPr);
          }
        } else if (selfClose) {
          // paragraf kosong tertutup sendiri: <w:p/>
          const p = newPara(m.index, m.index + m[0].length);
          p.xmlEnd = m.index + m[0].length;
          finalize(p);
        } else {
          if (top) top.para.hasNested = true;
          const p = newPara(m.index, -1);
          pStack.push({ para: p });
        }
        break;
      }
      case 'pPr':
        if (!top) break;
        if (closing) { if (inPPr) { top.pPr = xml.slice(pPrStart, m.index); inPPr = false; } }
        else if (!selfClose) { inPPr = true; pPrStart = m.index + m[0].length; }
        else { top.pPr = ''; }
        break;
      case 't': {
        if (closing || !top) break;
        if (selfClose) break;
        const end = xml.indexOf('</w:t>', TAG.lastIndex);
        if (end < 0) break;
        const text = decodeXml(xml.slice(TAG.lastIndex, end));
        const seg: Seg = { tagStart: m.index, contentStart: TAG.lastIndex, contentEnd: end, openTag: m[0], text };
        const p = top.para;
        const start = p.text.length;
        p.text += text;
        p.items.push({ start, end: start + text.length, seg });
        TAG.lastIndex = end + '</w:t>'.length;
        break;
      }
      case 'tab':
        if (!top || inPPr || closing) break;
        virt(top.para, '\t');
        break;
      case 'br':
        if (!top || closing) break;
        if (attr(attrs, 'type') === 'page') top.para.hasPageBreak = true;
        else virt(top.para, '\n');
        break;
      case 'cr': if (top && !closing) virt(top.para, '\n'); break;
      case 'noBreakHyphen': if (top && !closing) virt(top.para, '-'); break;
      case 'fldChar': case 'fldSimple': if (top && !closing) top.para.hasField = true; break;
      case 'drawing': case 'pict': if (top && !closing) top.para.hasDrawing = true; break;
      default: break;
    }
  }

  function newPara(xmlStart: number, xmlEnd: number): Para {
    const t = tblStack[tblStack.length - 1];
    const p: Para = {
      part, index: pCounter++, xmlStart, xmlEnd, text: '', items: [],
      table: t && tcDepth > 0 ? { tbl: t.id, tr: t.tr, tc: t.tc } : undefined,
      inTc: tcDepth > 0, depth: pStack.length, hasField: false, hasNested: false, hasDrawing: false, isList: false
    };
    paras.push(p);
    return p;
  }
  function virt(p: Para, ch: string) {
    const start = p.text.length;
    p.text += ch;
    p.items.push({ start, end: start + 1, virt: ch });
  }
  function finalize(p: Para) {
    const r = rowStack[rowStack.length - 1];
    if (r && p.table) r.paraIdx.push(p.index);
  }
  function applyPPr(p: Para, pPr: string) {
    p.align = attr(/<w:jc\s[^>]*>/.exec(pPr)?.[0] ?? '', 'val');
    p.style = attr(/<w:pStyle\s[^>]*>/.exec(pPr)?.[0] ?? '', 'val');
    p.isList = /<w:numPr>/.test(pPr) && !/<w:numId\s+w:val="0"/.test(pPr);
    p.pageBreakBefore = /<w:pageBreakBefore\b/.test(pPr);
  }
  const scan: Scan = { part, xml, paras, rows, tables };
  enrichFormatting(scan);
  return scan;
}

/** Lengkapi atribut format (bold/underline/size) setelah scan — dihitung ulang dari run pertama yang berteks. */
export function enrichFormatting(scan: Scan): void {
  for (const p of scan.paras) {
    const seg = p.items.find((i) => i.seg && i.seg.text.trim())?.seg;
    if (!seg) continue;
    const runStart = scan.xml.lastIndexOf('<w:r', seg.tagStart);
    const slice = scan.xml.slice(runStart, seg.tagStart);
    const rpr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(slice)?.[1] ?? '';
    p.bold = onOff(rpr, 'b');
    p.underline = onOff(rpr, 'u');
    const sz = Number(attr(/<w:sz\s[^>]*>/.exec(rpr)?.[0] ?? '', 'val'));
    p.size = sz ? sz / 2 : undefined;
  }
}

/** Bagian-bagian dokumen yang dipindai: isi, header, footer. */
export function documentParts(names: string[]): string[] {
  const body = names.filter((n) => n === 'word/document.xml');
  const hf = names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).sort();
  return [...body, ...hf];
}
export const partLabel = (part: string) =>
  part === 'word/document.xml' ? 'Isi' : /header/.test(part) ? `Header (${part.replace(/\D/g, '') || '1'})` : `Footer (${part.replace(/\D/g, '') || '1'})`;
