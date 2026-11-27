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

const ACTION_LABEL: Record<string, string> = {
  'number.batch': 'Nomor ditambahkan ke Bank Nomor', 'number.bind': 'Nomor dipakai dokumen', 'number.manual': 'Nomor dicatat manual', 'number.release': 'Nomor dilepas dari draf', 'number.void': 'Nomor di-void',
  'ppk.agenda.create': 'Agenda ditambahkan', 'ppk.agenda.update': 'Agenda diubah', 'ppk.invitation.upload': 'Undangan diunggah', 'ppk.invitation.convert': 'Undangan dijadikan agenda',
  'ppk.contract.create': 'Kontrak ditambahkan', 'ppk.contract.update': 'Kontrak diubah', 'ppk.contract.status': 'Status kontrak diubah', 'ppk.addendum.create': 'Addendum ditambahkan',
  'ppk.bill.create': 'Tagihan dicatat', 'ppk.bill.update': 'Tagihan diubah', 'ppk.bill.diverifikasi': 'Tagihan diverifikasi', 'ppk.bill.dibatalkan': 'Tagihan dibatalkan', 'ppk.payment.create': 'Pembayaran dicatat', 'ppk.payment.void': 'Pembayaran dibatalkan',
  'ppk.budget.create': 'Baris anggaran ditambahkan', 'ppk.budget.revise': 'Pagu direvisi', 'ppk.budget.plan': 'RPD diperbarui', 'ppk.import.committed': 'Impor Excel PPK disimpan', 'ppk.import.excel': 'Data diimpor dari Excel',
  'ppk.vendor.create': 'Penyedia ditambahkan', 'ppk.vendor.update': 'Penyedia diubah', 'ppk.sp2d.add': 'SP2D dicatat', 'import.committed': 'Impor register disimpan', 'document.delete_issued': 'Dokumen bernomor dihapus'
};
/** Kalimat aktivitas dari kode aksi log audit; aksi yang tidak dikenal ditampilkan apa adanya. */
export const activityText = (action: string) => ACTION_LABEL[action] ?? action.replace(/^ppk\./, '').replace(/[._]/g, ' ');
/** Aksi yang tidak perlu tampil di Dashboard. */
export const isNoiseActivity = (action: string) => action === 'user.login';
