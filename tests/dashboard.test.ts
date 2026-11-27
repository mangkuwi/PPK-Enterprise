import { describe, expect, it } from 'vitest';
import { dashboardYear, programProgress } from '@shared/dashboard';

const line = (description: string, pagu_terakhir: number, billed: number, year = 2026, is_active = 1) => ({ year, is_active, output_detail: description, description: 'Impor rekap.xlsx', activity_name: 'Kegiatan', pagu_terakhir, billed });

describe('dashboard', () => {
  it('menjumlah realisasi per program tanpa float pada rupiah', () => {
    const r = programProgress([line('SATRIA 1', 1_000_000_000_000, 821_000_000_000), line('SATRIA 1', 500, 0), line('IP HUB', 300, 100), line('IP HUB', 999, 999, 2025), line('IP HUB', 50, 50, 2026, 0)], 2026);
    expect(r.programs.map((p) => p.name)).toEqual(['SATRIA 1', 'IP HUB']);
    expect(r.programs[0]).toMatchObject({ pagu: 1_000_000_000_500, billed: 821_000_000_000, pct: 82.1 });
    expect(r.programs[1]).toMatchObject({ pagu: 300, billed: 100, pct: 33.3 });
    expect(r.total).toMatchObject({ pagu: 1_000_000_000_800, billed: 821_000_000_100 });
  });
  it('pagu nol tidak membagi dengan nol', () => {
    expect(programProgress([line('X', 0, 10)], 2026).programs[0].pct).toBe(0);
  });
  it('memilih tahun dengan data', () => {
    expect(dashboardYear([{ year: 2025 }], 2026)).toBe(2025);
    expect(dashboardYear([{ year: 2026 }, { year: 2025 }], 2026)).toBe(2026);
    expect(dashboardYear([], 2026)).toBe(2026);
  });
});
