import { assertRupiah, divRound } from './money';

/** Tarif dalam basis poin (1100 = 11%). Diambil dari tabel ppk_tax_rates yang berlaku pada tanggal tagihan. */
export interface TaxRates { ppn_bp: number; pph23_bp: number }

/** 02 = PPN + PPh 23 dipungut; 04 = hanya PPh 23 (jawaban pengguna no. 10). */
export type FakturCode = '02' | '04';

export interface TaxInput { gross: number; faktur: FakturCode | null; passThrough?: boolean }
/** ppn = PPN yang dipungut (0 untuk FP 04, seperti kolom ppn di spreadsheet). */
export interface TaxResult { dpp: number; ppn: number; pph23: number; net: number }

/**
 * Usulan pajak satu tagihan. Bruto sudah termasuk PPN, jadi DPP = bruto ÷ (1 + tarif PPN).
 * PPN dan PPh 23 dihitung dari DPP, dibulatkan ke rupiah terdekat. Angka final tetap mengikuti faktur (jawaban no. 12).
 * Pass-through tidak dipotong pajak.
 */
export function proposeTax(i: TaxInput, r: TaxRates): TaxResult {
  assertRupiah(i.gross, 'Nilai bruto');
  if (i.gross < 0) throw new Error('Nilai bruto tidak boleh negatif.');
  if (i.passThrough || !i.faktur) return { dpp: i.gross, ppn: 0, pph23: 0, net: i.gross };
  const dpp = divRound(BigInt(i.gross) * 10000n, BigInt(10000 + r.ppn_bp));
  const ppn = i.faktur === '02' ? divRound(BigInt(dpp) * BigInt(r.ppn_bp), 10000n) : 0;
  const pph23 = divRound(BigInt(dpp) * BigInt(r.pph23_bp), 10000n);
  return { dpp, ppn, pph23, net: i.gross - ppn - pph23 };
}
