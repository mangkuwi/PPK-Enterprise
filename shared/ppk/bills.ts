import type { FakturCode } from './tax';

export const BILL_STATUS_LABEL = { draft: 'Draf', diverifikasi: 'Diverifikasi', dibatalkan: 'Dibatalkan' } as const;
export type BillStatus = keyof typeof BILL_STATUS_LABEL;
export const PAYMENT_CHANNELS = ['SAKTI', 'FO', 'LAINNYA'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export interface BillFundingRow { budget_line_id: string; amount: number }

export interface BillInput {
  contract_id: string; bill_number: string; bill_date: string; received_date: string | null; service_month: string;
  period_start: string | null; period_end: string | null;
  /** Bagian kena pajak, sudah termasuk PPN. */
  amount: number;
  /** Bagian pass-through, tidak dipotong pajak. */
  pass_through: number;
  faktur_code: FakturCode | null; faktur_number: string;
  /** null = pakai usulan sistem; isi bila angka faktur berbeda (mis. selisih pembulatan). */
  ppn: number | null; pph23: number | null;
  deduction: number; deduction_reason: string;
  fx_rate: string; fx_amount: string; ba_number: string; ba_date: string | null; official_id: string | null; notes: string;
  funding: BillFundingRow[];
}

export interface Bill extends Omit<BillInput, 'funding' | 'ppn' | 'pph23'> {
  id: string; status: BillStatus; version: number; cancel_reason: string; tax_rate_id: string | null;
  dpp: number; ppn: number; pph23: number;
  contract_number: string; vendor_name: string; year: number; official_name: string | null;
  /** amount + pass_through. */
  total: number;
  /** Diterima penyedia: total − PPN − PPh 23 − potongan. */
  net: number;
  paid: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
}
export interface PaymentView {
  id: string; channel: PaymentChannel; reference_number: string; payment_date: string; amount: number; notes: string;
  created_by: string; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}
/** Pembayaran lintas tagihan untuk daftar dan ekspor. */
export interface PaymentRow extends PaymentView {
  bill_id: string; bill_number: string; service_month: string; bill_status: BillStatus; contract_number: string; vendor_name: string;
  mak: string; output_detail: string; source_code: string; kind: string;
}
export interface BillFundingView extends BillFundingRow {
  id: string; mak: string; output_detail: string; source_code: string; kind: string; payment_channel: PaymentChannel;
  paid: number; payments: PaymentView[];
}
export interface BillDetail { bill: Bill; funding: BillFundingView[] }
export interface BillFilter { fiscal_year_id?: string; contract_id?: string; status?: BillStatus | 'semua'; search?: string }
export interface PaymentInput { channel: PaymentChannel; reference_number: string; payment_date: string; amount: number; notes: string }

/** Status tampilan: tagihan terverifikasi yang seluruh porsinya terbayar = lunas. */
export const billStage = (b: Pick<Bill, 'status' | 'total' | 'paid'>) =>
  b.status !== 'diverifikasi' ? BILL_STATUS_LABEL[b.status] : b.paid >= b.total ? 'Lunas' : b.paid > 0 ? 'Dibayar sebagian' : 'Menunggu bayar';

/**
 * Bagi nilai tagihan ke baris anggaran sesuai urutan, menghabiskan sisa pagu tiap baris dulu (jawaban: tagihan dipecah
 * berdasarkan sisa pagu, mis. RM habis lalu BLU). Kelebihan masuk baris terakhir; pemanggil memberi peringatan.
 */
export function splitByRemaining(total: number, lines: Array<{ id: string; remaining: number }>): BillFundingRow[] {
  if (!lines.length || total <= 0) return [];
  const out: BillFundingRow[] = [];
  let left = total;
  lines.forEach((l, i) => {
    const take = i === lines.length - 1 ? left : Math.min(left, Math.max(0, l.remaining));
    if (take > 0) out.push({ budget_line_id: l.id, amount: take });
    left -= take;
  });
  return out;
}

/** Urutan pembebanan: pagu DIPA sebelum saldo kas, lalu RM → PNBP → BLU → lainnya. */
const SOURCE_ORDER: Record<string, number> = { RM: 0, PNBP: 1, BLU: 2 };
export const fundingOrder = (a: { kind: string; source_code: string }, b: { kind: string; source_code: string }) =>
  (a.kind === b.kind ? 0 : a.kind === 'dipa' ? -1 : 1) || (SOURCE_ORDER[a.source_code] ?? 9) - (SOURCE_ORDER[b.source_code] ?? 9);
