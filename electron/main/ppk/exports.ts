import { BUDGET_KIND_LABEL, type BudgetLine } from '@shared/ppk/budget';
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL, contractProject, type Contract } from '@shared/ppk/contracts';
import { billStage, type Bill, type PaymentRow } from '@shared/ppk/bills';
import type { WriteSheet } from '../numbering/xlsx';

/** Kolom: [judul, lebar, rupiah?]. Kolom rupiah tetap angka di Excel, hanya diberi format ribuan. */
const sheet = (name: string, cols: Array<[string, number, boolean?]>, rows: WriteSheet['rows']): WriteSheet =>
  ({ name, header: cols.map((c) => c[0]), widths: cols.map((c) => c[1]), money: cols.flatMap((c, i) => (c[2] ? [i] : [])), rows });
const M = true;

export function budgetSheets(rows: BudgetLine[]): WriteSheet[] {
  return [sheet('Anggaran', [
    ['Tahun', 8], ['Unit', 18], ['Program', 14], ['Kegiatan', 32], ['MAK', 12], ['Nama akun', 32], ['Detail output', 36], ['Sumber dana', 12], ['Jenis', 12],
    ['Pagu awal', 20, M], ['Pagu terakhir', 20, M], ['Jumlah revisi', 10], ['Komitmen kontrak', 20, M], ['Sisa pagu', 20, M],
    ['Realisasi tagihan', 20, M], ['Dibayar', 20, M], ['Sisa realisasi', 20, M], ['Status', 10], ['Uraian', 40]
  ], rows.map((b) => [String(b.year), b.unit_name, b.program_code, b.activity_name, b.mak, b.mak_name, b.output_detail, b.source_code, BUDGET_KIND_LABEL[b.kind] ?? b.kind,
    b.pagu_awal, b.pagu_terakhir, b.revisions, b.allocated, b.sisa, b.billed, b.paid, b.sisa_realisasi, b.is_active ? 'Aktif' : 'Nonaktif', b.description]))];
}

export function contractSheets(rows: Contract[]): WriteSheet[] {
  return [sheet('Kontrak', [
    ['Nomor kontrak', 28], ['Project', 18], ['Nomor kontrak penyedia', 24], ['Tanggal kontrak', 13], ['Penyedia', 32], ['Program', 14], ['Kegiatan', 30], ['Paket', 12], ['Jenis', 10],
    ['Uraian', 44], ['Mulai', 12], ['Selesai', 12], ['Selesai terakhir', 14], ['Tahun jamak', 10],
    ['Nilai awal', 20, M], ['Perubahan addendum', 20, M], ['Jumlah addendum', 10], ['Nilai terakhir', 20, M], ['Dibebankan ke anggaran', 20, M],
    ['Tertagih', 20, M], ['Dibayar', 20, M], ['Sisa kontrak', 20, M], ['Dibayar tahun lalu', 20, M], ['Status', 11], ['Catatan', 30]
  ], rows.map((c) => [c.contract_number, contractProject(c), c.vendor_contract_number, c.contract_date, c.vendor_name, c.program_code, c.activity_name, c.package_code, CONTRACT_TYPE_LABEL[c.contract_type] ?? c.contract_type,
    c.description, c.start_date, c.end_date, c.effective_end, c.is_multi_year ? 'Ya' : 'Tidak',
    c.initial_value, c.addendum_total, c.addendum_count, c.latest_value, c.allocated, c.billed, c.paid, c.sisa_kontrak, c.prior_year_paid,
    CONTRACT_STATUS_LABEL[c.status] ?? c.status, c.notes]))];
}

/** Tagihan sesuai filter + pembayaran milik tagihan tersebut. */
export function billSheets(bills: Bill[], payments: PaymentRow[]): WriteSheet[] {
  const ids = new Set(bills.map((b) => b.id));
  return [
    sheet('Tagihan', [
      ['Bulan layanan', 11], ['Nomor tagihan', 26], ['Tanggal tagihan', 13], ['Nomor kontrak', 26], ['Penyedia', 32],
      ['Nilai kena pajak', 20, M], ['Pass-through', 18, M], ['Nilai tagihan', 20, M], ['DPP', 20, M], ['PPN', 18, M], ['PPh 23', 18, M],
      ['Potongan', 16, M], ['Alasan potongan', 24], ['Bersih', 20, M], ['Terbayar', 20, M], ['Belum dibayar', 20, M],
      ['Kode faktur', 8], ['Nomor faktur', 22], ['Nomor BA', 24], ['Tanggal BA', 12], ['Status', 16], ['Catatan', 30]
    ], bills.map((b) => [b.service_month, b.bill_number, b.bill_date, b.contract_number, b.vendor_name,
      b.amount, b.pass_through, b.total, b.dpp, b.ppn, b.pph23, b.deduction, b.deduction_reason, b.net, b.paid, b.status === 'dibatalkan' ? 0 : b.total - b.paid,
      b.faktur_code, b.faktur_number, b.ba_number, b.ba_date, billStage(b), b.notes])),
    sheet('Pembayaran', [
      ['Tanggal bayar', 12], ['Saluran', 9], ['Nomor SP2D / referensi', 26], ['Jumlah', 20, M], ['Nomor tagihan', 26], ['Bulan layanan', 11],
      ['Nomor kontrak', 26], ['Penyedia', 32], ['MAK', 12], ['Detail output', 30], ['Sumber dana', 11], ['Status', 12], ['Alasan batal', 24], ['Catatan', 30]
    ], payments.filter((p) => ids.has(p.bill_id)).map((p) => [p.payment_date, p.channel, p.reference_number, p.amount, p.bill_number, p.service_month,
      p.contract_number, p.vendor_name, p.mak, p.output_detail, p.source_code, p.voided_at ? 'Dibatalkan' : 'Sah', p.void_reason, p.notes]))
  ];
}
