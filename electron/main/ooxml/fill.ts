import { Zip } from './zip';
import { encodeXml, documentParts, scanPart, type Para, type Seg } from './scan';

/** Operasi penggantian pada koordinat string XML mentah. */
export interface Op { start: number; end: number; text: string }
/** Penggantian teks pada koordinat TEKS PARAGRAF (offset karakter). */
export interface Cut { para: Para; start: number; end: number; text: string }

export const TOKEN_SRC = String.raw`\{\{\s*(\??)([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?)\s*\}\}`;
export const tokenRegex = () => new RegExp(TOKEN_SRC, 'g');

function withPreserve(openTag: string): string {
  return /xml:space=/.test(openTag) ? openTag : openTag.replace(/>$/, ' xml:space="preserve">');
}

/** Bentuk elemen <w:t> baru; baris baru dan tab menjadi <w:br/>/<w:tab/> dalam run yang sama (format run tidak berubah). */
export function renderT(openTag: string, text: string): string {
  const open = withPreserve(openTag);
  let out = open;
  for (const part of text.replace(/\r\n?/g, '\n').split(/(\n|\t)/)) {
    if (part === '\n') out += `</w:t><w:br/>${open}`;
    else if (part === '\t') out += `</w:t><w:tab/>${open}`;
    else out += encodeXml(part);
  }
  return `${out}</w:t>`;
}

/** Ubah daftar Cut (offset teks paragraf) menjadi operasi XML. Satu elemen <w:t> hanya ditulis ulang sekali. */
export function planCuts(cuts: Cut[]): Op[] {
  const perSeg = new Map<Seg, Array<{ a: number; b: number; ins: string }>>();
  for (const c of cuts) {
    const { para, start, end } = c;
    if (start < 0 || end < start || end > para.text.length) throw new Error(`Rentang teks tidak valid pada paragraf ${para.index}.`);
    const hit = para.items.filter((i) => i.start < end && i.end > start);
    if (hit.some((i) => i.virt)) throw new Error('Pilihan teks tidak boleh melewati tab atau baris baru.');
    let targets = hit.filter((i) => i.seg);
    if (start === end) {
      const at = para.items.find((i) => i.seg && i.start <= start && start <= i.end);
      if (!at) throw new Error('Titik sisip tidak berada di dalam teks.');
      targets = [at];
    }
    if (!targets.length) throw new Error('Rentang teks tidak ditemukan pada dokumen.');
    targets.forEach((it, k) => {
      const seg = it.seg as Seg;
      const a = Math.max(0, start - it.start);
      const b = Math.min(seg.text.length, end - it.start);
      const list = perSeg.get(seg) ?? [];
      list.push({ a, b, ins: k === 0 ? c.text : '' });
      perSeg.set(seg, list);
    });
  }
  const ops: Op[] = [];
  for (const [seg, list] of perSeg) {
    list.sort((x, y) => x.a - y.a);
    let text = ''; let pos = 0;
    for (const e of list) {
      if (e.a < pos) throw new Error('Dua pemetaan saling tumpang tindih.');
      text += seg.text.slice(pos, e.a) + e.ins;
      pos = e.b;
    }
    text += seg.text.slice(pos);
    ops.push({ start: seg.tagStart, end: seg.contentEnd + '</w:t>'.length, text: renderT(seg.openTag, text) });
  }
  return ops;
}

export function applyOps(xml: string, ops: Op[]): string {
  const sorted = [...ops].sort((a, b) => b.start - a.start);
  let out = xml;
  let limit = Infinity;
  for (const op of sorted) {
    if (op.end > limit) throw new Error('Operasi XML saling tumpang tindih.');
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
    limit = op.start;
  }
  return out;
}

const hasSect = (xml: string, p: Para) => xml.slice(p.xmlStart, p.xmlEnd).includes('<w:sectPr');

export interface FillResult { xml: string; filled: string[]; unresolved: string[]; removed: string[] }
export interface FillOptions { values: Record<string, string>; optionalKeys?: Set<string>; noGroups?: boolean }

const toLines = (v: string) => v.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');

/** Isi seluruh penanda {{KEY}} pada satu part XML. Format dokumen (run, paragraf, tabel) dipertahankan. */
export function fillXml(part: string, xml: string, o: FillOptions): FillResult {
  const filled = new Set<string>(); const unresolved = new Set<string>(); const removed = new Set<string>();
  let cur = xml;

  // ---- 1. baris tabel berulang: {{GRUP.KOLOM}} ----
  if (!o.noGroups) {
    const sc = scanPart(part, cur);
    const groupOf = (rowParas: Para[]) => {
      for (const p of rowParas) for (const m of p.text.matchAll(tokenRegex())) if (m[2].includes('.')) return m[2].split('.')[0];
      return null;
    };
    const chosen: Array<{ start: number; end: number; group: string; tbl: number }> = [];
    for (const row of [...sc.rows].sort((a, b) => a.xmlStart - b.xmlStart)) {
      if (chosen.length && row.xmlStart < chosen[chosen.length - 1].end) continue;
      const rowParas = sc.paras.filter((p) => p.xmlStart >= row.xmlStart && p.xmlEnd <= row.xmlEnd);
      const g = groupOf(rowParas);
      if (g) chosen.push({ start: row.xmlStart, end: row.xmlEnd, group: g, tbl: row.tbl });
    }
    const ops: Op[] = [];
    for (const c of chosen) {
      const rowXml = cur.slice(c.start, c.end);
      let items: Array<Record<string, string>> = [];
      try { const parsed = JSON.parse(o.values[`@${c.group}`] ?? '[]'); if (Array.isArray(parsed)) items = parsed; } catch { /* kosong */ }
      const siblings = sc.rows.filter((r) => r.tbl === c.tbl).length;
      if (!items.length) {
        if (siblings > 1) { ops.push({ start: c.start, end: c.end, text: '' }); removed.add(c.group); }
        else unresolved.add(c.group);
        continue;
      }
      const out = items.map((item, i) => {
        const flat: Record<string, string> = { ...o.values, [`${c.group}.NO`]: String(i + 1) };
        for (const [k, v] of Object.entries(item)) flat[`${c.group}.${k}`] = String(v ?? '');
        const r = fillXml(part, rowXml, { ...o, values: flat, noGroups: true });
        r.filled.forEach((k) => filled.add(k)); r.unresolved.forEach((k) => unresolved.add(k)); r.removed.forEach((k) => removed.add(k));
        return r.xml;
      });
      filled.add(c.group);
      ops.push({ start: c.start, end: c.end, text: out.join('') });
    }
    cur = applyOps(cur, ops);
  }

  // ---- 2. penanda pada paragraf ----
  const sc = scanPart(part, cur);
  const ops: Op[] = [];
  for (const para of sc.paras) {
    if (!para.text.includes('{{')) continue;
    const tokens = [...para.text.matchAll(tokenRegex())];
    if (!tokens.length) continue;
    const whole = tokens.length === 1 && para.text.trim() === tokens[0][0];
    const plain = para.depth === 0 && !para.hasNested && !para.hasField && !hasSect(cur, para);
    const cuts: Cut[] = [];
    for (const m of tokens) {
      const key = m[2];
      const raw = o.values[key];
      const has = raw !== undefined && raw.trim() !== '';
      const start = m.index as number; const end = start + m[0].length;
      if (has) {
        filled.add(key);
        if (whole && plain && raw.replace(/\n+$/, '').includes('\n')) {
          const frag = cur.slice(para.xmlStart, para.xmlEnd);
          const pieces = toLines(raw).map((line) => {
            const f = scanPart(part, frag).paras[0];
            return applyOps(frag, planCuts([{ para: f, start, end, text: line }]));
          });
          ops.push({ start: para.xmlStart, end: para.xmlEnd, text: pieces.join('') });
          cuts.length = 0;
          break;
        }
        cuts.push({ para, start, end, text: raw.replace(/\n+$/, '') });
      } else if (m[1] === '?' || o.optionalKeys?.has(key)) {
        removed.add(key);
        if (whole && plain && !para.inTc && !para.hasDrawing) {
          ops.push({ start: para.xmlStart, end: para.xmlEnd, text: '' });
          cuts.length = 0;
          break;
        }
        cuts.push({ para, start, end, text: '' });
      } else {
        unresolved.add(key);
      }
    }
    if (cuts.length) ops.push(...planCuts(cuts));
  }
  cur = applyOps(cur, ops);
  return { xml: cur, filled: [...filled], unresolved: [...unresolved], removed: [...removed] };
}

export interface FillZipResult { zip: Zip; filled: string[]; unresolved: string[]; removed: string[] }

/** Isi salinan DOCX; berkas input tidak diubah. */
export function fillZip(src: Zip, o: FillOptions): FillZipResult {
  const out = src.clone();
  const filled = new Set<string>(); const unresolved = new Set<string>(); const removed = new Set<string>();
  for (const part of documentParts(src.names())) {
    const xml = src.text(part);
    if (xml === undefined || !xml.includes('{{')) continue;
    const r = fillXml(part, xml, o);
    r.filled.forEach((k) => filled.add(k)); r.unresolved.forEach((k) => unresolved.add(k)); r.removed.forEach((k) => removed.add(k));
    if (r.xml !== xml) out.set(part, r.xml);
  }
  return { zip: out, filled: [...filled], unresolved: [...unresolved], removed: [...removed] };
}

/** Daftar penanda yang ada pada DOCX (urut kemunculan). */
export function listTokens(src: Zip): Array<{ key: string; optional: boolean; part: string }> {
  const seen = new Map<string, { key: string; optional: boolean; part: string }>();
  for (const part of documentParts(src.names())) {
    const xml = src.text(part);
    if (!xml || !xml.includes('{{')) continue;
    for (const p of scanPart(part, xml).paras) for (const m of p.text.matchAll(tokenRegex())) {
      const prev = seen.get(m[2]);
      if (!prev) seen.set(m[2], { key: m[2], optional: m[1] === '?', part });
      else prev.optional = prev.optional && m[1] === '?';
    }
  }
  return [...seen.values()];
}
