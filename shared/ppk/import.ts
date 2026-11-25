/**
 * Pembaca spreadsheet "Rekap Pembayaran PPK" (format lama Excel). Murni: menerima baris sel, menghasilkan rencana impor
 * dan temuan. Kolom dicari dari nama header, bukan posisi, karena tiap lembar berbeda susunan.
 * shortcut: dirancang untuk format rekap PPK 2/3/6 TA 2026 (SUMMARY + lembar per paket); format lain perlu pemetaan baru.
 */
import type { FakturCode } from './tax';

export type Cell = string | number | null;
export interface ImportSheet { name: string; rows: Cell[][] }
export interface ImportIssue { sheet: string; row: number; level: 'info' | 'peringatan' | 'galat'; message: string }

export interface ParsedBudgetLine { sheet: string; row: number; unit: string; source: string; mak: string; output_detail: string; kind: 'dipa' | 'saldo_kas'; amount: number }
export interface ParsedAddendum { row: number; number: string; value: number; start: string | null; end: string | null }
export interface ParsedBill {
  row: number; periode: string; service_month: string; period_start: string | null; period_end: string | null;
  bill_number: string; bill_date: string; ba_number: string; ba_date: string | null; spp: string; faktur_number_date: string | null;
  amount: number; pass_through: number; deduction: number; faktur: FakturCode | null; ppn: number; pph23: number;
  source: string; mak: string; pass_row: boolean;
  /** Ada nomor invoice, tanggal, dan BA pembayaran: diimpor sebagai terverifikasi; selain itu draf. */
  complete: boolean;
}
export interface ParsedChain {
  sheet: string; row: number; vendor: string; description: string; kpbu: boolean;
  unit: string | null; output_detail: string | null;
  contract: { number: string; date: string | null; value: number; start: string; end: string };
  addendums: ParsedAddendum[]; bills: ParsedBill[];
}
export interface ParsedWorkbook { budgetLines: ParsedBudgetLine[]; chains: ParsedChain[]; issues: ImportIssue[]; sheets: Array<{ name: string; kind: 'ringkasan' | 'rincian' | 'dilewati' }> }

export interface ImportChainResult { sheet: string; row: number; vendor: string; contract_number: string; status: 'baru' | 'sudah ada' | 'galat'; bills: number; billed: number }
export interface PpkImportReport {
  committed: boolean;
  counts: { units: number; activities: number; accounts: number; budget_lines: number; budget_lines_existing: number; vendors: number; vendors_existing: number;
    contracts: number; contracts_existing: number; addendums: number; bills_verified: number; bills_draft: number; bills_failed: number; billed: number };
  chains: ImportChainResult[];
  issues: ImportIssue[];
  sheets: ParsedWorkbook['sheets'];
}

const norm = (v: Cell) => String(v ?? '').replace(/\s+/g, ' ').trim();
const up = (v: Cell) => norm(v).toUpperCase();
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AG', 'SEP', 'OKT', 'NOV', 'DES'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Nomor bulan (1–12) dari kata bulan Indonesia, termasuk salah ketik umum (FEBUARI, AGT, SEPT). */
export function monthOf(word: string): number | null {
  const w = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!w) return null;
  const i = MONTHS.findIndex((m) => w.startsWith(m));
  return i < 0 ? null : i + 1;
}

/**
 * Tanggal dari sel: ISO dari pembaca XLSX, atau teks "1 Januari 2026". Tanggal mustahil ("31 September") dijepit ke akhir
 * bulan dan dilaporkan lewat onClamp.
 */
export function parseIdDate(v: Cell, onClamp?: (raw: string, fixed: string) => void): string | null {
  const t = norm(v);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  let y: number; let mo: number; let d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(t);
    if (!m) return null;
    const mm = monthOf(m[2]);
    if (!mm) return null;
    y = +m[3]; mo = mm; d = +m[1];
  }
  if (mo < 1 || mo > 12 || d < 1) return null;
  const max = lastDay(y, mo);
  const fixed = `${y}-${pad(mo)}-${pad(Math.min(d, max))}`;
  if (d > max) onClamp?.(t, fixed);
  return fixed;
}

/** "000000403867 tanggal 06 Maret 2026" → nomor dan tanggal. */
export function splitNumberDate(v: Cell, onClamp?: (raw: string, fixed: string) => void): { number: string; date: string | null } {
  const t = norm(v);
  const i = t.toLowerCase().indexOf(' tanggal ');
  return i < 0 ? { number: t, date: null } : { number: t.slice(0, i).trim(), date: parseIdDate(t.slice(i + 9), onClamp) };
}

const num = (v: Cell): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

function headerRow(rows: Cell[][], must: string[]): { at: number; col: Map<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const names = (rows[r] ?? []).map(up);
    if (must.every((k) => names.includes(k))) {
      const col = new Map<string, number>();
      // Kolom ganda: pakai yang pertama, kecuali DENDA yang terakhir (lembar IP Transit punya kolom "DENDA" berisi nilai kontrak dan "Denda" sebenarnya dekat Nilai Diterima).
      names.forEach((n, i) => { if (n && (!col.has(n) || n === 'DENDA')) col.set(n, i); });
      return { at: r, col };
    }
  }
  return null;
}

interface SummaryRow { unit: string; source: string; mak: string; detail: string; pagu: number | null; saldo: number | null; row: number; sheet: string; hasSaldo: boolean }

function readSummary(sh: ImportSheet): SummaryRow[] {
  const out: SummaryRow[] = [];
  for (let r = 0; r < sh.rows.length; r++) {
    const names = (sh.rows[r] ?? []).map(up);
    const iMak = names.indexOf('MAK'); const iDet = names.indexOf('DETAIL RKA-KL'); const iPagu = names.indexOf('PAGU AWAL');
    if (iMak < 0 || iDet < 0 || iPagu < 0) continue;
    const iSaldo = names.findIndex((n) => n.startsWith('SALDO KAS'));
    const iSrc = names.indexOf('MATA ANGGARAN');
    for (let k = r + 1; k < sh.rows.length; k++) {
      const row = sh.rows[k] ?? [];
      if (up(row[0]).startsWith('TOTAL') || !norm(row[iMak])) break;
      out.push({ unit: norm(row[0]), source: up(row[iSrc]), mak: norm(row[iMak]).replace(/\s/g, ''), detail: norm(row[iDet]).slice(0, 300),
        pagu: num(row[iPagu]), saldo: iSaldo >= 0 ? num(row[iSaldo]) : null, row: k + 1, sheet: sh.name, hasSaldo: iSaldo >= 0 });
      r = k;
    }
  }
  return out;
}

export function parsePpkWorkbook(sheets: ImportSheet[], year: number): ParsedWorkbook {
  const issues: ImportIssue[] = [];
  const kinds: ParsedWorkbook['sheets'] = [];
  const summary: SummaryRow[] = [];
  const details: ImportSheet[] = [];
  for (const sh of sheets) {
    if (headerRow(sh.rows, ['NO', 'PENYEDIA'])) { details.push(sh); kinds.push({ name: sh.name, kind: 'rincian' }); continue; }
    const rows = readSummary(sh);
    if (rows.length) { summary.push(...rows); kinds.push({ name: sh.name, kind: 'ringkasan' }); } else kinds.push({ name: sh.name, kind: 'dilewati' });
  }

  // Baris anggaran: tabel ringkasan yang punya kolom saldo kas memuat pagu DIPA dan saldo kas terpisah; bila tidak ada, pakai tabel pagu awal.
  const base = summary.some((r) => r.hasSaldo) ? summary.filter((r) => r.hasSaldo) : summary;
  const budgetLines: ParsedBudgetLine[] = [];
  const seen = new Set<string>();
  for (const r of base) {
    const kind = r.pagu !== null && r.pagu > 0 ? 'dipa' : 'saldo_kas';
    const amount = Math.round((kind === 'dipa' ? r.pagu : r.saldo) ?? 0);
    if (!amount) continue;
    const key = [r.mak, r.detail, r.source, kind].join('|');
    if (seen.has(key)) { issues.push({ sheet: r.sheet, row: r.row, level: 'peringatan', message: `Baris anggaran ganda (${r.mak}, ${r.source}); hanya yang pertama dipakai.` }); continue; }
    seen.add(key);
    budgetLines.push({ sheet: r.sheet, row: r.row, unit: r.unit, source: r.source, mak: r.mak, output_detail: r.detail, kind, amount });
  }

  const chains: ParsedChain[] = [];
  for (const sh of details) {
    const h = headerRow(sh.rows, ['NO', 'PENYEDIA'])!;
    const c = (name: string) => h.col.get(name);
    const req = ['NOMOR KONTRAK', 'NILAI KONTRAK', 'PERIODE TAGIHAN', 'NILAI TAGIHAN', 'SUMBER DANA', 'MAK'];
    const missing = req.filter((k) => c(k) === undefined);
    if (missing.length) { issues.push({ sheet: sh.name, row: h.at + 1, level: 'galat', message: `Kolom tidak ditemukan: ${missing.join(', ')}. Lembar dilewati.` }); continue; }
    const title = norm(sh.rows[0]?.[0]);
    const paguRow = sh.rows.slice(0, h.at).find((r) => up(r?.[0]).startsWith('PAGU'));
    const sheetPagu = paguRow ? paguRow.slice(1).map(num).find((x) => x !== null) ?? null : null;
    const match = summary.find((r) => r.pagu !== null && sheetPagu !== null && Math.round(r.pagu) === Math.round(sheetPagu));
    if (!match) issues.push({ sheet: sh.name, row: h.at, level: 'info', message: 'PAGU lembar tidak cocok dengan ringkasan; tagihan dibebankan ke semua baris anggaran dengan MAK dan sumber dana yang sama.' });
    const get = (row: Cell[], name: string) => { const i = c(name); return i === undefined ? null : row[i] ?? null; };
    let chain: ParsedChain | null = null;
    let lastMonth = `${year}-01`;
    let lastStart: string | null = null; let lastEnd: string | null = null;
    for (let r = h.at + 1; r < sh.rows.length; r++) {
      const row = sh.rows[r] ?? [];
      const line = r + 1;
      const clamp = (raw: string, fixed: string) => issues.push({ sheet: sh.name, row: line, level: 'peringatan', message: `Tanggal "${raw}" tidak ada di kalender; dipakai ${fixed}.` });
      if (norm(row[0]) && num(row[0]) !== null) {
        chain = null; lastStart = null; lastEnd = null;
        const vendor = norm(get(row, 'PENYEDIA'));
        if (!vendor) { issues.push({ sheet: sh.name, row: line, level: 'galat', message: 'Nama penyedia kosong; kelompok baris dilewati.' }); continue; }
        chain = { sheet: sh.name, row: line, vendor, description: norm(get(row, 'URAIAN')) || title || sh.name, kpbu: /KPBU/i.test(title),
          unit: match?.unit ?? null, output_detail: match?.detail ?? null, contract: { number: '', date: null, value: 0, start: '', end: '' }, addendums: [], bills: [] };
        chains.push(chain);
      }
      if (!chain) continue;
      const numDate = splitNumberDate(get(row, 'NOMOR KONTRAK'), clamp);
      const number = numDate.number;
      const value = num(get(row, 'NILAI KONTRAK'));
      const start = parseIdDate(get(row, 'JADWAL PEKERJAAN MULAI'), clamp); const end = parseIdDate(get(row, 'JADWAL PEKERJAAN SELESAI'), clamp);
      if (number || value !== null) {
        const v = Math.round(value ?? 0);
        if (value !== null && v !== value) issues.push({ sheet: sh.name, row: line, level: 'peringatan', message: `Nilai kontrak ${value} dibulatkan ke ${v}.` });
        if (!chain.contract.number) {
          if (!number) { issues.push({ sheet: sh.name, row: line, level: 'galat', message: 'Nomor kontrak kosong pada baris pertama kelompok.' }); continue; }
          if (!start || !end) issues.push({ sheet: sh.name, row: line, level: 'peringatan', message: 'Jadwal pekerjaan kosong; dipakai 1 Januari s.d. 31 Desember.' });
          chain.contract = { number, date: numDate.date, value: v, start: start ?? `${year}-01-01`, end: end ?? `${year}-12-31` };
        } else if (v > 0 || number) {
          chain.addendums.push({ row: line, number: number || `${chain.contract.number} (tambahan baris ${line})`, value: v, start: start ?? lastStart, end: end ?? lastEnd });
        }
        lastStart = start ?? lastStart; lastEnd = end ?? lastEnd;
      }
      const amountRaw = num(get(row, 'NILAI TAGIHAN')) ?? 0;
      const passCol = num(get(row, 'PASS THROUGH')) ?? 0;
      if (amountRaw <= 0 && passCol <= 0) continue;
      const periode = norm(get(row, 'PERIODE TAGIHAN'));
      const passRow = /PASS/i.test(periode);
      const words = periode.split(/[-–]/).map((x) => monthOf(x.trim().split(' ')[0]));
      const m1 = words[0]; const m2 = words[words.length - 1];
      const service_month = m1 ? `${year}-${pad(m1)}` : lastMonth;
      if (!m1 && !passRow) issues.push({ sheet: sh.name, row: line, level: 'peringatan', message: `Periode "${periode}" tidak dikenali; dipakai bulan ${lastMonth}.` });
      lastMonth = service_month;
      const multi = m1 && m2 && m2 !== m1;
      const inv = splitNumberDate(get(row, 'NOMOR & TANGGAL INVOICE'), clamp);
      const ba = splitNumberDate(get(row, 'NOMOR & TANGGAL BA PEMBAYARAN'), clamp);
      const bast = splitNumberDate(get(row, 'NOMOR & TANGGAL BAST'), clamp);
      const fakturDate = parseIdDate(get(row, 'TANGGAL FAKTUR PAJAK'), clamp);
      const fp = up(get(row, 'FP 04/02'));
      const faktur: FakturCode | null = passRow ? null : fp.includes('02') ? '02' : fp.includes('04') ? '04' : null;
      const amount = passRow ? 0 : Math.round(amountRaw);
      const pass_through = passRow ? Math.round(amountRaw) : Math.round(passCol);
      if (!passRow && amountRaw !== amount) issues.push({ sheet: sh.name, row: line, level: 'peringatan', message: `Nilai tagihan ${amountRaw} dibulatkan ke ${amount}.` });
      const bill_date = inv.date ?? fakturDate ?? ba.date ?? bast.date;
      const complete = !!inv.number && !!inv.date && !!ba.number;
      if (!complete) issues.push({ sheet: sh.name, row: line, level: 'info', message: `Tagihan ${periode} belum lengkap (nomor/tanggal invoice atau BA pembayaran kosong); diimpor sebagai draf.` });
      chain.bills.push({
        row: line, periode, service_month,
        period_start: multi ? `${year}-${pad(m1!)}-01` : null, period_end: multi ? `${year}-${pad(m2!)}-${pad(lastDay(year, m2!))}` : null,
        bill_number: inv.number || (ba.number ? `BA ${ba.number}` : `${chain.contract.number} / ${periode}`),
        bill_date: bill_date ?? `${service_month}-${pad(lastDay(year, Number(service_month.slice(5))))}`,
        ba_number: ba.number, ba_date: ba.date, spp: norm(get(row, 'NOMOR SPP')), faktur_number_date: fakturDate,
        amount, pass_through, deduction: Math.round(num(get(row, 'DENDA')) ?? 0), faktur,
        ppn: faktur === '02' ? Math.round(num(get(row, 'PPN')) ?? 0) : 0, pph23: faktur ? Math.round(num(get(row, 'PPH 23')) ?? 0) : 0,
        source: up(get(row, 'SUMBER DANA')), mak: norm(get(row, 'MAK')).replace(/\s/g, ''), pass_row: passRow, complete
      });
    }
  }
  // Nomor tagihan unik per kontrak (kunci di database).
  for (const ch of chains) {
    const used = new Map<string, number>();
    for (const b of ch.bills) { const n = (used.get(b.bill_number) ?? 0) + 1; used.set(b.bill_number, n); if (n > 1) b.bill_number = `${b.bill_number} (${n})`; }
  }
  return { budgetLines, chains: chains.filter((c) => c.contract.number), issues, sheets: kinds };
}
