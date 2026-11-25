/**
 * Rekonsiliasi SP2D: data SP2D menurut SAKTI dicocokkan dengan pembayaran kanal SAKTI di aplikasi lewat nomor SP2D.
 * Satu SP2D bisa membayar beberapa porsi tagihan, jadi nilai aplikasi = jumlah pembayaran aktif bernomor sama.
 */
export interface Sp2dInput { sp2d_number: string; sp2d_date: string; amount: number; notes: string }
export interface Sp2dRecord extends Sp2dInput {
  id: string; fiscal_year_id: string; created_by: string; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}
export interface AppSp2dPayment { reference_number: string; payment_date: string; amount: number; bill_number: string; contract_number: string; vendor_name: string }

export type ReconStatus = 'cocok' | 'selisih_nilai' | 'selisih_tanggal' | 'hanya_sakti' | 'hanya_aplikasi';
export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  cocok: 'Cocok', selisih_nilai: 'Selisih nilai', selisih_tanggal: 'Tanggal berbeda', hanya_sakti: 'Hanya di SAKTI', hanya_aplikasi: 'Belum ada di data SAKTI'
};
export interface ReconRow {
  sp2d_number: string; status: ReconStatus;
  sakti_id: string | null; sakti_date: string | null; sakti_amount: number;
  app_date: string | null; app_amount: number; diff: number;
  bills: string[];
}

/** Nomor SP2D dibandingkan tanpa spasi dan huruf besar/kecil. */
export const sp2dKey = (n: string) => n.replace(/\s+/g, '').toUpperCase();

export function reconcile(records: Sp2dRecord[], payments: AppSp2dPayment[]): ReconRow[] {
  const app = new Map<string, { date: string; amount: number; bills: string[]; number: string }>();
  for (const p of payments) {
    const k = sp2dKey(p.reference_number);
    const a = app.get(k) ?? { date: p.payment_date, amount: 0, bills: [], number: p.reference_number };
    a.amount += p.amount; if (p.payment_date > a.date) a.date = p.payment_date;
    a.bills.push(`${p.bill_number} · ${p.vendor_name}`);
    app.set(k, a);
  }
  const rows: ReconRow[] = [];
  for (const r of records.filter((x) => !x.voided_at)) {
    const k = sp2dKey(r.sp2d_number); const a = app.get(k); app.delete(k);
    const status: ReconStatus = !a ? 'hanya_sakti' : a.amount !== r.amount ? 'selisih_nilai' : a.date !== r.sp2d_date ? 'selisih_tanggal' : 'cocok';
    rows.push({ sp2d_number: r.sp2d_number, status, sakti_id: r.id, sakti_date: r.sp2d_date, sakti_amount: r.amount,
      app_date: a?.date ?? null, app_amount: a?.amount ?? 0, diff: (a?.amount ?? 0) - r.amount, bills: a?.bills ?? [] });
  }
  for (const a of app.values()) rows.push({ sp2d_number: a.number, status: 'hanya_aplikasi', sakti_id: null, sakti_date: null, sakti_amount: 0,
    app_date: a.date, app_amount: a.amount, diff: a.amount, bills: a.bills });
  const order: ReconStatus[] = ['selisih_nilai', 'hanya_sakti', 'hanya_aplikasi', 'selisih_tanggal', 'cocok'];
  return rows.sort((x, y) => order.indexOf(x.status) - order.indexOf(y.status) || (x.sakti_date ?? x.app_date ?? '').localeCompare(y.sakti_date ?? y.app_date ?? ''));
}
