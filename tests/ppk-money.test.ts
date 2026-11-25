import { describe, expect, it } from 'vitest';
import { divRound, formatRupiah, parseRupiah, rupiahText, terbilang } from '../shared/ppk/money';
import { proposeTax } from '../shared/ppk/tax';

const RATES = { ppn_bp: 1100, pph23_bp: 200 };

describe('rupiah', () => {
  it('rupiahText tidak pernah melempar galat untuk isian setengah jadi', () => {
    expect([NaN, null, undefined, 1.5, '12', Infinity, 2 ** 60].map(rupiahText)).toEqual(['', '', '', '', '', '', '']);
    expect(rupiahText(0)).toBe('Rp0');
    expect(rupiahText(-1250000)).toBe('-Rp1.250.000');
  });
  it('format dan parse', () => {
    expect(formatRupiah(1890127634275)).toBe('Rp1.890.127.634.275');
    expect(formatRupiah(-5000)).toBe('-Rp5.000');
    expect(formatRupiah(0)).toBe('Rp0');
    expect(parseRupiah('Rp 1.234.567')).toBe(1234567);
    expect(parseRupiah('1.234.567,00')).toBe(1234567);
    expect(parseRupiah('-Rp5.000')).toBe(-5000);
    expect(parseRupiah(' 25640000000 ')).toBe(25640000000);
    expect(() => parseRupiah('1.234,50')).toThrow(/sen/);
    expect(() => parseRupiah('12a')).toThrow();
    expect(() => parseRupiah('1.23.4')).toThrow();
    expect(() => formatRupiah(1.5)).toThrow();
  });

  it('terbilang', () => {
    expect(terbilang(0)).toBe('nol');
    expect(terbilang(11)).toBe('sebelas');
    expect(terbilang(115)).toBe('seratus lima belas');
    expect(terbilang(1000)).toBe('seribu');
    expect(terbilang(1001000)).toBe('satu juta seribu');
    expect(terbilang(21000)).toBe('dua puluh satu ribu');
    expect(terbilang(5046005100)).toBe('lima miliar empat puluh enam juta lima ribu seratus');
    expect(terbilang(1774790000000)).toBe('satu triliun tujuh ratus tujuh puluh empat miliar tujuh ratus sembilan puluh juta');
    expect(terbilang(-250)).toBe('minus dua ratus lima puluh');
  });

  it('divRound membulatkan setengah ke atas tanpa kehilangan presisi', () => {
    expect(divRound(5n, 2n)).toBe(3);
    expect(divRound(-5n, 2n)).toBe(-3);
    expect(divRound(9007199254740991n * 10000n, 11100n)).toBe(8114593923190082);
  });
});

describe('usulan pajak', () => {
  it('FP 02: PPN + PPh 23 dari DPP = bruto ÷ 1,11', () => {
    const t = proposeTax({ gross: 111_000_000, faktur: '02' }, RATES);
    expect(t).toEqual({ dpp: 100_000_000, ppn: 11_000_000, pph23: 2_000_000, net: 98_000_000 });
  });
  it('FP 04: hanya PPh 23', () => {
    expect(proposeTax({ gross: 111_000_000, faktur: '04' }, RATES)).toEqual({ dpp: 100_000_000, ppn: 0, pph23: 2_000_000, net: 109_000_000 });
  });
  it('pembulatan ke rupiah terdekat dan neto konsisten', () => {
    const t = proposeTax({ gross: 1_000_001, faktur: '02' }, RATES);
    expect(t.dpp).toBe(900_902); // 900.901,8 → 900.902
    expect(t.ppn).toBe(99_099); // 99.099,22
    expect(t.pph23).toBe(18_018); // 18.018,04
    expect(t.net).toBe(1_000_001 - 99_099 - 18_018);
  });
  it('pass-through dan tanpa faktur tidak dipotong', () => {
    expect(proposeTax({ gross: 5_046_005_100, faktur: '04', passThrough: true }, RATES).net).toBe(5_046_005_100);
    expect(proposeTax({ gross: 10, faktur: null }, RATES).net).toBe(10);
  });
  it('menolak bruto negatif atau pecahan', () => {
    expect(() => proposeTax({ gross: -1, faktur: '02' }, RATES)).toThrow();
    expect(() => proposeTax({ gross: 1.5, faktur: '02' }, RATES)).toThrow();
  });
});
