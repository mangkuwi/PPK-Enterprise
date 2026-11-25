import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { reconcile, sp2dKey, type AppSp2dPayment, type ReconRow, type Sp2dInput, type Sp2dRecord } from '@shared/ppk/sp2d';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { constraintError, date, rupiah, text } from './validate';

const now = () => new Date().toISOString();

export interface Sp2dReport { records: Sp2dRecord[]; rows: ReconRow[] }

export async function sp2dReport(s: PpkStore, actor: Actor, fiscal_year_id: string): Promise<Sp2dReport> {
  await requirePpk(s, actor, 'read');
  const records = await s.all<Sp2dRecord>('SELECT * FROM ppk_sp2d_records WHERE fiscal_year_id = ? ORDER BY sp2d_date, sp2d_number', [fiscal_year_id]);
  const payments = await s.all<AppSp2dPayment>(`SELECT py.reference_number, py.payment_date, py.amount, b.bill_number, c.contract_number, v.name AS vendor_name
    FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id JOIN ppk_bills b ON b.id = bf.bill_id
    JOIN ppk_contracts c ON c.id = b.contract_id JOIN ppk_vendors v ON v.id = c.vendor_id
    WHERE c.fiscal_year_id = ? AND py.channel = 'SAKTI' AND py.voided_at IS NULL`, [fiscal_year_id]);
  return { records, rows: reconcile(records, payments) };
}

/** Catat SP2D dari laporan SAKTI. Nomor yang sama (aktif) di tahun yang sama ditolak. */
export async function addSp2d(s: PpkStore, actor: Actor, fiscal_year_id: string, i: Sp2dInput): Promise<Sp2dRecord> {
  const r = { sp2d_number: text(i.sp2d_number, 'Nomor SP2D', { required: true, max: 100 }), sp2d_date: date(i.sp2d_date, 'Tanggal SP2D')!,
    amount: rupiah(i.amount, 'Nilai SP2D', { min: 1 }), notes: text(i.notes, 'Catatan', { max: 1000 }) };
  const id = randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    if (!(await t.get('SELECT 1 FROM ppk_fiscal_years WHERE id = ?', [fiscal_year_id]))) throw new PpkError('INVALID', 'Tahun anggaran tidak ditemukan.');
    const dup = (await t.all<{ sp2d_number: string }>('SELECT sp2d_number FROM ppk_sp2d_records WHERE fiscal_year_id = ? AND voided_at IS NULL', [fiscal_year_id]))
      .find((x) => sp2dKey(x.sp2d_number) === sp2dKey(r.sp2d_number));
    if (dup) throw new PpkError('CONFLICT', `SP2D ${dup.sp2d_number} sudah dicatat.`);
    try {
      await t.run('INSERT INTO ppk_sp2d_records (id, fiscal_year_id, sp2d_number, sp2d_date, amount, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, fiscal_year_id, r.sp2d_number, r.sp2d_date, r.amount, r.notes, actor.name, now()]);
    } catch (e) { throw constraintError(e, 'SP2D sudah dicatat.'); }
    await ppkAudit(t, actor, 'sp2d.add', 'ppk_sp2d_records', id, { after: r });
  });
  return (await s.get<Sp2dRecord>('SELECT * FROM ppk_sp2d_records WHERE id = ?', [id]))!;
}

export async function voidSp2d(s: PpkStore, actor: Actor, id: string, reason: string): Promise<void> {
  const why = text(reason, 'Alasan', { required: true, max: 500 });
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const r = await t.get<Sp2dRecord>('SELECT * FROM ppk_sp2d_records WHERE id = ?', [id]);
    if (!r) throw new PpkError('NOT_FOUND', 'Data SP2D tidak ditemukan.');
    if (r.voided_at) throw new PpkError('INVALID', 'Data SP2D sudah dibatalkan.');
    await t.run('UPDATE ppk_sp2d_records SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', [now(), actor.name, why, id]);
    await ppkAudit(t, actor, 'sp2d.void', 'ppk_sp2d_records', id, { before: r, reason: why });
  });
}
