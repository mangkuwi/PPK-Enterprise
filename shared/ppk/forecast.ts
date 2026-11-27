/**
 * Laporan realisasi dan prognosis PPK (murni, tanpa DB).
 * Prognosis = realisasi aktual (tagihan per bulan layanan) s.d. bulan laporan + estimasi bulan berikutnya dari kontrak aktif.
 * Realisasi adalah catatan internal; angka resmi tetap SAKTI/SP2D.
 */
import { fundingOrder, splitByRemaining } from './bills';

export const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Bulan berikut dari 'YYYY-MM'. */
export function nextMonth(m: string): string {
  const y = Number(m.slice(0, 4)); const n = Number(m.slice(5, 7));
  return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`;
}
/** Daftar bulan dari..s.d. (inklusif), kosong bila dari > s.d. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}
/** Bagi rata ke n bulan dalam rupiah bulat; sisa pembulatan masuk bulan terakhir. */
export function spreadEven(total: number, n: number): number[] {
  if (n <= 0) return [];
  const each = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * (n - 1) : each));
}

export interface ForecastContract {
  id: string; contract_number: string; vendor_name: string; status: string;
  start_date: string; effective_end: string; latest_value: number; sisa_kontrak: number;
  /** Kontrak tahun jamak: nilai estimasi tahun ini; bila ada, estimasi memakai nilai ini dikurangi tagihan tahun ini. */
  billed?: number; year_value?: number | null;
  /** Jenis project (lihat contractProject), untuk daftar kontrak yang segera selesai. */
  project?: string;
}

/**
 * Estimasi tagihan kontrak per bulan sesudah bulan laporan.
 * - Jadwal bulanan kontrak dipakai bila diisi (dibatasi sisa kontrak); bila tidak, sisa kontrak dibagi rata ke bulan tersisa s.d. tanggal selesai.
 *   Kontrak yang selesai setelah tahun ini hanya menyumbang bulan di tahun ini.
 * - extend: kontrak yang selesai sebelum akhir tahun dianggap diperpanjang dengan nilai per bulan kontrak (nilai ÷ jumlah bulan masa kontrak).
 */
export function contractEstimate(c: ForecastContract, schedule: Record<string, number>, cutoff: string, yearEnd: string, extend: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  const startM = c.start_date.slice(0, 7); const endM = c.effective_end.slice(0, 7);
  const first = nextMonth(cutoff) > startM ? nextMonth(cutoff) : startM;
  const rest = monthRange(first, endM);
  if (c.sisa_kontrak > 0 && rest.length) {
    if (Object.keys(schedule).length) {
      let left = c.sisa_kontrak;
      for (const m of rest) { const v = Math.min(left, schedule[m] ?? 0); if (v > 0) { out[m] = v; left -= v; } }
    } else spreadEven(c.sisa_kontrak, rest.length).forEach((v, i) => { if (v > 0) out[rest[i]] = v; });
  }
  if (extend && endM < yearEnd) {
    const rate = Math.floor(c.latest_value / Math.max(1, monthRange(startM, endM).length));
    for (const m of monthRange(nextMonth(endM) > first ? nextMonth(endM) : first, yearEnd)) if (rate > 0) out[m] = (out[m] ?? 0) + rate;
  }
  for (const m of Object.keys(out)) if (m > yearEnd) delete out[m];
  return out;
}

export interface ForecastLine {
  id: string; label: string; mak: string; detail: string; source_code: string; kind: string; pagu_terakhir: number; allocated: number; billed: number; paid: number;
}
export interface ReportMonth { month: string; actual: number; estimate: number; /** RPD bulan ini. */ plan: number }
export interface ReportLine {
  /** null = estimasi kontrak yang belum punya baris anggaran (belum ada tagihan atau pembebanan). */
  id: string | null; label: string; mak: string; detail: string; source_code: string; kind: string;
  pagu: number; allocated: number; billed: number; paid: number; months: ReportMonth[];
  estimate: number; prognosis: number;
  /** Total RPD setahun dan s.d. bulan laporan. */
  plan: number; plan_to_cutoff: number; actual_to_cutoff: number;
  /** Prognosis − pagu: positif = kekurangan pagu, negatif = sisa. */
  kebutuhan: number;
}
export interface ReportTotal { source_code: string; pagu: number; billed: number; paid: number; estimate: number; prognosis: number; kebutuhan: number }
export interface PpkReport {
  year: number; cutoff: string; extend: boolean;
  lines: ReportLine[]; sources: ReportTotal[]; total: ReportTotal;
  bills: { draft: number; draft_amount: number; unpaid: number; unpaid_amount: number };
  /** Kontrak aktif yang sudah atau akan selesai dalam 2 bulan sesudah bulan laporan. */
  ending: Array<{ id: string; contract_number: string; project: string; vendor_name: string; effective_end: string; sisa_kontrak: number }>;
}

export interface ReportInput {
  year: number; cutoff: string; extend: boolean;
  lines: ForecastLine[];
  actuals: Array<{ budget_line_id: string; month: string; amount: number }>;
  contracts: ForecastContract[];
  schedules: Array<{ contract_id: string; month: string; planned_amount: number }>;
  plans: Array<{ budget_line_id: string; month: string; amount: number }>;
  /** Baris anggaran yang pernah dipakai kontrak (tagihan atau pembebanan). */
  contractLines: Array<{ contract_id: string; budget_line_id: string }>;
  bills: Array<{ status: string; total: number; paid: number }>;
}

export function buildReport(i: ReportInput): PpkReport {
  const months = monthRange(`${i.year}-01`, `${i.year}-12`);
  const yearEnd = `${i.year}-12`;
  const row = (l: ForecastLine | null): ReportLine => ({
    id: l?.id ?? null, label: l?.label ?? 'Belum terbebankan ke baris anggaran', mak: l?.mak ?? '', detail: l?.detail ?? 'Estimasi kontrak yang belum punya tagihan atau pembebanan', source_code: l?.source_code ?? '', kind: l?.kind ?? '',
    pagu: l?.pagu_terakhir ?? 0, allocated: l?.allocated ?? 0, billed: l?.billed ?? 0, paid: l?.paid ?? 0,
    months: months.map((month) => ({ month, actual: 0, estimate: 0, plan: 0 })), estimate: 0, prognosis: 0, kebutuhan: 0, plan: 0, plan_to_cutoff: 0, actual_to_cutoff: 0
  });
  const rows = new Map<string, ReportLine>(i.lines.map((l) => [l.id, row(l)]));
  const unassigned = row(null);
  const idx = (m: string) => months.indexOf(m);
  for (const a of i.actuals) { const r = rows.get(a.budget_line_id); const k = idx(a.month); if (r && k >= 0) r.months[k].actual += a.amount; }
  for (const p of i.plans) { const r = rows.get(p.budget_line_id); const k = idx(p.month); if (r && k >= 0) r.months[k].plan += p.amount; }

  // Estimasi dibebankan seperti tagihan sungguhan: per bulan, menghabiskan sisa pagu baris kontrak sesuai urutan DIPA → saldo kas, RM → PNBP → BLU.
  const remaining = new Map(i.lines.map((l) => [l.id, l.pagu_terakhir - l.billed]));
  const byLine = new Map(i.lines.map((l) => [l.id, l]));
  const events: Array<{ month: string; c: ForecastContract; amount: number }> = [];
  for (const raw of i.contracts.filter((x) => x.status === 'aktif')) {
    const c = raw.year_value == null ? raw : { ...raw, latest_value: raw.year_value, sisa_kontrak: Math.max(0, raw.year_value - (raw.billed ?? 0)),
      start_date: raw.start_date < `${i.year}-01-01` ? `${i.year}-01-01` : raw.start_date, effective_end: raw.effective_end > `${i.year}-12-31` ? `${i.year}-12-31` : raw.effective_end };
    const sched = Object.fromEntries(i.schedules.filter((s) => s.contract_id === c.id).map((s) => [s.month, s.planned_amount]));
    for (const [month, amount] of Object.entries(contractEstimate(c, sched, i.cutoff, yearEnd, i.extend))) events.push({ month, c, amount });
  }
  events.sort((a, b) => a.month.localeCompare(b.month) || a.c.contract_number.localeCompare(b.c.contract_number));
  for (const e of events) {
    const k = idx(e.month); if (k < 0) continue;
    const cand = [...new Set(i.contractLines.filter((x) => x.contract_id === e.c.id).map((x) => x.budget_line_id))]
      .map((id) => byLine.get(id)).filter((l): l is ForecastLine => !!l).sort(fundingOrder);
    if (!cand.length) { unassigned.months[k].estimate += e.amount; continue; }
    for (const f of splitByRemaining(e.amount, cand.map((l) => ({ id: l.id, remaining: remaining.get(l.id)! })))) {
      rows.get(f.budget_line_id)!.months[k].estimate += f.amount;
      remaining.set(f.budget_line_id, remaining.get(f.budget_line_id)! - f.amount);
    }
  }

  const lines = [...rows.values(), ...(unassigned.months.some((m) => m.estimate) ? [unassigned] : [])];
  for (const r of lines) {
    r.estimate = r.months.reduce((a, m) => a + m.estimate, 0);
    r.prognosis = r.billed + r.estimate;
    r.kebutuhan = r.prognosis - r.pagu;
    r.plan = r.months.reduce((a, m) => a + m.plan, 0);
    r.plan_to_cutoff = r.months.filter((m) => m.month <= i.cutoff).reduce((a, m) => a + m.plan, 0);
    r.actual_to_cutoff = r.months.filter((m) => m.month <= i.cutoff).reduce((a, m) => a + m.actual, 0);
  }
  const sum = (source_code: string, rs: ReportLine[]): ReportTotal => {
    const t = { source_code, pagu: 0, billed: 0, paid: 0, estimate: 0, prognosis: 0, kebutuhan: 0 };
    for (const r of rs) { t.pagu += r.pagu; t.billed += r.billed; t.paid += r.paid; t.estimate += r.estimate; t.prognosis += r.prognosis; }
    t.kebutuhan = t.prognosis - t.pagu;
    return t;
  };
  const codes = [...new Set(lines.map((r) => r.source_code))];
  const soon = nextMonth(nextMonth(i.cutoff));
  const live = i.bills.filter((b) => b.status !== 'dibatalkan');
  const drafts = live.filter((b) => b.status === 'draft'); const unpaid = live.filter((b) => b.status === 'diverifikasi' && b.paid < b.total);
  return {
    year: i.year, cutoff: i.cutoff, extend: i.extend, lines,
    sources: codes.map((c) => sum(c, lines.filter((r) => r.source_code === c))), total: sum('Total', lines),
    bills: { draft: drafts.length, draft_amount: drafts.reduce((a, b) => a + b.total, 0), unpaid: unpaid.length, unpaid_amount: unpaid.reduce((a, b) => a + b.total - b.paid, 0) },
    ending: i.contracts.filter((c) => c.status === 'aktif' && c.effective_end.slice(0, 7) <= soon).sort((a, b) => a.effective_end.localeCompare(b.effective_end))
      .map(({ id, contract_number, project = '', vendor_name, effective_end, sisa_kontrak }) => ({ id, contract_number, project, vendor_name, effective_end, sisa_kontrak }))
  };
}
