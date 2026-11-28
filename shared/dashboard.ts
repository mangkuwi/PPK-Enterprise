/** Ringkasan untuk Dashboard. Murni, agar bisa diuji tanpa DB. Rupiah tetap bilangan bulat; persen hanya untuk tampilan. */
export interface ProgramProgress { name: string; pagu: number; billed: number; pct: number }

type Line = { year: number; is_active: number; output_detail: string; description: string; activity_name: string; pagu_terakhir: number; billed: number };

/** Tahun anggaran yang ditampilkan: tahun berjalan bila ada datanya, selain itu tahun terakhir yang ada. */
export function dashboardYear(lines: Array<Pick<Line, 'year'>>, current: number): number {
  return lines.some((l) => l.year === current) || !lines.length ? current : Math.max(...lines.map((l) => l.year));
}

/** Realisasi (tagihan tercatat) terhadap pagu terakhir, dikelompokkan per detail output (paket/program), lalu uraian. */
export function programProgress(lines: Line[], year: number): { programs: ProgramProgress[]; total: ProgramProgress } {
  const map = new Map<string, ProgramProgress>();
  for (const l of lines) {
    if (l.year !== year || !l.is_active) continue;
    const name = l.output_detail.trim() || l.description.trim() || l.activity_name || 'Tanpa uraian';
    const p = map.get(name) ?? { name, pagu: 0, billed: 0, pct: 0 };
    p.pagu += l.pagu_terakhir; p.billed += l.billed; map.set(name, p);
  }
  const pct = (p: ProgramProgress) => ({ ...p, pct: p.pagu > 0 ? Math.round((p.billed / p.pagu) * 1000) / 10 : 0 });
  const programs = [...map.values()].map(pct).sort((a, b) => b.pagu - a.pagu);
  const total = pct(programs.reduce((a, p) => ({ ...a, pagu: a.pagu + p.pagu, billed: a.billed + p.billed }), { name: 'Total', pagu: 0, billed: 0, pct: 0 }));
  return { programs, total };
}

/** Empat program yang dipantau di Dashboard; dicocokkan dengan nama detail output/uraian anggaran. */
export const MONITORED = [
  { key: 'satria', label: 'SATRIA 1', match: /satria/i },
  { key: 'iphub', label: 'IP HUB', match: /ip\s*-?\s*hub/i },
  { key: 'iptransit', label: 'IP Transit', match: /ip\s*-?\s*transit/i },
  { key: 'akses', label: 'Akses Internet', match: /akses\s*internet/i }
] as const;

export interface MonitoredProgram extends ProgramProgress { key: string; sources: string[] }

/** Realisasi per program dipantau (gabungan semua detail output yang cocok) + program lain yang tidak cocok. */
export function monitoredPrograms(programs: ProgramProgress[]): { rows: MonitoredProgram[]; others: ProgramProgress[] } {
  const rows: MonitoredProgram[] = MONITORED.map((m) => ({ key: m.key, name: m.label, pagu: 0, billed: 0, pct: 0, sources: [] }));
  const others: ProgramProgress[] = [];
  for (const p of programs) {
    const i = MONITORED.findIndex((m) => m.match.test(p.name));
    if (i < 0) { others.push(p); continue; }
    rows[i].pagu += p.pagu; rows[i].billed += p.billed; rows[i].sources.push(p.name);
  }
  for (const r of rows) r.pct = r.pagu > 0 ? Math.round((r.billed / r.pagu) * 1000) / 10 : 0;
  return { rows, others };
}
