import { randomUUID } from 'node:crypto';
import {
  AUTO_THRESHOLD, DATE_RE, paraKey, parseIndoDate, snakeName,
  type AnalysisResult, type GroupColumn, type GroupRec, type MappingRec, type ParaView, type Warning
} from '@shared/importer';
import { inferType, keyToLabel } from '@shared/placeholder';
import type { FieldType } from '@shared/types';
import { inspectDocx, scanAll } from './inspect';
import { partLabel, type Para, type Scan } from './scan';
import type { Zip } from './zip';

/**
 * Analisis deterministik (tanpa AI). Setiap saran membawa confidence score dan alasan;
 * pengguna selalu dapat mengoreksi hasilnya di layar review.
 */
interface Cand {
  para: Para; start: number; end: number; base: string; label?: string; type: FieldType; required: boolean;
  options: string[]; conf: number; reason: string; scanKey: string;
}

const BODY = 'word/document.xml';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface LabelCfg { re: RegExp; key: string; type?: FieldType; conf: number; required?: boolean; options?: string[]; label?: string }
const LABELS: LabelCfg[] = [
  { re: /^(nomor|no|nomor surat|no surat)$/, key: 'NOMOR_SURAT', conf: 0.92 },
  { re: /^sifat$/, key: 'SIFAT', type: 'select', options: ['Biasa', 'Segera', 'Sangat Segera', 'Rahasia'], conf: 0.88 },
  { re: /^(lampiran|lamp)$/, key: 'LAMPIRAN', conf: 0.88, required: false },
  { re: /^(hal|perihal)$/, key: 'PERIHAL', conf: 0.92 },
  { re: /^(yth|kepada|kepada yth)$/, key: 'TUJUAN_SURAT', conf: 0.9 },
  { re: /^dari$/, key: 'PENGIRIM', conf: 0.88 },
  { re: /^(tanggal|tgl)$/, key: 'TANGGAL_SURAT', type: 'date', conf: 0.9 },
  { re: /^(hari ?\/ ?tanggal|hari, ?tanggal|hari dan tanggal|hari tanggal)$/, key: 'TANGGAL_ACARA', conf: 0.9 },
  { re: /^(waktu|pukul|jam)$/, key: 'WAKTU', conf: 0.9 },
  { re: /^(tempat|lokasi)$/, key: 'LOKASI', conf: 0.9 },
  { re: /^acara$/, key: 'ACARA', type: 'textarea', conf: 0.85 },
  { re: /^agenda$/, key: 'AGENDA', type: 'textarea', conf: 0.85 },
  { re: /^kegiatan$/, key: 'KEGIATAN', conf: 0.85 },
  { re: /^nama$/, key: 'NAMA', conf: 0.85 },
  { re: /^nip$/, key: 'NIP', conf: 0.88 },
  { re: /^jabatan$/, key: 'JABATAN', conf: 0.85 },
  { re: /^(pangkat ?\/ ?golongan|pangkat|golongan)$/, key: 'PANGKAT_GOLONGAN', conf: 0.85 },
  { re: /^unit kerja$/, key: 'UNIT_KERJA', conf: 0.85 },
  { re: /^instansi$/, key: 'INSTANSI', conf: 0.85 },
  { re: /^alamat$/, key: 'ALAMAT', type: 'textarea', conf: 0.85 },
  { re: /^(telepon|telp|no telepon|no hp)$/, key: 'TELEPON', conf: 0.85 },
  { re: /^e-?mail$/, key: 'EMAIL', conf: 0.85 },
  { re: /^keperluan$/, key: 'KEPERLUAN', conf: 0.85 },
  { re: /^tujuan$/, key: 'TUJUAN', conf: 0.85 }
];
const labelOf = (raw: string) => {
  const l = norm(raw).toLowerCase().replace(/[.:]+$/, '').trim();
  return { l, cfg: LABELS.find((c) => c.re.test(l)) };
};

const NOMOR_RE = /\b[A-Z]{0,6}-?\d{1,5}(?:\/[A-Za-z0-9.\-]+){2,7}\b/g;
const TIME_RE = /\d{1,2}[.:]\d{2}(?:\s*(?:s\.?d\.?|sampai(?:\s+dengan)?|-|–)\s*(?:\d{1,2}[.:]\d{2}|selesai))?\s*(?:WIB|WITA|WIT)\b/gi;
const WEEKDAY = '(?:Senin|Selasa|Rabu|Kamis|Jumat|Jum\'at|Sabtu|Minggu)';
const CLOSING_RE = /^\s*(demikian|atas perhatian|atas kerja ?sama|terima kasih|atas bantuan)/i;
const NIP_RE = /^\s*NIP\.?\s*:?\s*(\d[\d .]{6,}\d)\s*$/i;
const JABATAN_RE = /(direktur|kepala|plt|plh|pejabat|ketua|sekretaris|koordinator|manajer|manager|kasubdiv|camat|bupati|walikota|gubernur|menteri|pimpinan)/i;

const trimRange = (t: string, s: number, e: number): [number, number] => {
  while (s < e && /\s/.test(t[s])) s++;
  while (e > s && /\s/.test(t[e - 1])) e--;
  return [s, e];
};
/** Potong rentang pada karakter virtual pertama (tab/baris baru) — rentang pemetaan tidak boleh melewatinya. */
const cutAtVirtual = (p: Para, s: number, e: number): number => {
  for (const it of p.items) if (it.virt && it.start >= s && it.start < e) return it.start;
  return e;
};

export function analyzeDocx(zip: Zip, filename: string): AnalysisResult {
  const scans = scanAll(zip);
  const { info, warnings } = inspectDocx(zip, scans);
  const cands: Cand[] = [];
  const staticReason = new Map<string, string>();
  const body = scans.find((s) => s.part === BODY);

  // ---------- kop surat & elemen statis ----------
  for (const sc of scans) {
    if (sc.part !== BODY) for (const p of sc.paras) if (p.text.trim()) staticReason.set(paraKey(sc.part, p.index), sc.part.includes('header') ? 'Header' : 'Footer');
  }
  const firstTbl = body?.rows.length ? body.rows[0].tbl : -1;
  if (body) {
    const hasDrawingTbl = body.paras.some((p) => p.table?.tbl === firstTbl && p.hasDrawing);
    const earlyUpper = body.paras.slice(0, 12).filter((p) => /[A-Z]{4}/.test(p.text) && p.text === p.text.toUpperCase() && p.text.trim().length > 6);
    const titleIdx = body.paras.findIndex((p) => !p.inTc && p.align === 'center' && p.bold && p.text.trim() === p.text.trim().toUpperCase() && p.text.trim().length > 3 && p.text.trim().length <= 60 && !p.table);
    info.has_kop = info.headers > 0 && scans.some((s) => s.part.includes('header') && s.paras.some((p) => p.hasDrawing || p.text.trim().length > 3)) ? true : (hasDrawingTbl || (earlyUpper.length >= 2 && titleIdx > 1));
    if (hasDrawingTbl) for (const p of body.paras) if (p.table?.tbl === firstTbl) staticReason.set(paraKey(BODY, p.index), 'Kop surat');
    if (!hasDrawingTbl && earlyUpper.length >= 2 && titleIdx > 1) for (const p of body.paras.slice(0, titleIdx)) if (p.text.trim()) staticReason.set(paraKey(BODY, p.index), 'Kop surat');
    if (titleIdx >= 0) staticReason.set(paraKey(BODY, body.paras[titleIdx].index), 'Judul dokumen');
    for (const p of body.paras) if (CLOSING_RE.test(p.text) && !staticReason.has(paraKey(BODY, p.index))) staticReason.set(paraKey(BODY, p.index), 'Kalimat penutup baku');
    if (info.has_kop) warnings.push({ code: 'kop', level: 'info', message: 'Kop surat terdeteksi dan diperlakukan sebagai teks tetap (logo, tabel, dan garis kop tidak diubah).' });
  }
  const isStatic = (p: Para) => staticReason.has(paraKey(p.part, p.index));

  const push = (c: Omit<Cand, 'scanKey'>) => { if (c.end > c.start) cands.push({ ...c, scanKey: paraKey(c.para.part, c.para.index) }); };

  // ---------- tabel data → grup baris berulang ----------
  const groups: GroupRec[] = [];
  const groupParas = new Set<string>();
  if (body) {
    const usedNames = new Set<string>();
    for (const t of new Set(body.rows.map((r) => r.tbl))) {
      const rows = body.rows.filter((r) => r.tbl === t && r.depth === 0);
      if (rows.length < 2 || t === firstTbl && staticReason.get(paraKey(BODY, body.paras.find((p) => p.table?.tbl === t)?.index ?? -1)) === 'Kop surat') continue;
      const cell = (tr: number, tc: number) => body.paras.filter((p) => p.table && p.table.tbl === t && p.table.tr === tr && p.table.tc === tc);
      const head = rows[0];
      const headCells = Array.from({ length: head.cells }, (_, tc) => cell(head.tr, tc));
      const nonEmptyHead = headCells.filter((c) => c.some((p) => p.text.trim()));
      if (nonEmptyHead.length < 2 || !nonEmptyHead.every((c) => c.some((p) => p.text.trim() && p.bold))) continue;
      const dataRows = rows.slice(1).filter((r) => Array.from({ length: r.cells }, (_, tc) => cell(r.tr, tc)).some((c) => c.some((p) => p.text.trim())));
      if (!dataRows.length) continue;
      const columns: GroupColumn[] = [];
      const keys = new Set<string>();
      headCells.forEach((c, tc) => {
        const text = norm(c.map((p) => p.text).join(' '));
        if (!text) return;
        let key = snakeName(text, 24) || `KOLOM_${tc + 1}`;
        while (keys.has(key)) key += '_2';
        keys.add(key);
        const seq = dataRows.every((r, i) => norm(cell(r.tr, tc).map((p) => p.text).join(' ')) === String(i + 1));
        columns.push({ key: seq ? 'NO' : key, label: text, tc, type: 'text', auto_number: seq || undefined });
      });
      const all = norm(columns.map((c) => c.label).join(' ')).toLowerCase();
      let name = /nip|nama/.test(all) ? 'PEGAWAI' : /uraian/.test(all) ? 'URAIAN' : /peserta/.test(all) ? 'PESERTA' : 'DAFTAR';
      while (usedNames.has(name)) name += '_2';
      usedNames.add(name);
      const defaults = dataRows.map((r, i) => {
        const o: Record<string, string> = {};
        for (const c of columns) if (!c.auto_number) o[c.key] = norm(cell(r.tr, c.tc).map((p) => p.text).join(' '));
        void i;
        return o;
      });
      groups.push({
        id: randomUUID(), name, label: `Daftar ${keyToLabel(name)}`, part: BODY, tbl: t, header_tr: head.tr, rows: dataRows.map((r) => r.tr), columns,
        default_rows: defaults, confidence: 0.7, status: 'confirm',
        reason: `Tabel dengan baris judul (${columns.map((c) => c.label).join(', ')}) dan ${dataRows.length} baris data. Jika jumlah baris berubah-ubah, jadikan baris berulang.`
      });
      for (const r of dataRows) for (const p of body.paras.filter((q) => q.table?.tbl === t && q.table.tr === r.tr)) groupParas.add(paraKey(BODY, p.index));
    }
  }

  // ---------- A. penanda eksplisit ----------
  const explicit = [
    /\{\{\s*(\??)([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?)\s*\}\}/g,
    /\[(\??)([A-Z][A-Z0-9_]{2,})\]/g,
    /«\s*(\??)([^»]{1,40}?)\s*»/g,
    /<<\s*(\??)([^>]{1,40}?)\s*>>/g,
    /\$\{\s*(\??)([A-Za-z][A-Za-z0-9_]*)\s*\}/g,
    /\{\{\s*(\??)BLOCK:([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g
  ];
  for (const sc of scans) for (const p of sc.paras) {
    for (const re of explicit) {
      for (const m of p.text.matchAll(re)) {
        const isBlock = /^\{\{\s*\??BLOCK:/.test(m[0]);
        const base = isBlock ? `BLOCK_${snakeName(m[2])}` : m[2].includes('.') ? m[2].toUpperCase() : snakeName(m[2]);
        if (!base) continue;
        const s = m.index as number;
        const multi = isBlock || /^(ISI|URAIAN|LATAR|MAKSUD|PEMBUKA|PENUTUP)/.test(base);
        push({ para: p, start: s, end: s + m[0].length, base, type: multi ? 'textarea' : inferType(base.split('.').pop() as string), required: m[1] !== '?', options: [], conf: 1, reason: 'Penanda eksplisit yang sudah ada pada dokumen.' });
      }
    }
  }

  // ---------- B. isian titik-titik / garis bawah ----------
  for (const sc of scans) for (const p of sc.paras) {
    if (p.hasField) continue;
    for (const m of p.text.matchAll(/\.{5,}|…{2,}|_{4,}/g)) {
      const s = m.index as number;
      const before = p.text.slice(0, s).replace(/[\s:.\-–]+$/, '');
      const afterColon = before.includes(':') ? before.slice(0, before.lastIndexOf(':')) : before;
      const words = norm(afterColon).split(' ').filter(Boolean).slice(-3).join(' ');
      const base = snakeName(words);
      push({ para: p, start: s, end: s + m[0].length, base: base || 'ISIAN', type: inferType(base || 'ISIAN'), required: true, options: [], conf: base ? 0.85 : 0.6, reason: 'Isian kosong berbentuk titik-titik/garis bawah.' });
    }
  }

  // ---------- C. label : nilai (paragraf & sel tabel) ----------
  const bodyParas = body?.paras ?? [];
  const cellText = (tbl: number, tr: number, tc: number) => norm(bodyParas.filter((q) => q.table && q.table.tbl === tbl && q.table.tr === tr && q.table.tc === tc).map((q) => q.text).join(' '));
  for (const sc of scans) for (const p of sc.paras) {
    if (p.hasField || p.depth > 0 || isStatic(p) || groupParas.has(paraKey(p.part, p.index))) continue;
    if (p.table && p.part === BODY && groups.some((g) => g.tbl === p.table?.tbl)) continue;
    const text = p.text;
    if (text.length > 400) continue;
    let handled = false;
    // sel tabel: [label][:][nilai]
    if (p.table && p.table.tc >= 1 && p.part === BODY) {
      const { cfg } = labelOf(cellText(p.table.tbl, p.table.tr, 0));
      if (cfg) {
        let [s, e] = trimRange(text, 0, text.length);
        if (text.slice(s, s + 1) === ':') [s, e] = trimRange(text, s + 1, e);
        e = cutAtVirtual(p, s, e);
        if (e > s) { addLabeled(p, s, e, cfg, 'Kolom nilai pada baris berlabel'); }
        handled = true;
      }
    }
    if (handled) continue;
    // Yth. <penerima> pada satu paragraf
    const yth = /^\s*(Yth\.?|Kepada(?:\s+Yth\.?)?)\s+(?![:\t])(\S.*)$/i.exec(text);
    const ci = text.indexOf(':');
    const labelPart = ci > 0 && ci <= 36 ? text.slice(0, ci) : '';
    if (labelPart) {
      const { l, cfg } = labelOf(labelPart);
      const words = l.split(' ').filter(Boolean).length;
      let [s, e] = trimRange(text, ci + 1, text.length);
      e = cutAtVirtual(p, s, e);
      if (e <= s) continue;
      if (cfg) { addLabeled(p, s, e, cfg, `Label "${norm(labelPart).replace(/[.:]$/, '')}"`); continue; }
      const generic = /^[A-ZÀ-Ý][A-Za-zÀ-ÿ \/.]{2,28}$/.test(norm(labelPart)) && words <= 3 && e - s >= 2 && e - s <= 160 && text.length < 220 && !/\d/.test(labelPart);
      if (generic) {
        const base = snakeName(labelPart);
        if (base) push({ para: p, start: s, end: e, base, label: keyToLabel(base), type: inferType(base), required: true, options: [], conf: 0.55, reason: `Pasangan "${norm(labelPart)}: nilai" tidak dikenal; konfirmasi bila nilainya berubah-ubah.` });
      }
      continue;
    }
    if (yth) {
      const s = text.indexOf(yth[2], yth[0].length - yth[2].length);
      const [ts, te] = trimRange(text, s, cutAtVirtual(p, s, text.length));
      push({ para: p, start: ts, end: te, base: 'TUJUAN_SURAT', type: 'text', required: true, options: [], conf: 0.88, reason: 'Teks setelah "Yth.".' });
    }
  }

  function addLabeled(p: Para, s: number, e: number, cfg: LabelCfg, why: string) {
    const raw = p.text.slice(s, e);
    let type: FieldType = cfg.type ?? inferType(cfg.key);
    if (type === 'date' && !parseIndoDate(raw)) type = 'text';
    const dateOnly = parseIndoDate(raw);
    if (cfg.key === 'TANGGAL_ACARA' && dateOnly) type = 'date';
    let options = cfg.options ? [...cfg.options] : [];
    if (type === 'select' && raw && !options.includes(raw)) options = [raw, ...options];
    let conf = cfg.conf;
    if (cfg.key === 'NOMOR_SURAT' && !/\//.test(raw)) conf -= 0.15;
    push({ para: p, start: s, end: e, base: cfg.key, label: cfg.label, type, required: cfg.required !== false, options, conf, reason: why });
  }

  // ---------- H. "Yth." sendiri lalu penerima pada paragraf berikut ----------
  for (const sc of scans.filter((x) => x.part === BODY)) {
    const ps = sc.paras;
    ps.forEach((p, i) => {
      if (p.table || !/^\s*(Yth\.?|Kepada(?:\s+Yth\.?)?)\s*:?\s*$/i.test(p.text)) return;
      let n = 0;
      for (let j = i + 1; j < ps.length && n < 3; j++) {
        const q = ps[j];
        if (q.table || q.hasField) break;
        const t = q.text.trim();
        if (!t) { if (n === 0) continue; break; }
        if (/^di\s/i.test(t)) break;
        const [s, e] = trimRange(q.text, 0, q.text.length);
        push({ para: q, start: s, end: e, base: 'TUJUAN_SURAT', type: 'text', required: true, options: [], conf: n === 0 ? 0.86 : 0.6, reason: n === 0 ? 'Penerima di bawah "Yth.".' : 'Baris tambahan penerima.' });
        n++;
      }
    });
  }

  // ---------- D. tanggal ----------
  const dateRe = new RegExp(`(?:(${WEEKDAY}),?\\s+)?(${DATE_RE})`, 'gi');
  for (const sc of scans.filter((x) => x.part === BODY)) for (const p of sc.paras) {
    if (p.hasField || p.depth > 0 || groupParas.has(paraKey(p.part, p.index))) continue;
    for (const m of p.text.matchAll(dateRe)) {
      const s = m.index as number; const e = s + m[0].length;
      if (p.text.slice(s, e).includes('\t')) continue;
      const alone = new RegExp(`^\\s*(?:[A-Z][A-Za-z .]{2,30},\\s*)?(?:${WEEKDAY},?\\s+)?${DATE_RE}\\s*$`, 'i').test(p.text);
      const weekday = !!m[1];
      const iso = parseIndoDate(m[2]);
      const base = weekday ? 'TANGGAL_ACARA' : alone ? 'TANGGAL_SURAT' : 'TANGGAL_KEGIATAN';
      push({ para: p, start: s, end: e, base, type: weekday || !iso ? 'text' : 'date', required: true, options: [], conf: alone ? 0.88 : 0.55,
        reason: alone ? 'Tanggal berdiri sendiri (tanggal surat).' : 'Tanggal di dalam kalimat; konfirmasi apakah berubah tiap surat.' });
    }
  }

  // ---------- E. waktu & F. nomor surat di dalam teks ----------
  for (const sc of scans.filter((x) => x.part === BODY)) for (const p of sc.paras) {
    if (p.hasField || p.depth > 0 || groupParas.has(paraKey(p.part, p.index))) continue;
    for (const m of p.text.matchAll(TIME_RE)) {
      const s = m.index as number;
      push({ para: p, start: s, end: s + m[0].length, base: 'WAKTU', type: 'text', required: true, options: [], conf: 0.6, reason: 'Pola jam (mis. 10.00 WIB).' });
    }
    for (const m of p.text.matchAll(NOMOR_RE)) {
      const s = m.index as number;
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(m[0])) continue; // tanggal bergaris miring
      push({ para: p, start: s, end: s + m[0].length, base: 'NOMOR_SURAT', type: 'text', required: true, options: [], conf: 0.62, reason: 'Pola nomor surat (angka/kode/tahun).' });
    }
  }

  // ---------- G. blok tanda tangan ----------
  if (body) {
    const containers = new Map<string, Para[]>();
    for (const p of body.paras) {
      if (p.depth > 0 || p.hasField) continue;
      const k = p.table ? `c:${p.table.tbl}:${p.table.tr}:${p.table.tc}` : 'body';
      if (p.table && groupParas.has(paraKey(BODY, p.index))) continue;
      (containers.get(k) ?? containers.set(k, []).get(k)!).push(p);
    }
    let nipFound = false;
    const sigCands: Array<() => void> = [];
    for (const [k, seq] of containers) {
      const ne = seq.filter((p) => p.text.trim());
      ne.forEach((p, idx) => {
        const m = NIP_RE.exec(p.text);
        if (!m) return;
        nipFound = true;
        const s = p.text.indexOf(m[1]);
        push({ para: p, start: s, end: s + m[1].length, base: 'NIP_PEJABAT', type: 'text', required: true, options: [], conf: 0.88, reason: 'Nomor NIP pada blok tanda tangan.' });
        const name = ne[idx - 1];
        if (name && name.text.trim().length <= 80 && !/,\s*$/.test(name.text.trim()) && !NIP_RE.test(name.text)) {
          const [ns, ne2] = trimRange(name.text, 0, name.text.length);
          push({ para: name, start: ns, end: ne2, base: 'NAMA_PEJABAT', type: 'text', required: true, options: [], conf: 0.8, reason: 'Nama di atas NIP (penandatangan).' });
          const jab = ne[idx - 2];
          if (jab && jab.text.trim().length <= 100 && (/,\s*$/.test(jab.text.trim()) || JABATAN_RE.test(jab.text)) && !isStatic(jab)) {
            const [js, je] = trimRange(jab.text, 0, jab.text.length);
            push({ para: jab, start: js, end: je, base: 'JABATAN_PEJABAT', type: 'text', required: true, options: [], conf: 0.75, reason: 'Jabatan di atas nama penandatangan.' });
          }
        }
      });
      if (k === 'body' || ne.length >= 2) sigCands.push(() => {
        if (nipFound && k === 'body') return;
        const bodyLevel = k === 'body';
        const last = ne[ne.length - 1];
        if (!last || last.text.trim().length > 60 || !(last.bold || last.underline) || NIP_RE.test(last.text) || isStatic(last)) return;
        const pos = ne.length - 1;
        let jab: Para | undefined;
        for (let i = pos - 1; i >= Math.max(0, pos - 6); i--) { if (/,\s*$/.test(ne[i].text.trim()) && ne[i].text.trim().length <= 100) { jab = ne[i]; break; } }
        if (bodyLevel && !jab) return;
        if (!bodyLevel && ne.length < 2) return;
        const [ns, nend] = trimRange(last.text, 0, last.text.length);
        push({ para: last, start: ns, end: nend, base: 'NAMA_PEJABAT', type: 'text', required: true, options: [], conf: 0.6, reason: 'Teks tebal/bergaris bawah terakhir (kemungkinan nama penandatangan).' });
        if (jab) {
          const [js, je] = trimRange(jab.text, 0, jab.text.length);
          push({ para: jab, start: js, end: je, base: 'JABATAN_PEJABAT', type: 'text', required: true, options: [], conf: 0.6, reason: 'Baris berakhir koma di atas nama (kemungkinan jabatan).' });
        }
      });
    }
    for (const f of sigCands) f();
  }

  // ---------- resolusi tumpang tindih per paragraf ----------
  const accepted: Cand[] = [];
  const byPara = new Map<string, Cand[]>();
  for (const c of cands) (byPara.get(c.scanKey) ?? byPara.set(c.scanKey, []).get(c.scanKey)!).push(c);
  for (const list of byPara.values()) {
    list.sort((a, b) => b.conf - a.conf || (b.end - b.start) - (a.end - a.start));
    const keep: Cand[] = [];
    for (const c of list) if (!keep.some((k) => c.start < k.end && c.end > k.start)) keep.push(c);
    accepted.push(...keep);
  }

  // ---------- I. paragraf panjang → perlu konfirmasi ----------
  const mapped = new Set(accepted.map((c) => c.scanKey));
  let longCount = 0;
  if (body) for (const p of body.paras) {
    const key = paraKey(BODY, p.index);
    const t = p.text.trim();
    if (p.table || p.depth > 0 || p.hasField || p.isList || t.length < 90 || mapped.has(key) || isStatic(p) || longCount >= 5) continue;
    const base = /^(sehubungan|menindaklanjuti|berdasarkan|menunjuk|mengacu|merujuk)/i.test(t) ? 'LATAR_BELAKANG'
      : /^(dalam rangka|untuk |guna |dengan ini|bersama ini|dengan hormat|kami mohon|kami mengundang|kami mengusulkan)/i.test(t) ? 'MAKSUD_SURAT' : `ISI_PARAGRAF_${longCount + 1}`;
    const [s, e] = trimRange(p.text, 0, cutAtVirtual(p, 0, p.text.length));
    accepted.push({ para: p, start: s, end: e, base, type: 'textarea', required: true, options: [], conf: 0.5, scanKey: key,
      reason: 'Paragraf panjang. Bisa teks tetap atau isi yang berubah-ubah; konfirmasi bila ingin dijadikan isian (nilai awal = teks asli).' });
    longCount++;
  }

  // ---------- nama placeholder konsisten & teks yang sama ----------
  accepted.sort((a, b) => (a.para.part === b.para.part ? a.para.index - b.para.index || a.start - b.start : a.para.part === BODY ? -1 : 1));
  const suratDates = new Set(accepted.filter((c) => c.base === 'TANGGAL_SURAT' && c.conf >= AUTO_THRESHOLD).map((c) => norm(c.para.text.slice(c.start, c.end))));
  const nomorTexts = new Set(accepted.filter((c) => c.base === 'NOMOR_SURAT' && c.conf >= AUTO_THRESHOLD).map((c) => norm(c.para.text.slice(c.start, c.end))));
  for (const c of accepted) {
    const t = norm(c.para.text.slice(c.start, c.end));
    if (c.base === 'TANGGAL_KEGIATAN' && suratDates.has(t)) { c.base = 'TANGGAL_SURAT'; c.conf = 0.72; c.reason = 'Sama dengan tanggal surat di tempat lain.'; }
    if (c.base === 'NOMOR_SURAT' && c.conf < AUTO_THRESHOLD && nomorTexts.has(t)) { c.conf = 0.85; c.reason = 'Sama dengan nomor surat di tempat lain.'; }
    if (c.base === 'NOMOR_SURAT' && c.conf < AUTO_THRESHOLD && !nomorTexts.has(t) && nomorTexts.size) { c.base = 'NOMOR_RUJUKAN'; c.reason = 'Nomor surat lain (rujukan) di dalam teks.'; }
  }
  const used = new Map<string, Array<{ text: string; name: string }>>();
  const nameFor = (base: string, text: string) => {
    const list = used.get(base) ?? [];
    const hit = list.find((x) => x.text === text);
    if (hit) return hit.name;
    const name = list.length ? `${base}_${list.length + 1}` : base;
    list.push({ text, name });
    used.set(base, list);
    return name;
  };

  const mappings: MappingRec[] = accepted.filter((c) => c.conf >= 0.4).map((c) => {
    const source = c.para.text.slice(c.start, c.end);
    const explicitTok = c.conf === 1;
    const name = explicitTok ? c.base : nameFor(c.base, norm(source));
    const iso = c.type === 'date' ? parseIndoDate(source) : null;
    return {
      id: randomUUID(), part: c.para.part, para_index: c.para.index, start: c.start, end: c.end, source_text: source,
      placeholder_name: name, label: c.label ?? keyToLabel(name.split('.').pop() as string), field_type: iso ? 'date' : c.type === 'date' ? 'text' : c.type,
      default_value: explicitTok ? '' : iso ?? source, required: c.required, options: c.options, confidence: Math.round(c.conf * 100) / 100,
      status: c.conf >= AUTO_THRESHOLD ? 'auto' : 'confirm', reason: c.reason
    } satisfies MappingRec;
  });

  const paras: ParaView[] = [];
  for (const sc of scans) for (const p of sc.paras) {
    if (!p.text.trim() && !p.hasDrawing) continue;
    paras.push({
      key: paraKey(sc.part, p.index), part: sc.part, part_label: partLabel(sc.part), index: p.index, text: p.text, table: p.table,
      align: p.align, bold: p.bold, underline: p.underline, size: p.size, is_list: p.isList, has_field: p.hasField, has_drawing: p.hasDrawing,
      static_reason: staticReason.get(paraKey(sc.part, p.index))
    });
  }

  const w: Warning[] = [...warnings];
  const autoN = mappings.filter((m) => m.status === 'auto').length;
  const confN = mappings.filter((m) => m.status === 'confirm').length;
  if (!mappings.length && !groups.length) w.push({ code: 'none', level: 'warn', message: 'Tidak ada bagian dinamis yang terdeteksi. Pilih teks pada panel kiri untuk membuat isian secara manual.' });
  if (confN) w.push({ code: 'confirm', level: 'info', message: `${confN} saran dengan keyakinan rendah perlu konfirmasi sebelum dipakai.` });
  if (groups.length) w.push({ code: 'groups', level: 'info', message: `${groups.length} tabel dapat dijadikan baris berulang (perlu konfirmasi).` });
  void autoN;

  return { doc: info, paras, mappings, groups, warnings: w, suggested_name: filename.replace(/\.(docx|dotx)$/i, '').replace(/[_]+/g, ' ').trim() || 'Template dari Word', suggested_category_code: guessCategory(scans, mappings) };
}

function guessCategory(scans: Scan[], mappings: MappingRec[]): string {
  const body = scans.find((s) => s.part === BODY);
  const head = (body?.paras.slice(0, 14).map((p) => p.text).join(' ') ?? '').toLowerCase();
  const subj = mappings.find((m) => m.placeholder_name === 'PERIHAL')?.source_text.toLowerCase() ?? '';
  const t = `${head} ${subj}`;
  const table: Array<[RegExp, string]> = [[/nota dinas/, 'ND'], [/surat undangan|undangan/, 'UND'], [/surat tugas/, 'ST'], [/berita acara/, 'BA'], [/pengantar/, 'SP'], [/permohonan/, 'SPM'], [/pemberitahuan/, 'SPB'], [/laporan/, 'LAP'], [/memorandum|memo\b/, 'MEMO']];
  return table.find(([re]) => re.test(t))?.[1] ?? 'DOK';
}
