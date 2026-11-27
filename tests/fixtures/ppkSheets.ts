// Spreadsheet PPK sintetis (bentuk sama dengan berkas pengguna), dipakai test impor dan test PostgreSQL.
import type { Cell, ImportSheet } from '@shared/ppk/import';

export const MAK = '6378.QDB.001.051.A.525112';
export const DETAIL = 'Sewa transponder';
export const summary: ImportSheet = { name: 'SUMMARY', rows: [
  ['REKAP PPK 6'],
  ['UNIT', 'MATA ANGGARAN', 'MAK', 'DETAIL RKA-KL', 'PAGU AWAL', 'SALDO KAS 2025'],
  ['PPK 6', 'RM', MAK, DETAIL, 2_000_000_000, null],
  ['PPK 6', 'BLU', MAK, DETAIL, 500_000_000, null],
  ['PPK 6', 'BLU', MAK, DETAIL, 0, 300_000_000],
  ['TOTAL', null, null, null, 2_500_000_000, 300_000_000]
] };
export const H = ['NO', 'PENYEDIA', 'URAIAN', 'NOMOR KONTRAK', 'NILAI KONTRAK', 'JADWAL PEKERJAAN MULAI', 'JADWAL PEKERJAAN SELESAI', 'PERIODE TAGIHAN', 'NILAI TAGIHAN',
  'NOMOR & TANGGAL INVOICE', 'NOMOR & TANGGAL BA PEMBAYARAN', 'FP 04/02', 'PPN', 'PPH 23', 'SUMBER DANA', 'MAK'];
export const row = (o: Record<string, Cell>): Cell[] => H.map((h) => o[h] ?? null);
export const detail = (extra: Cell[][] = []): ImportSheet => ({ name: 'SEWA', rows: [
  ['SEWA TRANSPONDER'], ['PAGU', 2_000_000_000], H,
  row({ NO: 1, PENYEDIA: 'PT Satelit Nusantara', 'NOMOR KONTRAK': 'KTR-001 tanggal 2 Januari 2026', 'NILAI KONTRAK': 1_200_000_000, 'JADWAL PEKERJAAN MULAI': '1 Januari 2026',
    'JADWAL PEKERJAAN SELESAI': '31 Maret 2026', 'PERIODE TAGIHAN': 'JANUARI', 'NILAI TAGIHAN': 400_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-1 tanggal 5 Februari 2026',
    'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-1 tanggal 10 Februari 2026', 'FP 04/02': 'FP 04', 'PPH 23': 7_207_207, 'SUMBER DANA': 'RM', MAK }),
  row({ 'PERIODE TAGIHAN': 'FEBRUARI - MARET', 'NILAI TAGIHAN': 800_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-2 tanggal 31 April 2026', 'SUMBER DANA': 'RM', MAK }),
  row({ 'NOMOR KONTRAK': 'KTR-001/PKS-2', 'NILAI KONTRAK': 600_000_000, 'JADWAL PEKERJAAN MULAI': '1 April 2026', 'JADWAL PEKERJAAN SELESAI': '30 Juni 2026',
    'PERIODE TAGIHAN': 'APRIL', 'NILAI TAGIHAN': 300_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-3 tanggal 5 Mei 2026', 'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-3 tanggal 8 Mei 2026',
    'SUMBER DANA': 'RM', MAK }),
  row({ 'PERIODE TAGIHAN': 'PASS THROUGH APRIL', 'NILAI TAGIHAN': 50_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-3P tanggal 5 Mei 2026',
    'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-3P tanggal 8 Mei 2026', 'SUMBER DANA': 'RM', MAK }),
  row({ NO: 2, PENYEDIA: 'PT Dua Jaya', 'NOMOR KONTRAK': 'KTR-002', 'NILAI KONTRAK': 100_000_000, 'PERIODE TAGIHAN': 'MEI', 'NILAI TAGIHAN': 100_000_000,
    'NOMOR & TANGGAL INVOICE': 'INV-9 tanggal 1 Juni 2026', 'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-9 tanggal 2 Juni 2026', 'SUMBER DANA': 'BLU', MAK }),
  ...extra
] });
