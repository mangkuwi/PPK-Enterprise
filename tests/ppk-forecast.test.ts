import { describe, expect, it } from 'vitest';
import { buildReport, contractEstimate, monthRange, spreadEven, type ForecastContract, type ReportInput } from '@shared/ppk/forecast';

const c = (o: Partial<ForecastContract> = {}): ForecastContract => ({ id: 'k1', contract_number: 'KTR-1', vendor_name: 'PT A', status: 'aktif',
  start_date: '2026-01-01', effective_end: '2026-06-30', latest_value: 600, sisa_kontrak: 300, ...o });

describe('estimasi kontrak', () => {
  it('membagi rata dengan sisa pembulatan di bulan terakhir', () => {
    expect(spreadEven(100, 3)).toEqual([33, 33, 34]);
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('sisa kontrak dibagi ke bulan sesudah bulan laporan s.d. selesai', () => {
    expect(contractEstimate(c(), {}, '2026-03', '2026-12', false)).toEqual({ '2026-04': 100, '2026-05': 100, '2026-06': 100 });
  });
  it('kontrak lintas tahun hanya menyumbang bulan tahun ini', () => {
    const e = contractEstimate(c({ effective_end: '2027-06-30', sisa_kontrak: 1200 }), {}, '2026-06', '2026-12', false);
    expect(Object.values(e)).toEqual([100, 100, 100, 100, 100, 100]);
  });
  it('jadwal bulanan dipakai dan dibatasi sisa kontrak', () => {
    expect(contractEstimate(c(), { '2026-04': 250, '2026-05': 250 }, '2026-03', '2026-12', false)).toEqual({ '2026-04': 250, '2026-05': 50 });
  });
  it('asumsi perpanjangan memakai nilai per bulan kontrak sampai Desember', () => {
    const e = contractEstimate(c(), {}, '2026-03', '2026-12', true);
    expect(e['2026-06']).toBe(100); expect(e['2026-07']).toBe(100); expect(e['2026-12']).toBe(100);
    expect(contractEstimate(c({ sisa_kontrak: 0 }), {}, '2026-08', '2026-12', true)).toEqual({ '2026-09': 100, '2026-10': 100, '2026-11': 100, '2026-12': 100 });
  });
});

describe('laporan prognosis', () => {
  const base: ReportInput = {
    year: 2026, cutoff: '2026-03', extend: false,
    lines: [
      { id: 'blu', label: 'BLU', mak: 'M', detail: 'D', source_code: 'BLU', kind: 'dipa', pagu_terakhir: 1000, allocated: 0, billed: 0, paid: 0 },
      { id: 'rm', label: 'RM', mak: 'M', detail: 'D', source_code: 'RM', kind: 'dipa', pagu_terakhir: 350, allocated: 0, billed: 300, paid: 200 }
    ],
    actuals: [{ budget_line_id: 'rm', month: '2026-01', amount: 100 }, { budget_line_id: 'rm', month: '2026-02', amount: 200 }],
    contracts: [c(), c({ id: 'k2', contract_number: 'KTR-2', sisa_kontrak: 50, effective_end: '2026-04-30' })],
    schedules: [], contractLines: [{ contract_id: 'k1', budget_line_id: 'rm' }, { contract_id: 'k1', budget_line_id: 'blu' }],
    bills: [{ status: 'diverifikasi', total: 300, paid: 200 }, { status: 'draft', total: 10, paid: 0 }, { status: 'dibatalkan', total: 99, paid: 0 }]
  };
  it('estimasi menghabiskan sisa pagu RM dulu lalu BLU, kontrak tanpa baris anggaran dipisah', () => {
    const r = buildReport(base);
    const rm = r.lines.find((l) => l.id === 'rm')!; const blu = r.lines.find((l) => l.id === 'blu')!; const none = r.lines.find((l) => l.id === null)!;
    expect(rm.months.slice(0, 5).map((m) => [m.actual, m.estimate])).toEqual([[100, 0], [200, 0], [0, 0], [0, 50], [0, 0]]);
    expect(blu.months.slice(3, 6).map((m) => m.estimate)).toEqual([50, 100, 100]);
    expect([rm.prognosis, rm.kebutuhan, blu.prognosis, blu.kebutuhan]).toEqual([350, 0, 250, -750]);
    expect(none.estimate).toBe(50);
    expect(r.total).toMatchObject({ pagu: 1350, billed: 300, estimate: 350, prognosis: 650, kebutuhan: -700 });
    expect(r.bills).toEqual({ draft: 1, draft_amount: 10, unpaid: 1, unpaid_amount: 100 });
    expect(r.ending.map((e) => e.contract_number)).toEqual(['KTR-2']);
  });
  it('prognosis = realisasi + estimasi; jumlah bulan sama dengan total', () => {
    const r = buildReport({ ...base, extend: true });
    for (const l of r.lines) expect(l.months.reduce((a, m) => a + m.actual + m.estimate, 0)).toBe(l.prognosis);
  });
});
