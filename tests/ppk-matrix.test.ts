import { describe, expect, it } from 'vitest';
import { billMatrix } from '@shared/ppk/matrix';
import type { Bill } from '@shared/ppk/bills';
import type { Contract } from '@shared/ppk/contracts';

const c = (id: string, vendor: string, status = 'aktif') => ({ id, contract_number: `K-${id}`, vendor_name: vendor, status, latest_value: 100, billed: 0, sisa_kontrak: 100 }) as unknown as Contract;
const b = (id: string, contract_id: string, service_month: string, total: number, status: string, paid = 0) => ({ id, contract_id, service_month, total, status, paid }) as unknown as Bill;

describe('matriks tagihan', () => {
  it('menjumlahkan per bulan, mengabaikan batal dan tahun lain, tahap terburuk menang', () => {
    const m = billMatrix([c('1', 'PT B'), c('2', 'PT A'), c('3', 'PT C', 'dibatalkan')], [
      b('x', '1', '2026-01', 10, 'diverifikasi', 10), b('y', '1', '2026-01', 5, 'draft'), b('z', '1', '2026-02', 7, 'dibatalkan'),
      b('w', '1', '2025-12', 9, 'diverifikasi'), b('v', '2', '2026-03', 3, 'diverifikasi', 1), b('u', '3', '2026-03', 3, 'diverifikasi')
    ], 2026);
    expect(m.map((r) => r.vendor_name)).toEqual(['PT A', 'PT B']);
    expect(m[1].months[0]).toEqual({ total: 15, count: 2, bill_ids: ['x', 'y'], stage: 'Draf' });
    expect(m[1].months[1]).toBeNull();
    expect(m[0].months[2]).toMatchObject({ total: 3, stage: 'Dibayar sebagian' });
  });
});
