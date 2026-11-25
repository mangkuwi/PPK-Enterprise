/** Matriks tagihan per kontrak per bulan layanan (pengganti lembar rekap per paket di spreadsheet). Murni. */
import { billStage, type Bill } from './bills';
import type { Contract } from './contracts';

export interface MatrixCell { total: number; count: number; bill_ids: string[]; stage: string }
export interface MatrixRow {
  contract_id: string; contract_number: string; vendor_name: string; latest_value: number; billed: number; sisa_kontrak: number;
  months: Array<MatrixCell | null>;
}

/** Tahap gabungan sel: yang paling butuh perhatian menang (draf → menunggu bayar → sebagian → lunas). */
const RANK = ['Draf', 'Menunggu bayar', 'Dibayar sebagian', 'Lunas'];

export function billMatrix(contracts: Contract[], bills: Bill[], year: number): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const c of contracts.filter((x) => x.status !== 'dibatalkan')) rows.set(c.id, {
    contract_id: c.id, contract_number: c.contract_number, vendor_name: c.vendor_name, latest_value: c.latest_value, billed: c.billed, sisa_kontrak: c.sisa_kontrak,
    months: Array.from({ length: 12 }, () => null)
  });
  for (const b of bills) {
    const r = rows.get(b.contract_id); const k = Number(b.service_month.slice(5, 7)) - 1;
    if (!r || b.status === 'dibatalkan' || b.service_month.slice(0, 4) !== String(year) || k < 0 || k > 11) continue;
    const st = billStage(b); const cell = r.months[k] ?? { total: 0, count: 0, bill_ids: [], stage: st };
    cell.total += b.total; cell.count++; cell.bill_ids.push(b.id);
    if (RANK.indexOf(st) < RANK.indexOf(cell.stage)) cell.stage = st;
    r.months[k] = cell;
  }
  return [...rows.values()].sort((a, b) => a.vendor_name.localeCompare(b.vendor_name) || a.contract_number.localeCompare(b.contract_number));
}
