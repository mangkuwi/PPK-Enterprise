import type { Actor } from '@shared/numbering';
import { budgetLabel } from '@shared/ppk/budget';
import { MONTH_LABEL, buildReport, type PpkReport, type ReportTotal } from '@shared/ppk/forecast';
import type { WriteSheet } from '../numbering/xlsx';
import type { PpkStore } from './store';
import { PpkError, requirePpk } from './access';
import { listBudgetLines } from './budget';
import { listContracts } from './contracts';
import { listBills } from './bills';

/** Laporan realisasi + prognosis satu tahun anggaran; cutoff = bulan laporan terakhir yang dianggap aktual ('YYYY-MM'). */
export async function ppkReport(s: PpkStore, actor: Actor, fiscal_year_id: string, cutoff: string, extend: boolean): Promise<PpkReport> {
  await requirePpk(s, actor, 'read');
  const fy = await s.get<{ year: number }>('SELECT year FROM ppk_fiscal_years WHERE id = ?', [fiscal_year_id]);
  if (!fy) throw new PpkError('INVALID', 'Tahun anggaran tidak ditemukan.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cutoff) || cutoff.slice(0, 4) !== String(fy.year)) throw new PpkError('INVALID', `Bulan laporan harus di tahun ${fy.year}.`);
  const lines = await listBudgetLines(s, actor, { fiscal_year_id, include_inactive: true });
  const contracts = await listContracts(s, actor, { fiscal_year_id });
  const bills = await listBills(s, actor, { fiscal_year_id });
  const actuals = await s.all<{ budget_line_id: string; month: string; amount: number }>(
    `SELECT bf.budget_line_id, b.service_month AS month, SUM(bf.amount) AS amount FROM ppk_bill_funding bf JOIN ppk_bills b ON b.id = bf.bill_id
     JOIN ppk_budget_lines bl ON bl.id = bf.budget_line_id WHERE bl.fiscal_year_id = ? AND b.status <> 'dibatalkan' GROUP BY bf.budget_line_id, b.service_month`, [fiscal_year_id]);
  const schedules = await s.all<{ contract_id: string; month: string; planned_amount: number }>(
    'SELECT cs.contract_id, cs.month, cs.planned_amount FROM ppk_contract_schedules cs JOIN ppk_contracts c ON c.id = cs.contract_id WHERE c.fiscal_year_id = ?', [fiscal_year_id]);
  const contractLines = await s.all<{ contract_id: string; budget_line_id: string }>(
    `SELECT b.contract_id, bf.budget_line_id FROM ppk_bill_funding bf JOIN ppk_bills b ON b.id = bf.bill_id JOIN ppk_contracts c ON c.id = b.contract_id
       WHERE c.fiscal_year_id = ? AND b.status <> 'dibatalkan'
     UNION SELECT fa.contract_id, fa.budget_line_id FROM ppk_contract_funding_allocations fa JOIN ppk_contracts c ON c.id = fa.contract_id WHERE c.fiscal_year_id = ?`,
    [fiscal_year_id, fiscal_year_id]);
  return buildReport({
    year: fy.year, cutoff, extend, actuals, schedules, contractLines,
    lines: lines.map((l) => ({ id: l.id, label: budgetLabel(l), mak: l.mak, detail: l.output_detail, source_code: l.source_code, kind: l.kind, pagu_terakhir: l.pagu_terakhir, allocated: l.allocated, billed: l.billed, paid: l.paid })),
    contracts, bills
  });
}

/** Lembar Excel laporan: prognosis per baris anggaran (bulan aktual/estimasi) dan konsolidasi per sumber dana. */
export function reportSheets(r: PpkReport): WriteSheet[] {
  const months = r.lines[0]?.months.map((m) => `${MONTH_LABEL[Number(m.month.slice(5)) - 1]} (${m.month <= r.cutoff ? 'aktual' : 'estimasi'})`) ?? [];
  const total = (t: ReportTotal) => [t.pagu, t.billed, t.paid, t.estimate, t.prognosis, t.kebutuhan];
  return [
    { name: 'Prognosis', header: ['Baris anggaran', 'Sumber dana', 'Jenis', 'Pagu terakhir', 'Realisasi', 'Dibayar', ...months, 'Estimasi', 'Prognosis', 'Kebutuhan (+) / sisa (−)'],
      rows: r.lines.map((l) => [l.label, l.source_code, l.kind, l.pagu, l.billed, l.paid, ...l.months.map((m) => m.actual + m.estimate), l.estimate, l.prognosis, l.kebutuhan]),
      widths: [48, 10, 10, 18, 18, 18, ...months.map(() => 16), 18, 18, 20] },
    { name: 'Per sumber dana', header: ['Sumber dana', 'Pagu terakhir', 'Realisasi', 'Dibayar', 'Estimasi', 'Prognosis', 'Kebutuhan (+) / sisa (−)'],
      rows: [...r.sources.map((t) => [t.source_code || 'Belum terbebankan', ...total(t)]), ['Total', ...total(r.total)]], widths: [22, 18, 18, 18, 18, 18, 20] }
  ];
}
