/**
 * Pengenalan varian template: halaman-halaman (dipisah pemisah halaman eksplisit) yang strukturnya sama
 * dan hanya berbeda di wilayah tertentu (mis. kolom paraf A/B) didaftarkan sebagai VARIAN dari SATU template.
 *
 * Seluruhnya berbasis teks mentah OOXML (tanpa serialisasi ulang). Berkas sumber tidak pernah diubah;
 * pemilihan varian hanya memproyeksikan SALINAN KERJA (mengeluarkan blok halaman varian lain).
 *
 * Batasan: OOXML tidak menyimpan pagination otomatis. "Halaman" di sini = bagian di antara pemisah halaman eksplisit
 * (<w:br w:type="page"/> atau pageBreakBefore). Pemisah section tidak dipakai untuk memilih varian (lihat `selectable`).
 */
import { randomUUID } from 'node:crypto';
import {
  isApplied, paraKey, variantApplied, type GroupRec, type MappingRec, type VariantDiff, type VariantGroup, type VariantItem, type VariantParaInfo
} from '@shared/importer';
import { structureSignature } from './inspect';
import { scanPart, type Para, type Scan } from './scan';
import { Zip } from './zip';

const BODY = 'word/document.xml';

// ============================================================ pemecahan badan dokumen ============================================================
export interface Block { kind: 'p' | 'tbl' | 'sdt' | 'sect' | 'other'; start: number; end: number }

/** Anak langsung <w:body> (tingkat atas). Mengembalikan null bila badan tidak ditemukan. */
export function splitBody(xml: string): Block[] | null {
  const open = /<w:body(?:\s[^>]*)?>/.exec(xml);
  const close = xml.lastIndexOf('</w:body>');
  if (!open || close < 0) return null;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s[^>]*?)?)(\/?)>/g;
  re.lastIndex = open.index + open[0].length;
  const kindOf = (n: string): Block['kind'] => (n === 'w:p' ? 'p' : n === 'w:tbl' ? 'tbl' : n === 'w:sdt' ? 'sdt' : n === 'w:sectPr' ? 'sect' : 'other');
  const blocks: Block[] = [];
  let depth = 0; let start = -1; let name = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && m.index < close) {
    if (!m[2]) continue;
    if (m[1] === '/') { depth--; if (depth === 0) blocks.push({ kind: kindOf(name), start, end: m.index + m[0].length }); }
    else if (m[4] === '/') { if (depth === 0) blocks.push({ kind: kindOf(m[2]), start: m.index, end: m.index + m[0].length }); }
    else { if (depth === 0) { start = m.index; name = m[2]; } depth++; }
  }
  return blocks;
}

export interface Segment {
  index: number; first: number; last: number; xmlStart: number; xmlEnd: number;
  lead: 'none' | 'pbb';
  trail: 'none' | 'brPara' | 'brRun' | 'section';
  /** rentang XML pemisah di akhir segmen yang boleh dibuang (brPara: blok; brRun: run) */
  trailRange?: [number, number];
  unsafe?: string;
}

const BR_PAGE = /<w:br\b[^>]*w:type="page"[^>]*\/>|<w:br\b[^>]*w:type="page"[^>]*>\s*<\/w:br>/g;
const HAS_TEXT = /<w:t(?:\s[^>]*)?>[^<]+<\/w:t>/;

export function segmentBody(xml: string, blocks: Block[]): { segs: Segment[]; notes: string[] } {
  const notes: string[] = [];
  const segs: Segment[] = [];
  const sub = (b: Block) => b.kind === 'p' || b.kind === 'tbl' || b.kind === 'sdt';
  let cur: (Segment & { hasSub: boolean }) | null = null;
  let nextLead: Segment['lead'] = 'none';
  const push = () => { if (cur) { const { hasSub: _h, ...s } = cur; void _h; segs.push({ ...s, index: segs.length }); cur = null; } };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'sect') continue;
    const x = xml.slice(b.start, b.end);
    let pbb = false; let brAfter: Segment['trail'] = 'none'; let range: [number, number] | undefined; let unsafe: string | undefined;
    if (b.kind === 'p') {
      const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(x)?.[0] ?? '';
      pbb = /<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false|off)")/.test(pPr);
      const brs = [...x.matchAll(BR_PAGE)];
      if (brs.length === 1) {
        const br = brs[0]; const at = br.index as number;
        const before = HAS_TEXT.test(x.slice(0, at)); const after = HAS_TEXT.test(x.slice(at + br[0].length));
        if (after) unsafe = 'Pemisah halaman berada di tengah teks paragraf.';
        else if (!before && !/<w:drawing\b|<w:pict\b/.test(x)) { brAfter = 'brPara'; range = [b.start, b.end]; }
        else {
          brAfter = 'brRun';
          const re = /<w:r(?:\s[^>]*)?>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\b[^>]*w:type="page"[^>]*\/><\/w:r>/g;
          let rm: RegExpExecArray | null; let found: [number, number] | undefined;
          while ((rm = re.exec(x))) { if (rm.index <= at && at < rm.index + rm[0].length) found = [b.start + rm.index, b.start + rm.index + rm[0].length]; }
          if (found) range = found; else unsafe = 'Pemisah halaman berada dalam run bercampur teks lain.';
        }
      } else if (brs.length > 1) unsafe = 'Paragraf memuat lebih dari satu pemisah halaman.';
      if (/<w:sectPr\b/.test(pPr) && !/<w:type\s+w:val="continuous"/.test(pPr)) { brAfter = 'section'; range = undefined; }
    }
    if (pbb && cur && cur.hasSub) { push(); nextLead = 'pbb'; }
    if (!cur) { cur = { index: 0, first: i, last: i, xmlStart: b.start, xmlEnd: b.end, lead: nextLead, trail: 'none', hasSub: false }; nextLead = 'none'; }
    cur.last = i; cur.xmlEnd = b.end;
    if (sub(b)) cur.hasSub = true;
    if (unsafe) cur.unsafe = unsafe;
    if (brAfter !== 'none') { cur.trail = brAfter; cur.trailRange = range; push(); }
  }
  if (cur) {
    const c = cur as Segment & { hasSub: boolean };
    if (!c.hasSub && segs.length) { const prev = segs[segs.length - 1]; prev.last = c.last; prev.xmlEnd = c.xmlEnd; prev.trail = 'none'; prev.trailRange = undefined; }
    else push();
  }
  for (const s of segs) if (s.unsafe) notes.push(`Halaman ${s.index + 1}: ${s.unsafe}`);
  if (segs.some((s) => s.trail === 'section')) notes.push('Dokumen memakai pemisah section; varian halaman di dokumen ini hanya dilaporkan dan tidak dapat dipilih otomatis.');
  return { segs, notes };
}

// ============================================================ info blok & kemiripan ============================================================
interface BInfo { idx: number; kind: 'p' | 'tbl' | 'sdt'; paras: Para[]; text: string; shape: string; grid: string; rowSig: string; cells: Map<string, string>; sig: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a); const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

function infoOf(xml: string, blocks: Block[], i: number, paras: Para[]): BInfo {
  const b = blocks[i]; const bx = xml.slice(b.start, b.end);
  const kind = b.kind as 'p' | 'tbl' | 'sdt';
  const text = paras.map((p) => p.text).join('\n');
  const p0 = paras[0];
  const shape = `${p0?.style ?? ''}|${p0?.align ?? ''}|${p0?.isList ? 'L' : ''}|${p0?.hasDrawing ? 'D' : ''}`;
  let grid = ''; let rowSig = ''; const cells = new Map<string, string>();
  if (kind === 'tbl') {
    grid = ((/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(bx)?.[1] ?? '').match(/w:w="(\d+)"/g) ?? []).join(',');
    const outer = Math.min(...paras.filter((p) => p.table).map((p) => p.table!.tbl));
    const rows = new Map<number, number>();
    for (const p of paras) {
      if (!p.table || p.table.tbl !== outer) continue;
      const k = `${p.table.tr}:${p.table.tc}`;
      cells.set(k, (cells.get(k) ? `${cells.get(k)} ` : '') + p.text);
      rows.set(p.table.tr, Math.max(rows.get(p.table.tr) ?? 0, p.table.tc + 1));
    }
    rowSig = [...rows.entries()].sort((a, c) => a[0] - c[0]).map(([, n]) => n).join(',');
  }
  return { idx: i, kind, paras, text, shape, grid, rowSig, cells, sig: structureSignature(bx) };
}

function blockSim(a: BInfo, b: BInfo): number {
  if (a.kind !== b.kind) return 0;
  const ta = norm(a.text); const tb = norm(b.text);
  if (a.kind === 'tbl') return 0.3 * (a.grid === b.grid ? 1 : 0) + 0.7 * dice(ta, tb) + (a.grid !== b.grid && a.rowSig === b.rowSig ? 0.1 : 0);
  return 0.2 * (a.shape === b.shape ? 1 : 0) + 0.8 * (ta === tb ? 1 : dice(ta, tb));
}
const MATCH_MIN = 0.5;

interface Pair { a: BInfo; b: BInfo; sim: number; identical: boolean }
function alignBlocks(A: BInfo[], B: BInfo[]): { pairs: Pair[]; onlyA: BInfo[]; onlyB: BInfo[] } {
  const n = A.length; const m = B.length;
  const sim: number[][] = A.map((a) => B.map((b) => blockSim(a, b)));
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = sim[i - 1][j - 1];
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s >= MATCH_MIN ? dp[i - 1][j - 1] + s : 0);
  }
  const pairs: Pair[] = []; const usedA = new Set<number>(); const usedB = new Set<number>();
  let i = n; let j = m;
  while (i > 0 && j > 0) {
    const s = sim[i - 1][j - 1];
    if (s >= MATCH_MIN && dp[i][j] === dp[i - 1][j - 1] + s) { pairs.push({ a: A[i - 1], b: B[j - 1], sim: s, identical: s >= 0.9999 && A[i - 1].sig === B[j - 1].sig }); usedA.add(i - 1); usedB.add(j - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  pairs.reverse();
  return { pairs, onlyA: A.filter((_, k) => !usedA.has(k)), onlyB: B.filter((_, k) => !usedB.has(k)) };
}

// ============================================================ pewarisan pemetaan ============================================================
/** Proyeksikan rentang pemetaan di teks master ke teks varian lewat awalan/akhiran yang sama. */
export function projectSpan(master: string, start: number, end: number, variant: string): [number, number] | null {
  if (master === variant) return [start, end];
  const pre = master.slice(0, start); const suf = master.slice(end);
  if (variant.length >= pre.length + suf.length && variant.startsWith(pre) && variant.endsWith(suf)) {
    const e = variant.length - suf.length;
    return e > pre.length ? [pre.length, e] : null;
  }
  return null;
}

/** Perbedaan teks paragraf hanya berada di dalam rentang isian yang dipetakan (nilai contoh berbeda). */
function sharedDifference(pa: Para, textB: string, mappings: MappingRec[]): boolean {
  const ms = mappings.filter((m) => m.part === BODY && m.para_index === pa.index && m.status !== 'rejected' && m.confidence >= 0.4).sort((x, y) => x.start - y.start);
  if (!ms.length) return false;
  const spans: Array<[number, number]> = [];
  for (const m of ms) { const sp = projectSpan(pa.text, m.start, m.end, textB); if (!sp) return false; spans.push(sp); }
  const mask = (t: string, sp: Array<[number, number]>) => { let out = ''; let at = 0; for (const [s, e] of sp) { out += t.slice(at, s) + '\u0000'; at = e; } return out + t.slice(at); };
  return mask(pa.text, ms.map((m) => [m.start, m.end] as [number, number])) === mask(textB, spans);
}

// ============================================================ deteksi ============================================================
const KINDS: Array<[RegExp, string, string]> = [
  [/paraf|parap/i, 'PARAF', 'Kolom Paraf'],
  [/tanda tangan|ttd|penandatangan|\bnip\b|\bplt\.|\ban\.\s/i, 'PENANDATANGAN', 'Blok Penandatangan'],
  [/setuju|persetujuan|approv/i, 'PERSETUJUAN', 'Persetujuan'],
  [/disposisi|rute|routing|tembusan|distribusi/i, 'DISTRIBUSI', 'Distribusi']
];
const kindOfText = (t: string): { kind: string; label: string } => { const k = KINDS.find(([re]) => re.test(t)); return k ? { kind: k[1], label: k[2] } : { kind: 'BAGIAN', label: 'Bagian Khusus' }; };
const clip = (s: string, n = 100) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const tblSummary = (b: BInfo) => clip([...b.cells.entries()].sort((x, y) => { const [a1, a2] = x[0].split(':').map(Number); const [b1, b2] = y[0].split(':').map(Number); return a1 - b1 || a2 - b2; }).map(([, v]) => v.trim()).filter(Boolean).join(' | '), 140);
const blockSummary = (b: BInfo) => (b.kind === 'tbl' ? tblSummary(b) : clip(b.text, 140));

const THRESH = { coverage: 0.7, identical: 0.4, text: 0.6, minChars: 80, autoCoverage: 0.85, autoIdentical: 0.6 };

export interface VariantDetection { groups: VariantGroup[]; notes: string[]; segments: number }

export function detectVariants(zip: Zip, mappings: MappingRec[]): VariantDetection {
  const xml = zip.text(BODY) ?? '';
  const blocks = splitBody(xml);
  if (!blocks) return { groups: [], notes: [], segments: 0 };
  const { segs, notes } = segmentBody(xml, blocks);
  if (segs.length < 2 || segs.length > 12) return { groups: [], notes, segments: segs.length };
  const scan = scanPart(BODY, xml);

  // paragraf per blok (dua penunjuk; scan.paras terurut menurut xmlStart)
  const parasOf = new Map<number, Para[]>();
  { let k = 0; for (let i = 0; i < blocks.length; i++) {
    const list: Para[] = [];
    while (k < scan.paras.length && scan.paras[k].xmlStart < blocks[i].end) { if (scan.paras[k].xmlStart >= blocks[i].start) list.push(scan.paras[k]); k++; }
    parasOf.set(i, list);
  } }
  const infosOf = (s: Segment): BInfo[] => {
    const out: BInfo[] = [];
    for (let i = s.first; i <= s.last; i++) {
      const b = blocks[i];
      if (b.kind !== 'p' && b.kind !== 'tbl' && b.kind !== 'sdt') continue;
      if (b.kind === 'p' && i === s.last && (s.trail === 'brPara' || s.trail === 'section')) continue; // paragraf pemisah bukan isi
      out.push(infoOf(xml, blocks, i, parasOf.get(i) ?? []));
    }
    return out;
  };
  const infos = segs.map(infosOf);
  const segText = infos.map((l) => norm(l.map((b) => b.text).join(' ')));
  const selectable = !segs.some((s) => s.trail === 'section' || s.unsafe) && segs.every((s) => s.trail !== 'brRun' || !!s.trailRange);

  const assigned = new Set<number>();
  const groups: VariantGroup[] = [];
  for (let a = 0; a < segs.length; a++) {
    if (assigned.has(a)) continue;
    const members: Array<{ seg: number; cmp: ReturnType<typeof alignBlocks>; coverage: number; identicalShare: number }> = [];
    for (let b = a + 1; b < segs.length; b++) {
      if (assigned.has(b) || segText[a].length < THRESH.minChars || segText[b].length < THRESH.minChars) continue;
      const cmp = alignBlocks(infos[a], infos[b]);
      const denom = Math.max(infos[a].length, infos[b].length, 1);
      const coverage = cmp.pairs.reduce((x, p) => x + p.sim, 0) / denom;
      const identicalShare = cmp.pairs.filter((p) => p.identical).length / denom;
      if (coverage >= THRESH.coverage && identicalShare >= THRESH.identical && dice(segText[a], segText[b]) >= THRESH.text) members.push({ seg: b, cmp, coverage, identicalShare });
    }
    if (!members.length) continue;
    assigned.add(a); members.forEach((m) => assigned.add(m.seg));

    const variants: VariantItem[] = []; const gNotes: string[] = []; const varTexts: string[] = [];
    const paraRange = (s: Segment): [number, number] => {
      const idx = [...parasOf.entries()].filter(([i]) => i >= s.first && i <= s.last).flatMap(([, l]) => l.map((p) => p.index));
      return idx.length ? [Math.min(...idx), Math.max(...idx)] : [-1, -1];
    };
    const mk = (seg: Segment, letter: string, diffs: VariantDiff[], align: Array<[number, number]>, summary: string): VariantItem => {
      const [pf, pl] = paraRange(seg);
      return { id: randomUUID(), letter, label: '', seg_index: seg.index, block_first: seg.first, block_last: seg.last, para_first: pf, para_last: pl, summary, diffs, align };
    };
    variants.push(mk(segs[a], 'A', [], [], ''));
    let exactDup = false; let minCov = 1; let minId = 1;
    members.forEach((mem, k) => {
      const letter = String.fromCharCode(66 + k);
      const diffs: VariantDiff[] = []; const align: Array<[number, number]> = [];
      const mIndex = (b: BInfo) => infos[a].indexOf(b) + 1;
      for (const p of mem.cmp.pairs) {
        // pewarisan: pasangkan paragraf bila struktur blok cocok
        const sameShape = p.a.kind === 'tbl' ? p.a.grid === p.b.grid && p.a.rowSig === p.b.rowSig : true;
        if (sameShape && p.a.paras.length === p.b.paras.length) p.a.paras.forEach((pa, q) => align.push([pa.index, p.b.paras[q].index]));
        if (p.identical) continue;
        if (p.a.kind === 'tbl') {
          const tblNo = infos[a].slice(0, infos[a].indexOf(p.a) + 1).filter((x) => x.kind === 'tbl').length;
          if (sameShape) {
            const keys = [...new Set([...p.a.cells.keys(), ...p.b.cells.keys()])].sort((x, y) => { const [a1, a2] = x.split(':').map(Number); const [b1, b2] = y.split(':').map(Number); return a1 - b1 || a2 - b2; });
            let any = false;
            for (const key of keys) {
              const va = p.a.cells.get(key) ?? ''; const vb = p.b.cells.get(key) ?? '';
              if (norm(va) === norm(vb)) continue;
              any = true;
              const [r, c] = key.split(':').map(Number);
              const pa = p.a.paras.filter((x) => x.table && `${x.table.tr}:${x.table.tc}` === key);
              const pb = p.b.paras.filter((x) => x.table && `${x.table.tr}:${x.table.tc}` === key);
              const shared = pa.length === 1 && pb.length === 1 && sharedDifference(pa[0], pb[0].text, mappings);
              diffs.push({ kind: 'table_cell', where: `Tabel ${tblNo}, baris ${r + 1}, kolom ${c + 1}`, master: clip(va), variant: clip(vb), shared });
            }
            if (!any) diffs.push({ kind: 'format', where: `Tabel ${tblNo}`, master: tblSummary(p.a), variant: tblSummary(p.b), shared: false });
          } else {
            diffs.push({ kind: 'table_structure', where: `Tabel ${tblNo} (${p.a.grid.split(',').length} → ${p.b.grid.split(',').length} kolom)`, master: tblSummary(p.a), variant: tblSummary(p.b), shared: false });
          }
        } else {
          const same = norm(p.a.text) === norm(p.b.text);
          const shared = !same && p.a.paras.length === 1 && p.b.paras.length === 1 && sharedDifference(p.a.paras[0], p.b.paras[0].text, mappings);
          diffs.push({ kind: same ? 'format' : 'paragraph', where: `Paragraf blok ke-${mIndex(p.a)}`, master: clip(p.a.text), variant: clip(p.b.text), shared });
        }
      }
      // blok tak berpasangan yang berada di celah yang sama dan sejenis = wilayah yang DIGANTI (mis. tabel paraf A → tabel paraf B)
      const posA = new Map(infos[a].map((x, i) => [x, i])); const posB = new Map(infos[mem.seg].map((x, i) => [x, i]));
      const gapA = (x: BInfo) => mem.cmp.pairs.filter((q) => (posA.get(q.a) as number) < (posA.get(x) as number)).length;
      const gapB = (y: BInfo) => mem.cmp.pairs.filter((q) => (posB.get(q.b) as number) < (posB.get(y) as number)).length;
      const restB = [...mem.cmp.onlyB]; const restA: BInfo[] = [];
      for (const x of mem.cmp.onlyA) {
        const j = restB.findIndex((y) => y.kind === x.kind && gapB(y) === gapA(x));
        if (j < 0) { restA.push(x); continue; }
        const y = restB.splice(j, 1)[0];
        const tblNo = infos[a].slice(0, (posA.get(x) as number) + 1).filter((q) => q.kind === 'tbl').length;
        diffs.push(x.kind === 'tbl'
          ? { kind: 'table_structure', where: `Tabel ${tblNo} (${x.grid.split(',').length} → ${y.grid.split(',').length} kolom)`, master: tblSummary(x), variant: tblSummary(y), shared: false }
          : { kind: 'paragraph', where: `Paragraf blok ke-${mIndex(x)}`, master: clip(x.text), variant: clip(y.text), shared: false });
      }
      for (const b of restA) diffs.push({ kind: 'only_in_master', where: `Blok ke-${mIndex(b)} (${b.kind === 'tbl' ? 'tabel' : 'paragraf'})`, master: blockSummary(b), variant: '', shared: false });
      for (const b of restB) diffs.push({ kind: 'only_in_variant', where: `${b.kind === 'tbl' ? 'Tabel' : 'Paragraf'} tambahan`, master: '', variant: blockSummary(b), shared: false });
      if (!diffs.length) exactDup = true;
      minCov = Math.min(minCov, mem.coverage); minId = Math.min(minId, mem.identicalShare);
      for (const d of diffs) if (!d.shared) { varTexts.push(d.master, d.variant); }
      const vsum = clip(diffs.filter((d) => !d.shared).map((d) => d.variant).filter(Boolean).join(' || '), 140);
      variants.push(mk(segs[mem.seg], letter, diffs, align, vsum));
    });
    // wilayah khusus varian master = sisi master dari perbedaan
    const prefer = (d: VariantDiff) => (d.kind === 'table_structure' || d.kind === 'table_cell' ? 0 : 1);
    variants[0].summary = clip(variants.slice(1).flatMap((v) => v.diffs.filter((d) => !d.shared)).sort((x, y) => prefer(x) - prefer(y)).map((d) => d.master).filter(Boolean)[0] ?? '', 140);
    for (const v of variants.slice(1)) v.summary = clip(v.diffs.filter((d) => !d.shared).sort((x, y) => prefer(x) - prefer(y)).map((d) => d.variant).filter(Boolean).join(' || '), 140);

    const { kind, label } = kindOfText(varTexts.join(' '));
    const reason: string[] = [`Kemiripan struktur ${Math.round(minCov * 100)}%, ${Math.round(minId * 100)}% blok identik.`];
    let status: VariantGroup['status'] = minCov >= THRESH.autoCoverage && minId >= THRESH.autoIdentical && !exactDup ? 'auto' : 'confirm';
    if (exactDup) reason.push('Ada halaman yang identik penuh (duplikat); konfirmasi apakah memang varian.');
    if (!selectable) { status = 'confirm'; gNotes.push('Varian hanya dilaporkan; pemilihan otomatis tidak tersedia karena pemisah halaman/section dokumen ini.'); }
    if (status === 'confirm' && !exactDup && selectable) reason.push('Klasifikasi kurang pasti; konfirmasi sebelum dipakai.');
    variants.forEach((v) => { v.label = `${label} Format ${v.letter}`; });
    groups.push({
      group_no: groups.length + 1, status, kind, kind_label: label, field_key: `VARIANT_${kind}`, selectable,
      similarity: Math.round(minCov * 100) / 100, reason: reason.join(' '), notes: gNotes, variants
    });
  }
  // kunci isian unik antar kelompok
  const seen = new Map<string, number>();
  for (const g of groups) { const n = (seen.get(g.field_key) ?? 0) + 1; seen.set(g.field_key, n); if (n > 1) g.field_key = `${g.field_key}_${n}`; }
  if (groups.length) notes.push('Deteksi varian memakai pemisah halaman eksplisit; halaman yang hanya mengalir otomatis tidak dikenali.');
  return { groups, notes, segments: segs.length };
}

// ============================================================ penyelesaian pewarisan ============================================================
export interface ResolveResult {
  /** pemetaan asli minus yang digantikan pewarisan (belum termasuk turunan) */
  kept: MappingRec[];
  derived: MappingRec[];
  groups: GroupRec[];
  superseded: string[];
  droppedGroups: string[];
  varMap: Record<string, VariantParaInfo>;
  /** key isian -> label varian yang memakainya; hanya untuk isian yang tidak berlaku di semua varian */
  restricted: Record<string, string[]>;
}

export function resolveVariants(scan: Scan, mappings: MappingRec[], groups: GroupRec[], vgroups: VariantGroup[]): ResolveResult {
  const applied = vgroups.filter(variantApplied);
  const superseded = new Set<string>(); const derived: MappingRec[] = []; const droppedGroups: string[] = [];
  const varMap: Record<string, VariantParaInfo> = {};
  const textOf = new Map(scan.paras.map((p) => [p.index, p.text]));
  const inRange = (v: VariantItem, i: number) => i >= v.para_first && i <= v.para_last;
  const auto = (m: MappingRec) => m.status === 'auto' || m.status === 'confirm' || m.status === 'confirmed';

  for (const g of applied) {
    const master = g.variants[0];
    for (const v of g.variants.slice(1)) {
      const al = new Map(v.align.map(([m, x]) => [x, m]));
      for (let i = v.para_first; i <= v.para_last; i++) {
        if (!textOf.has(i)) continue;
        const mi = al.get(i);
        varMap[paraKey(BODY, i)] = { variant_id: v.id, letter: v.letter, label: v.label, ...(mi !== undefined ? { inherits: paraKey(BODY, mi) } : {}) };
      }
      for (const m of mappings) if (m.part === BODY && auto(m) && inRange(v, m.para_index)) superseded.add(m.id);
      for (const gr of groups) {
        const first = scan.paras.find((p) => p.table?.tbl === gr.tbl)?.index;
        if (gr.part === BODY && first !== undefined && inRange(v, first)) droppedGroups.push(gr.id);
      }
    }
    // turunan: pemetaan master yang berlaku → paragraf sejajar pada tiap varian lain
    const live = mappings.filter((m) => m.part === BODY && isApplied(m) && !superseded.has(m.id) && inRange(master, m.para_index));
    for (const v of g.variants.slice(1)) {
      const toVar = new Map(v.align.map(([m, x]) => [m, x]));
      for (const m of live) {
        const vi = toVar.get(m.para_index);
        if (vi === undefined) continue;
        const mt = textOf.get(m.para_index) ?? ''; const vt = textOf.get(vi) ?? '';
        const sp = projectSpan(mt, m.start, m.end, vt);
        if (!sp) continue;
        if (mappings.some((x) => x.part === BODY && x.para_index === vi && x.status === 'manual' && x.start < sp[1] && x.end > sp[0])) continue;
        derived.push({ ...m, id: `${m.id}~${v.id}`, para_index: vi, start: sp[0], end: sp[1], source_text: vt.slice(sp[0], sp[1]), reason: `Diwarisi dari ${master.label}.` });
      }
    }
  }
  const kept = mappings.filter((m) => !superseded.has(m.id));
  const keptGroups = groups.filter((g) => !droppedGroups.includes(g.id));

  // isian khusus varian
  const eff = [...kept, ...derived].filter((m) => m.part === BODY && isApplied(m) && !m.placeholder_name.includes('.'));
  const restricted: Record<string, string[]> = {};
  for (const g of applied) {
    const where = new Map<string, Set<string>>(); const outside = new Set<string>();
    for (const m of eff) {
      const v = g.variants.find((x) => inRange(x, m.para_index));
      if (v) { (where.get(m.placeholder_name) ?? where.set(m.placeholder_name, new Set()).get(m.placeholder_name)!).add(v.label); }
      else outside.add(m.placeholder_name);
    }
    for (const [k, set] of where) if (!outside.has(k) && set.size < g.variants.length) restricted[k] = [...set];
  }
  return { kept, derived, groups: keptGroups, superseded: [...superseded], droppedGroups, varMap, restricted };
}

// ============================================================ proyeksi (pilih varian) ============================================================
export interface Selection { group: VariantGroup; variantId: string }

function checkLayout(segs: Segment[], g: VariantGroup) {
  for (const v of g.variants) {
    const s = segs[v.seg_index];
    if (!s || s.first !== v.block_first || s.last !== v.block_last) throw new Error('Struktur halaman template berubah sejak varian didaftarkan. Analisis ulang template sebelum memilih varian.');
  }
}

/** Salinan zip dengan blok halaman varian yang TIDAK dipilih dikeluarkan. Sumber (zip) tidak diubah. */
export function projectVariants(zip: Zip, sel: Selection[]): Zip {
  if (!sel.length) return zip;
  const xml = zip.text(BODY) ?? '';
  const blocks = splitBody(xml);
  if (!blocks) throw new Error('Badan dokumen tidak dapat dibaca.');
  const { segs } = segmentBody(xml, blocks);
  const drop = new Set<number>();
  for (const s of sel) {
    checkLayout(segs, s.group);
    if (!s.group.variants.some((v) => v.id === s.variantId)) throw new Error('Varian yang dipilih tidak dikenal.');
    for (const v of s.group.variants) if (v.id !== s.variantId) drop.add(v.seg_index);
  }
  const kept = segs.filter((s) => !drop.has(s.index));
  const ops: Array<[number, number]> = [];
  segs.filter((s) => drop.has(s.index)).forEach((s) => ops.push([s.xmlStart, s.xmlEnd]));
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i]; const nxt = kept[i + 1];
    if (!nxt) {
      if (s.trail === 'brPara' || s.trail === 'brRun') { if (!s.trailRange) throw new Error('Pemisah halaman tidak dapat dibuang dengan aman.'); ops.push(s.trailRange); }
    } else if (!(s.trail === 'brPara' || s.trail === 'brRun') && nxt.lead !== 'pbb') {
      throw new Error('Pemisah halaman bertipe campuran; varian ini tidak dapat dipilih tanpa mengubah tata letak.');
    }
  }
  ops.sort((a, b) => b[0] - a[0]);
  let out = xml;
  let prevStart = Infinity;
  for (const [s, e] of ops) { if (e > prevStart) continue; out = out.slice(0, s) + out.slice(e); prevStart = s; }
  const z = zip.clone();
  z.set(BODY, out);
  return z;
}

export interface ProjectionCheck { ok: boolean; detail: string }
/** Pemeriksaan independen: setiap blok hasil proyeksi identik dengan blok sumber (berurutan) dan blok yang hilang hanyalah halaman varian lain. */
export function verifyProjection(full: Zip, proj: Zip, sel: Selection[]): ProjectionCheck {
  if (!sel.length) return { ok: true, detail: 'Tidak ada varian.' };
  const fx = full.text(BODY) ?? ''; const px = proj.text(BODY) ?? '';
  const fb = splitBody(fx); const pb = splitBody(px);
  if (!fb || !pb) return { ok: false, detail: 'Badan dokumen tidak terbaca.' };
  const { segs } = segmentBody(fx, fb);
  const dropBlocks = new Set<number>();
  for (const s of sel) for (const v of s.group.variants) if (v.id !== s.variantId) for (let i = v.block_first; i <= v.block_last; i++) dropBlocks.add(i);
  const fSlices = fb.map((b) => fx.slice(b.start, b.end)); const pSlices = pb.map((b) => px.slice(b.start, b.end));
  const dropSeg = new Set<number>();
  for (const x of sel) for (const v of x.group.variants) if (v.id !== x.variantId) dropSeg.add(v.seg_index);
  const lastKept = [...segs].reverse().find((s) => !dropSeg.has(s.index));
  const RUN = /<w:r(?:\s[^>]*)?>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\b[^>]*w:type="page"[^>]*\/><\/w:r>/;
  let k = 0; let identical = 0; let stripped = 0; const missingKept: number[] = [];
  for (let i = 0; i < fb.length; i++) {
    if (dropBlocks.has(i)) continue;
    const exp = fSlices[i];
    if (pSlices[k] === exp) { identical++; k++; continue; }
    if (lastKept && i === lastKept.last) {
      if (lastKept.trail === 'brPara') { stripped++; continue; }
      if (lastKept.trail === 'brRun' && pSlices[k] !== undefined && exp.replace(RUN, '') === pSlices[k]) { stripped++; k++; continue; }
    }
    missingKept.push(i);
  }
  const leftover = pSlices.length - k;
  const ok = missingKept.length === 0 && leftover === 0;
  return {
    ok,
    detail: ok ? `${identical} blok varian terpilih identik dengan template; ${dropBlocks.size} blok varian lain dikeluarkan${stripped ? `, ${stripped} pemisah halaman akhir dibuang` : ''}.`
      : `Blok tidak sesuai: ${missingKept.length ? `hilang/berubah ${missingKept.slice(0, 5).join(', ')}` : ''}${leftover ? ` ; blok tak dikenal ${leftover}` : ''}`
  };
}

/** Isian pemilih varian untuk formulir. */
export function variantFields(vgroups: VariantGroup[]) {
  return vgroups.filter(variantApplied).map((g) => ({
    key: g.field_key, label: `Varian ${g.kind_label}`, type: 'select' as const, default_value: g.variants[0].label, required: true, options: g.variants.map((v) => v.label)
  }));
}

/** Pilihan pengguna (label di formulir) → seleksi; label kosong/tidak dikenal untuk kelompok yang berlaku = master. */
export function selectionFromValues(vgroups: VariantGroup[], values: Record<string, string>): Selection[] {
  return vgroups.filter(variantApplied).map((g) => {
    const want = (values[g.field_key] ?? '').trim();
    const v = want ? g.variants.find((x) => x.label === want) : g.variants[0];
    if (!v) throw new Error(`Varian "${want}" tidak ditemukan. Pilihan yang tersedia: ${g.variants.map((x) => x.label).join(', ')}.`);
    return { group: g, variantId: v.id };
  });
}
