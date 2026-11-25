import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import { fieldsFromDoc } from '@shared/placeholder';
import type { ImportedTemplate, TipTapNode } from '@shared/types';
import { parseXml, type XNode } from './xml';

/** Bagian-bagian berkas .docx (sudah diekstrak dari zip) yang dibutuhkan konverter. */
export interface DocxParts {
  document: string;
  styles?: string;
  numbering?: string;
  rels?: string; // word/_rels/document.xml.rels
  theme?: string;
  part(path: string): string | undefined;
  media(path: string): Uint8Array | undefined;
}

interface RP { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; size?: number; font?: string }
interface PP { jc?: string; left?: number; numId?: number; ilvl?: number; line?: number }
interface Style { id: string; basedOn?: string; rpr: RP; ppr: PP; borders?: 'none' | 'some' }
type Kind = 'bullet' | 'ordered';
type Mark = { type: string; attrs?: Record<string, unknown> };

const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => c.name === name);
function* walk(n: XNode): Generator<XNode> { for (const c of n.children) { yield c; yield* walk(c); } }
const find = (n: XNode | undefined, name: string) => { if (n) for (const d of walk(n)) if (d.name === name) return d; return undefined; };
const findAll = (n: XNode | undefined, name: string) => (n ? [...walk(n)].filter((d) => d.name === name) : []);
const val = (n?: XNode) => n?.attrs.val;
const num = (v?: string) => { if (v === undefined || v === '') return undefined; const x = Number(v); return Number.isFinite(x) ? x : undefined; };
const onOff = (n?: XNode): boolean | undefined => (n ? !['0', 'false', 'off', 'none'].includes((n.attrs.val ?? '1').toLowerCase()) : undefined);

function merge<T extends object>(...parts: T[]): T {
  const out: Record<string, unknown> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = v;
  return out as T;
}

const NBSP4 = '\u00a0\u00a0\u00a0\u00a0';
const MERGE_SYNTAX = /\{\{\s*([A-Za-z][A-Za-z0-9_ ]{0,58}?)\s*\}\}|«\s*([A-Za-z][A-Za-z0-9_ ]{0,58}?)\s*»|<<\s*([A-Za-z][A-Za-z0-9_ ]{0,58}?)\s*>>/g;
const BLANKS = /\.{5,}|…{2,}|_{4,}/g;
const BORDER_KEYS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

function bordersOf(el?: XNode): 'none' | 'some' | undefined {
  if (!el) return undefined;
  return BORDER_KEYS.some((k) => { const b = kid(el, k); return b && !['nil', 'none'].includes((b.attrs.val ?? '').toLowerCase()); }) ? 'some' : 'none';
}

function imageType(b: Uint8Array): 'png' | 'jpeg' | 'gif' | 'bmp' | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

export function convertDocx(parts: DocxParts): Omit<ImportedTemplate, 'name' | 'description'> {
  const theme = {
    minor: parts.theme ? /<a:minorFont>\s*<a:latin\s+typeface="([^"]*)"/.exec(parts.theme)?.[1] : undefined,
    major: parts.theme ? /<a:majorFont>\s*<a:latin\s+typeface="([^"]*)"/.exec(parts.theme)?.[1] : undefined
  };

  const readRPr = (r?: XNode): RP => {
    if (!r) return {};
    const rf = kid(r, 'rFonts');
    let font = rf?.attrs.ascii ?? rf?.attrs.hAnsi;
    if (!font && rf) { const t = rf.attrs.asciiTheme ?? rf.attrs.hAnsiTheme; if (t) font = /^major/i.test(t) ? theme.major : theme.minor; }
    const sz = num(val(kid(r, 'sz')));
    return { bold: onOff(kid(r, 'b')), italic: onOff(kid(r, 'i')), underline: onOff(kid(r, 'u')), strike: onOff(kid(r, 'strike')), size: sz ? sz / 2 : undefined, font };
  };
  const readPPr = (p?: XNode): PP => {
    if (!p) return {};
    const ind = kid(p, 'ind');
    const numPr = kid(p, 'numPr');
    const sp = kid(p, 'spacing');
    return {
      jc: val(kid(p, 'jc')),
      left: num(ind?.attrs.left ?? ind?.attrs.start),
      numId: numPr ? num(val(kid(numPr, 'numId'))) : undefined,
      ilvl: numPr ? num(val(kid(numPr, 'ilvl'))) : undefined,
      line: sp && (sp.attrs.lineRule === undefined || sp.attrs.lineRule === 'auto') ? num(sp.attrs.line) : undefined
    };
  };

  // ----- styles -----
  const styles = new Map<string, Style>();
  let defRP: RP = {}; let defPP: PP = {}; let defaultParaStyle: string | undefined;
  if (parts.styles) {
    const root = parseXml(parts.styles);
    const dd = kid(root, 'docDefaults');
    defRP = readRPr(kid(kid(dd, 'rPrDefault'), 'rPr'));
    defPP = readPPr(kid(kid(dd, 'pPrDefault'), 'pPr'));
    for (const s of kids(root, 'style')) {
      const id = s.attrs.styleId;
      if (!id) continue;
      if (s.attrs.default === '1' && s.attrs.type === 'paragraph') defaultParaStyle = id;
      styles.set(id, { id, basedOn: val(kid(s, 'basedOn')), rpr: readRPr(kid(s, 'rPr')), ppr: readPPr(kid(s, 'pPr')), borders: bordersOf(kid(kid(s, 'tblPr'), 'tblBorders')) });
    }
  }
  const chain = (id?: string): Style[] => {
    const out: Style[] = []; const seen = new Set<string>();
    let cur = id ? styles.get(id) : undefined;
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.basedOn ? styles.get(cur.basedOn) : undefined; }
    return out;
  };
  const defChain = chain(defaultParaStyle);
  const base: RP = merge(defRP, ...defChain.map((s) => s.rpr));
  const basePP: PP = merge(defPP, ...defChain.map((s) => s.ppr));

  // ----- numbering & relationships -----
  const absFmt = new Map<string, Map<number, string>>();
  const numToAbs = new Map<string, string>();
  if (parts.numbering) {
    const root = parseXml(parts.numbering);
    for (const a of kids(root, 'abstractNum')) {
      const lv = new Map<number, string>();
      for (const l of kids(a, 'lvl')) lv.set(Number(l.attrs.ilvl ?? 0), val(kid(l, 'numFmt')) ?? 'decimal');
      absFmt.set(a.attrs.abstractNumId, lv);
    }
    for (const n of kids(root, 'num')) { const a = val(kid(n, 'abstractNumId')); if (a !== undefined) numToAbs.set(n.attrs.numId, a); }
  }
  const numKind = (numId: number, ilvl: number): Kind => {
    const fmt = absFmt.get(numToAbs.get(String(numId)) ?? '')?.get(ilvl);
    return fmt === 'bullet' || fmt === 'none' ? 'bullet' : 'ordered';
  };
  const rels = new Map<string, string>();
  if (parts.rels) for (const r of kids(parseXml(parts.rels), 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target);
  const relPath = (id?: string) => { const t = id ? rels.get(id) : undefined; return t ? (t.startsWith('/') ? t.slice(1) : `word/${t}`) : undefined; };

  // ----- bagian dokumen & tata letak -----
  const docRoot = parseXml(parts.document);
  const body = kid(docRoot, 'body') ?? docRoot;
  const sect = kid(body, 'sectPr');
  const mar = kid(sect, 'pgMar');
  const mm = (v?: string, d = 25) => { const n = num(v); return n === undefined ? d : Math.max(0, Math.min(80, Math.round(n / 56.6929))); };
  const layout = layoutFromSettings(DEFAULT_SETTINGS);
  layout.fontFamily = base.font ?? layout.fontFamily;
  layout.fontSize = base.size ?? 12;
  if (basePP.line) layout.lineHeight = Math.max(1, Math.min(3, Math.round((basePP.line / 240) * 100) / 100));
  if (mar) {
    layout.marginTop = mm(mar.attrs.top); layout.marginBottom = mm(mar.attrs.bottom);
    layout.marginLeft = mm(mar.attrs.left, 30); layout.marginRight = mm(mar.attrs.right);
  }
  const contentPx = ((210 - layout.marginLeft - layout.marginRight) * 96) / 25.4;

  const stat = { textbox: 0, vml: 0, floating: 0, imgSkipped: 0, hfRich: 0, blanks: 0, converted: 0 };

  // ----- konversi teks & run -----
  const marksFor = (rp: RP): Mark[] => {
    const m: Mark[] = [];
    if (rp.bold) m.push({ type: 'bold' });
    if (rp.italic) m.push({ type: 'italic' });
    if (rp.underline) m.push({ type: 'underline' });
    if (rp.strike) m.push({ type: 'strike' });
    const ts: Record<string, unknown> = {};
    if (rp.size && rp.size !== base.size) ts.fontSize = `${rp.size}pt`;
    if (rp.font && rp.font !== base.font) ts.fontFamily = rp.font;
    if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: ts });
    return m;
  };

  interface PState { blocks: TipTapNode[]; inline: TipTapNode[] }
  const pushText = (st: PState, text: string, marks: Mark[]) => {
    if (!text) return;
    const last = st.inline[st.inline.length - 1];
    const key = JSON.stringify(marks);
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === key) { last.text += text; return; }
    st.inline.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
  };
  const flush = (st: PState, attrs: Record<string, unknown>) => {
    if (!st.inline.length) return;
    for (const n of st.inline) {
      if (n.type !== 'text' || !n.text) continue;
      const t = n.text.replace(MERGE_SYNTAX, (_m, a, b, c) => { stat.converted++; return `[${String(a ?? b ?? c).trim().toUpperCase().replace(/\s+/g, '_')}]`; });
      stat.blanks += (t.match(BLANKS) ?? []).length;
      n.text = t;
    }
    st.blocks.push({ type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), content: st.inline });
    st.inline = [];
  };

  const imageNode = (drawing: XNode): TipTapNode | null => {
    if (find(drawing, 'txbxContent')) { stat.textbox++; return null; }
    const blip = find(drawing, 'blip');
    const path = relPath(blip?.attrs.embed);
    const data = path ? parts.media(path) : undefined;
    const type = data ? imageType(data) : null;
    if (!data || !type || data.length > 5 * 1024 * 1024) { stat.imgSkipped++; return null; }
    if (kid(drawing, 'anchor')) stat.floating++;
    const cx = num(find(drawing, 'extent')?.attrs.cx);
    const width = Math.max(10, Math.min(Math.round(cx ? cx / 9525 : 300), Math.round(contentPx)));
    return { type: 'image', attrs: { src: `data:image/${type};base64,${toBase64(data)}`, width } };
  };

  const processRun = (r: XNode, runBase: RP, st: PState, attrs: Record<string, unknown>) => {
    const rp = merge(runBase, ...chain(val(kid(kid(r, 'rPr'), 'rStyle'))).map((s) => s.rpr), readRPr(kid(r, 'rPr')));
    const marks = marksFor(rp);
    const handle = (children: XNode[]) => {
      for (const c of children) {
        switch (c.name) {
          case 't': pushText(st, c.text, marks); break;
          case 'tab': pushText(st, NBSP4, marks); break;
          case 'noBreakHyphen': pushText(st, '-', marks); break;
          case 'br':
            if (c.attrs.type === 'page') { flush(st, attrs); st.blocks.push({ type: 'pageBreak' }); }
            else if (c.attrs.type !== 'column') { st.inline.push({ type: 'hardBreak' }); }
            break;
          case 'cr': st.inline.push({ type: 'hardBreak' }); break;
          case 'drawing': {
            const img = imageNode(c);
            if (img) { flush(st, attrs); st.blocks.push(img); }
            break;
          }
          case 'pict': case 'object': stat.vml++; break;
          case 'AlternateContent': handle(kid(c, 'Choice')?.children ?? []); break;
          default: break;
        }
      }
    };
    handle(r.children);
  };

  const walkInline = (n: XNode, runBase: RP, st: PState, attrs: Record<string, unknown>) => {
    for (const c of n.children) {
      if (c.name === 'r') processRun(c, runBase, st, attrs);
      else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent', 'customXml'].includes(c.name)) walkInline(c, runBase, st, attrs);
    }
  };

  interface PResult { blocks: TipTapNode[]; list?: { kind: Kind; level: number } }
  const paragraphBlocks = (p: XNode): PResult => {
    const ppr = kid(p, 'pPr');
    const sChain = chain(val(kid(ppr, 'pStyle')));
    const pp = merge(...sChain.map((s) => s.ppr), readPPr(ppr));
    const runBase = merge(base, ...sChain.map((s) => s.rpr));
    const attrs: Record<string, unknown> = {};
    const jc = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[pp.jc ?? ''];
    if (jc) attrs.textAlign = jc;
    const isList = !!pp.numId && pp.numId !== 0;
    if (!isList && pp.left && pp.left > 100) { const lvl = Math.min(8, Math.round(pp.left / 709)); if (lvl > 0) attrs.indent = lvl; }
    const st: PState = { blocks: [], inline: [] };
    if (kid(ppr, 'pageBreakBefore')) st.blocks.push({ type: 'pageBreak' });
    walkInline(p, runBase, st, attrs);
    if (st.inline.length) flush(st, attrs);
    else if (!st.blocks.some((b) => b.type === 'paragraph' || b.type === 'image')) {
      if (!st.blocks.length || !st.blocks.every((b) => b.type === 'pageBreak')) st.blocks.push({ type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}) });
    }
    return { blocks: st.blocks, list: isList ? { kind: numKind(pp.numId as number, pp.ilvl ?? 0), level: Math.min(8, pp.ilvl ?? 0) } : undefined };
  };

  // ----- blok: daftar & tabel -----
  interface LS { kind: Kind; level: number; node: TipTapNode }
  const addListItem = (stack: LS[], out: TipTapNode[], kind: Kind, level: number, blocks: TipTapNode[]) => {
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level && top.kind !== kind) { stack.pop(); top = stack[stack.length - 1]; }
    if (!top || top.level < level) {
      const node: TipTapNode = { type: kind === 'ordered' ? 'orderedList' : 'bulletList', content: [] };
      if (top) { const parent = top.node.content![top.node.content!.length - 1]; parent.content!.push(node); } else out.push(node);
      top = { kind, level, node };
      stack.push(top);
    }
    const content = blocks[0]?.type === 'paragraph' ? blocks : [{ type: 'paragraph' }, ...blocks];
    top.node.content!.push({ type: 'listItem', content });
  };

  const convertBlocks = (nodes: XNode[]): TipTapNode[] => {
    const out: TipTapNode[] = [];
    let stack: LS[] = [];
    const flat = nodes.flatMap((n) => (n.name === 'sdt' ? kid(n, 'sdtContent')?.children ?? [] : [n]));
    for (const n of flat) {
      if (n.name === 'p') {
        const r = paragraphBlocks(n);
        if (r.list) addListItem(stack, out, r.list.kind, r.list.level, r.blocks);
        else { stack = []; out.push(...r.blocks); }
      } else if (n.name === 'tbl') { stack = []; out.push(tableNode(n)); }
    }
    return out;
  };

  const tableNode = (tbl: XNode): TipTapNode => {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => num(g.attrs.w) ?? 0);
    const tblPr = kid(tbl, 'tblPr');
    let verdict = bordersOf(kid(tblPr, 'tblBorders'));
    if (verdict === undefined) {
      for (const s of [...chain(val(kid(tblPr, 'tblStyle')))].reverse()) if (s.borders !== undefined) { verdict = s.borders; break; }
    }
    if (verdict === undefined) verdict = bordersOf(find(tbl, 'tcBorders'));
    const rows: TipTapNode[] = [];
    const open: Array<TipTapNode | undefined> = [];
    for (const tr of kids(tbl, 'tr')) {
      const header = !!kid(kid(tr, 'trPr'), 'tblHeader');
      const cells: TipTapNode[] = [];
      let col = 0;
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = Math.max(1, num(val(kid(tcPr, 'gridSpan'))) ?? 1);
        const vm = kid(tcPr, 'vMerge');
        if (vm && (vm.attrs.val === undefined || vm.attrs.val === 'continue')) {
          const o = open[col];
          if (o) o.attrs!.rowspan += 1;
          col += span; continue;
        }
        const ws = Array.from({ length: span }, (_, i) => Math.round((grid[col + i] ?? 0) / 15));
        let content = convertBlocks(tc.children);
        if (!content.length) content = [{ type: 'paragraph' }];
        const cell: TipTapNode = { type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: span, rowspan: 1, colwidth: ws.every((w) => w > 0) ? ws : null }, content };
        for (let i = 0; i < span; i++) open[col + i] = vm ? cell : undefined;
        cells.push(cell);
        col += span;
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells });
    }
    if (!rows.length) return { type: 'paragraph' };
    return { type: 'table', attrs: { borderless: verdict !== 'some' }, content: rows };
  };

  // ----- header & footer -----
  const headerFooter = (refName: 'headerReference' | 'footerReference') => {
    const ref = kids(sect, refName).find((r) => (r.attrs.type ?? 'default') === 'default');
    const path = relPath(ref?.attrs.id);
    const xml = path ? parts.part(path) : undefined;
    if (!xml) return { text: '', page: false };
    const root = parseXml(xml);
    if (findAll(root, 'tbl').length || findAll(root, 'drawing').length || findAll(root, 'pict').length) stat.hfRich++;
    let page = false;
    const lines: string[] = [];
    for (const p of kids(root, 'p')) {
      let line = ''; let inField = false; let result = false; let skip = false; let instr = '';
      const visit = (n: XNode) => {
        for (const c of n.children) {
          if (c.name === 'r') {
            for (const rc of c.children) {
              if (rc.name === 'fldChar') {
                const t = rc.attrs.fldCharType;
                if (t === 'begin') { inField = true; instr = ''; result = false; skip = false; }
                else if (t === 'separate') { result = true; skip = /\b(PAGE|NUMPAGES|SECTIONPAGES)\b/i.test(instr); if (skip) page = true; }
                else if (t === 'end') { inField = false; result = false; skip = false; }
              } else if (rc.name === 'instrText') instr += rc.text;
              else if (rc.name === 't' && !(inField && !result) && !skip) line += rc.text;
              else if (rc.name === 'tab') line += ' ';
            }
          } else if (c.name === 'fldSimple') { if (/PAGE|NUMPAGES/i.test(c.attrs.instr ?? '')) page = true; else visit(c); }
          else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent'].includes(c.name)) visit(c);
        }
      };
      visit(p);
      if (line.trim()) lines.push(line.trim());
    }
    let text = lines.join('\n');
    if (page) text = text.replace(/\b(halaman|page|hal\.?)\b\s*(dari|of|\/)?/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
    return { text, page };
  };
  const header = headerFooter('headerReference');
  const footer = headerFooter('footerReference');
  if (footer.page) layout.showPageNumber = true;

  // ----- isi -----
  const blocks = convertBlocks(body.children);
  while (blocks.length > 1 && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content) blocks.pop();
  const content: TipTapNode = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };

  const warnings: string[] = [];
  if (stat.converted) warnings.push(`${stat.converted} penanda gaya Word ({{nama}}, «Nama», <<nama>>) dikonversi menjadi placeholder [NAMA].`);
  if (stat.blanks) warnings.push(`Ditemukan ${stat.blanks} isian kosong berbentuk titik-titik/garis bawah. Pilih teksnya di editor lalu klik "Sisipkan" untuk menggantinya dengan placeholder.`);
  if (stat.textbox) warnings.push(`${stat.textbox} kotak teks (text box) tidak diimpor. Pindahkan isinya ke paragraf biasa di Word.`);
  if (stat.vml) warnings.push(`${stat.vml} objek lama (gambar VML/OLE/bentuk) tidak diimpor.`);
  if (stat.imgSkipped) warnings.push(`${stat.imgSkipped} gambar dilewati (format tidak didukung — hanya PNG/JPEG/GIF/BMP — atau lebih dari 5 MB).`);
  if (stat.floating) warnings.push(`${stat.floating} gambar mengambang dijadikan gambar sebaris; periksa posisinya.`);
  if (stat.hfRich) warnings.push('Header/footer Word berisi gambar atau tabel yang tidak diimpor. Pakai Kop Surat di Pengaturan untuk logo dan alamat instansi.');
  warnings.push('Periksa hasil impor (spasi, tabel, pemisah halaman) sebelum menyimpan; tampilan Word tidak selalu identik.');

  return { content, header_text: header.text, footer_text: footer.text, layout, fields: fieldsFromDoc(content), warnings };
}
