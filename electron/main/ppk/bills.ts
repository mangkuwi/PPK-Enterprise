import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { formatRupiah } from '@shared/ppk/money';
import { proposeTax } from '@shared/ppk/tax';
import { budgetLabel, type Warned } from '@shared/ppk/budget';
import { PAYMENT_CHANNELS, type Bill, type BillDetail, type BillFilter, type BillFundingView, type BillInput, type BillStatus, type PaymentInput, type PaymentRow, type PaymentView } from '@shared/ppk/bills';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { constraintError, date, rupiah, text } from './validate';

const now = () => new Date().toISOString();
const PAID = `COALESCE((SELECT SUM(py.amount) FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id
  WHERE bf.bill_id = b.id AND py.voided_at IS NULL), 0)`;
/** Total, bersih, dan terbayar dihitung query; pajak disimpan karena mengikuti faktur. */
const SELECT = `SELECT b.*, c.contract_number, v.name AS vendor_name, fy.year, o.name AS official_name,
  b.amount + b.pass_through AS total, b.amount + b.pass_through - b.ppn - b.pph23 - b.deduction AS net, ${PAID} AS paid
  FROM ppk_bills b JOIN ppk_contracts c ON c.id = b.contract_id JOIN ppk_vendors v ON v.id = c.vendor_id
  JOIN ppk_fiscal_years fy ON fy.id = c.fiscal_year_id LEFT JOIN ppk_officials o ON o.id = b.official_id`;

async function load(s: PpkStore, id: string): Promise<Bill> {
  const b = await s.get<Bill>(`${SELECT} WHERE b.id = ?`, [id]);
  if (!b) throw new PpkError('NOT_FOUND', 'Tagihan tidak ditemukan.');
  return b;
}

export async function listBills(s: PpkStore, actor: Actor, f: BillFilter = {}): Promise<Bill[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  if (f.fiscal_year_id) { w.push('c.fiscal_year_id = ?'); p.push(f.fiscal_year_id); }
  if (f.contract_id) { w.push('b.contract_id = ?'); p.push(f.contract_id); }
  if (f.status && f.status !== 'semua') { w.push('b.status = ?'); p.push(f.status); }
  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    w.push(`(lower(b.bill_number) LIKE ? ESCAPE '\\' OR lower(c.contract_number) LIKE ? ESCAPE '\\' OR lower(v.name) LIKE ? ESCAPE '\\')`); p.push(q, q, q);
  }
  // shortcut: daftar dibatasi 5000 tagihan per filter tanpa paging, tambah paging bila satu TA melebihi itu.
  return s.all<Bill>(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY b.service_month DESC, v.name, b.bill_date DESC LIMIT 5000`, p);
}

export async function getBill(s: PpkStore, actor: Actor, id: string): Promise<BillDetail> {
  await requirePpk(s, actor, 'read');
  const bill = await load(s, id);
  const funding = await s.all<Omit<BillFundingView, 'payments'>>(`SELECT bf.id, bf.budget_line_id, bf.amount, ba.code AS mak, bl.output_detail, fs.code AS source_code, bl.kind,
    fs.payment_channel, COALESCE((SELECT SUM(py.amount) FROM ppk_payments py WHERE py.bill_funding_id = bf.id AND py.voided_at IS NULL), 0) AS paid
    FROM ppk_bill_funding bf JOIN ppk_budget_lines bl ON bl.id = bf.budget_line_id
    JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id
    WHERE bf.bill_id = ? ORDER BY ba.code, fs.code`, [id]);
  const payments = await s.all<PaymentView & { bill_funding_id: string }>(`SELECT py.* FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id
    WHERE bf.bill_id = ? ORDER BY py.payment_date, py.created_at`, [id]);
  return { bill, funding: funding.map((f) => ({ ...f, payments: payments.filter((x) => x.bill_funding_id === f.id) })) };
}

/** Semua pembayaran (termasuk yang dibatalkan) untuk tagihan TA terpilih. */
export async function listPayments(s: PpkStore, actor: Actor, fiscal_year_id: string): Promise<PaymentRow[]> {
  await requirePpk(s, actor, 'read');
  return s.all<PaymentRow>(`SELECT py.*, b.id AS bill_id, b.bill_number, b.service_month, b.status AS bill_status, c.contract_number, v.name AS vendor_name,
    ba.code AS mak, bl.output_detail, fs.code AS source_code, bl.kind
    FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id JOIN ppk_bills b ON b.id = bf.bill_id
    JOIN ppk_contracts c ON c.id = b.contract_id JOIN ppk_vendors v ON v.id = c.vendor_id
    JOIN ppk_budget_lines bl ON bl.id = bf.budget_line_id JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id
    JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id
    WHERE c.fiscal_year_id = ? ORDER BY py.payment_date DESC, py.created_at DESC LIMIT 20000`, [fiscal_year_id]);
}

function clean(i: BillInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.service_month ?? '')) throw new PpkError('INVALID', 'Bulan layanan tidak valid (format YYYY-MM).');
  if (i.faktur_code !== null && i.faktur_code !== '02' && i.faktur_code !== '04') throw new PpkError('INVALID', 'Kode faktur harus 02, 04, atau kosong.');
  const r = {
    contract_id: i.contract_id, bill_number: text(i.bill_number, 'Nomor tagihan', { required: true, max: 200 }), bill_date: date(i.bill_date, 'Tanggal tagihan')!,
    received_date: date(i.received_date, 'Tanggal diterima', false), service_month: i.service_month,
    period_start: date(i.period_start, 'Awal periode layanan', false), period_end: date(i.period_end, 'Akhir periode layanan', false),
    amount: rupiah(i.amount, 'Nilai tagihan kena pajak'), pass_through: rupiah(i.pass_through, 'Nilai pass-through'),
    faktur_code: i.faktur_code, faktur_number: text(i.faktur_number, 'Nomor faktur', { max: 100 }),
    deduction: rupiah(i.deduction, 'Potongan (denda/SLA)'), deduction_reason: text(i.deduction_reason, 'Alasan potongan', { max: 500 }),
    fx_rate: text(i.fx_rate, 'Kurs', { max: 40 }), fx_amount: text(i.fx_amount, 'Nilai valas', { max: 40 }),
    ba_number: text(i.ba_number, 'Nomor BA pembayaran', { max: 200 }), ba_date: date(i.ba_date, 'Tanggal BA', false), official_id: i.official_id || null,
    notes: text(i.notes, 'Catatan', { max: 2000 })
  };
  if (r.period_start && r.period_end && r.period_end < r.period_start) throw new PpkError('INVALID', 'Akhir periode layanan tidak boleh sebelum awalnya.');
  if (r.deduction && !r.deduction_reason) throw new PpkError('INVALID', 'Alasan potongan wajib diisi bila ada potongan.');
  for (const [v, l] of [[r.fx_rate, 'Kurs'], [r.fx_amount, 'Nilai valas']] as const)
    if (v && !/^\d+(\.\d+)?$/.test(v)) throw new PpkError('INVALID', `${l} harus angka desimal dengan titik, mis. 15850.25.`);
  if (r.amount + r.pass_through <= 0) throw new PpkError('INVALID', 'Nilai tagihan harus lebih dari 0.');
  const seen = new Set<string>();
  const funding = (i.funding ?? []).map((f) => {
    if (seen.has(f.budget_line_id)) throw new PpkError('INVALID', 'Satu baris anggaran hanya boleh muncul sekali.');
    seen.add(f.budget_line_id);
    return { budget_line_id: f.budget_line_id, amount: rupiah(f.amount, 'Nilai per sumber dana', { min: 1 }) };
  });
  const total = r.amount + r.pass_through;
  const sum = funding.reduce((a, f) => a + f.amount, 0);
  if (sum !== total) throw new PpkError('INVALID', `Pembagian sumber dana ${formatRupiah(sum)} harus sama dengan nilai tagihan ${formatRupiah(total)}.`);
  return { r, funding, total, ppn: i.ppn, pph23: i.pph23 };
}

/** Pajak: tarif berlaku pada tanggal tagihan; angka faktur boleh berbeda dari usulan (diberi peringatan). */
async function tax(t: PpkStore, c: ReturnType<typeof clean>, warnings: string[]) {
  const rate = await t.get<{ id: string; ppn_bp: number; pph23_bp: number }>('SELECT id, ppn_bp, pph23_bp FROM ppk_tax_rates WHERE valid_from <= ? ORDER BY valid_from DESC LIMIT 1', [c.r.bill_date]);
  if (!rate && c.r.faktur_code) throw new PpkError('INVALID', `Belum ada tarif pajak yang berlaku pada ${c.r.bill_date}.`);
  const p = proposeTax({ gross: c.r.amount, faktur: c.r.faktur_code }, rate ?? { ppn_bp: 0, pph23_bp: 0 });
  const ppn = c.ppn == null ? p.ppn : rupiah(c.ppn, 'PPN');
  const pph23 = c.pph23 == null ? p.pph23 : rupiah(c.pph23, 'PPh 23');
  if (c.r.faktur_code !== '02' && ppn) throw new PpkError('INVALID', 'PPN hanya dipungut untuk faktur 02.');
  if (!c.r.faktur_code && pph23) throw new PpkError('INVALID', 'PPh 23 hanya dipotong bila ada faktur (02 atau 04).');
  if (ppn !== p.ppn) warnings.push(`PPN ${formatRupiah(ppn)} berbeda dari usulan sistem ${formatRupiah(p.ppn)}.`);
  if (pph23 !== p.pph23) warnings.push(`PPh 23 ${formatRupiah(pph23)} berbeda dari usulan sistem ${formatRupiah(p.pph23)}.`);
  if (ppn + pph23 + c.r.deduction > c.total) throw new PpkError('INVALID', 'Pajak dan potongan melebihi nilai tagihan.');
  return { tax_rate_id: rate?.id ?? null, dpp: p.dpp, ppn, pph23 };
}

/** Cek kontrak, sisa kontrak, dan baris anggaran; isi peringatan pagu. Dipanggil di dalam transaksi. */
async function checkBill(t: PpkStore, c: ReturnType<typeof clean>, billId: string | null, warnings: string[]) {
  const k = await t.get<{ status: string; fiscal_year_id: string; latest: number }>(`SELECT c.status, c.fiscal_year_id,
    c.initial_value + COALESCE((SELECT SUM(a.value_change) FROM ppk_contract_addendums a WHERE a.contract_id = c.id AND a.voided_at IS NULL), 0) AS latest
    FROM ppk_contracts c WHERE c.id = ?`, [c.r.contract_id]);
  if (!k) throw new PpkError('INVALID', 'Kontrak tidak ditemukan.');
  if (k.status !== 'aktif' && k.status !== 'selesai') throw new PpkError('INVALID', 'Tagihan hanya untuk kontrak berstatus Aktif atau Selesai.');
  const billed = (await t.get<{ n: number }>(`SELECT COALESCE(SUM(amount + pass_through), 0) AS n FROM ppk_bills WHERE contract_id = ? AND status <> 'dibatalkan' AND id <> ?`,
    [c.r.contract_id, billId ?? '']))!.n;
  if (billed + c.total > k.latest)
    throw new PpkError('INVALID', `Tagihan ${formatRupiah(c.total)} melebihi sisa kontrak ${formatRupiah(k.latest - billed)}. Catat addendum dulu bila nilai kontrak bertambah.`);
  for (const f of c.funding) {
    const bl = await t.get<{ fiscal_year_id: string; is_active: number; mak: string; output_detail: string; source_code: string; kind: string; pagu: number; used: number }>(
      `SELECT bl.fiscal_year_id, bl.is_active, ba.code AS mak, bl.output_detail, fs.code AS source_code, bl.kind,
        (SELECT bv.amount FROM ppk_budget_versions bv WHERE bv.budget_line_id = bl.id ORDER BY bv.version_no DESC LIMIT 1) AS pagu,
        COALESCE((SELECT SUM(bf.amount) FROM ppk_bill_funding bf JOIN ppk_bills x ON x.id = bf.bill_id
          WHERE bf.budget_line_id = bl.id AND x.status <> 'dibatalkan' AND x.id <> ?), 0) AS used
       FROM ppk_budget_lines bl JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id WHERE bl.id = ?`,
      [billId ?? '', f.budget_line_id]);
    if (!bl) throw new PpkError('INVALID', 'Baris anggaran tidak ditemukan.');
    if (bl.fiscal_year_id !== k.fiscal_year_id) throw new PpkError('INVALID', `Baris anggaran ${budgetLabel(bl)} bukan tahun anggaran kontrak.`);
    if (!bl.is_active) throw new PpkError('INVALID', `Baris anggaran ${budgetLabel(bl)} tidak aktif.`);
    if (bl.used + f.amount > bl.pagu) warnings.push(`Realisasi ${budgetLabel(bl)} menjadi ${formatRupiah(bl.used + f.amount)}, melebihi pagu terakhir ${formatRupiah(bl.pagu)}.`);
  }
}

const BILL_COLS = ['contract_id', 'bill_number', 'bill_date', 'received_date', 'service_month', 'period_start', 'period_end', 'amount', 'pass_through', 'faktur_code',
  'faktur_number', 'tax_rate_id', 'dpp', 'ppn', 'pph23', 'deduction', 'deduction_reason', 'fx_rate', 'fx_amount', 'ba_number', 'ba_date', 'official_id', 'notes'] as const;

/** Tambah (id null) atau ubah tagihan draf. Sumber dana diganti utuh dan wajib berjumlah sama dengan nilai tagihan. */
export async function saveBill(s: PpkStore, actor: Actor, id: string | null, version: number | null, i: BillInput): Promise<Warned<Bill>> {
  const c = clean(i);
  const warnings: string[] = [];
  const billId = id ?? randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    let before: Record<string, unknown> | undefined;
    if (id) {
      before = await t.get<Record<string, unknown>>('SELECT * FROM ppk_bills WHERE id = ?', [id]);
      if (!before) throw new PpkError('NOT_FOUND', 'Tagihan tidak ditemukan.');
      if (before.status !== 'draft') throw new PpkError('INVALID', 'Hanya tagihan draf yang dapat diubah. Batalkan lalu buat tagihan baru untuk koreksi.');
      if (before.contract_id !== c.r.contract_id) throw new PpkError('INVALID', 'Kontrak tagihan tidak dapat dipindah. Batalkan lalu buat tagihan baru.');
    }
    await checkBill(t, c, id, warnings);
    const row = { ...c.r, ...(await tax(t, c, warnings)) };
    const ts = now();
    try {
      if (id) {
        const r = await t.run(`UPDATE ppk_bills SET ${BILL_COLS.map((k) => `${k} = ?`).join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`,
          [...BILL_COLS.map((k) => row[k]), actor.name, ts, id, version ?? 0]);
        if (!r.changes) throw new PpkError('CONFLICT', 'Tagihan sudah diubah pengguna lain. Muat ulang lalu ulangi.');
        await t.run('DELETE FROM ppk_bill_funding WHERE bill_id = ?', [id]);
      } else {
        await t.run(`INSERT INTO ppk_bills (id, ${BILL_COLS.join(', ')}, created_by, created_at, updated_by, updated_at) VALUES (?, ${BILL_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
          [billId, ...BILL_COLS.map((k) => row[k]), actor.name, ts, actor.name, ts]);
      }
    } catch (e) { constraintError(e, 'Tagihan (nomor tagihan pada kontrak ini)'); }
    for (const f of c.funding) await t.run('INSERT INTO ppk_bill_funding (id, bill_id, budget_line_id, amount) VALUES (?,?,?,?)', [randomUUID(), billId, f.budget_line_id, f.amount]);
    await ppkAudit(t, actor, id ? 'bill.update' : 'bill.create', 'ppk_bills', billId, { before, after: { ...row, funding: c.funding } });
  });
  return { data: await load(s, billId), warnings };
}

export async function setBillStatus(s: PpkStore, actor: Actor, id: string, status: Exclude<BillStatus, 'draft'>, reason: string): Promise<Bill> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const b = await t.get<{ status: BillStatus }>('SELECT status FROM ppk_bills WHERE id = ?', [id]);
    if (!b) throw new PpkError('NOT_FOUND', 'Tagihan tidak ditemukan.');
    const why = text(reason, 'Alasan pembatalan', { required: status === 'dibatalkan', max: 500 });
    if (status === 'diverifikasi' && b.status !== 'draft') throw new PpkError('INVALID', 'Hanya tagihan draf yang dapat diverifikasi.');
    if (status === 'dibatalkan') {
      if (b.status === 'dibatalkan') throw new PpkError('INVALID', 'Tagihan sudah dibatalkan.');
      const paid = await t.get(`SELECT 1 FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id WHERE bf.bill_id = ? AND py.voided_at IS NULL`, [id]);
      if (paid) throw new PpkError('INVALID', 'Tagihan sudah dibayar. Batalkan pembayarannya dulu bila memang salah catat.');
    }
    if (status === 'diverifikasi' && !(await t.get('SELECT 1 FROM ppk_bill_funding WHERE bill_id = ?', [id]))) throw new PpkError('INVALID', 'Tagihan belum dibagi ke sumber dana.');
    await t.run('UPDATE ppk_bills SET status = ?, cancel_reason = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?', [status, why, actor.name, now(), id]);
    await ppkAudit(t, actor, `bill.${status}`, 'ppk_bills', id, { before: b.status, after: status, reason: why });
  });
  return load(s, id);
}

/** Catat SP2D (SAKTI) atau pembayaran FO untuk satu porsi sumber dana. Tagihan selalu dibayar penuh, jadi satu pembayaran aktif per porsi. */
export async function addPayment(s: PpkStore, actor: Actor, billFundingId: string, i: PaymentInput): Promise<Warned<Bill>> {
  if (!PAYMENT_CHANNELS.includes(i.channel)) throw new PpkError('INVALID', 'Kanal pembayaran tidak dikenal.');
  const r = {
    channel: i.channel, reference_number: text(i.reference_number, i.channel === 'SAKTI' ? 'Nomor SP2D' : 'Nomor referensi pembayaran', { required: true, max: 100 }),
    payment_date: date(i.payment_date, 'Tanggal pembayaran')!, amount: rupiah(i.amount, 'Nilai dibayar', { min: 1 }), notes: text(i.notes, 'Catatan', { max: 1000 })
  };
  const warnings: string[] = [];
  let billId = '';
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const f = await t.get<{ bill_id: string; amount: number; status: BillStatus; bill_date: string; payment_channel: string }>(`SELECT bf.bill_id, bf.amount, b.status, b.bill_date, fs.payment_channel
      FROM ppk_bill_funding bf JOIN ppk_bills b ON b.id = bf.bill_id JOIN ppk_budget_lines bl ON bl.id = bf.budget_line_id
      JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id WHERE bf.id = ?`, [billFundingId]);
    if (!f) throw new PpkError('NOT_FOUND', 'Porsi sumber dana tagihan tidak ditemukan.');
    billId = f.bill_id;
    if (f.status !== 'diverifikasi') throw new PpkError('INVALID', 'Pembayaran hanya dicatat untuk tagihan yang sudah diverifikasi.');
    if (r.amount > f.amount) throw new PpkError('INVALID', `Nilai dibayar melebihi porsi sumber dana ${formatRupiah(f.amount)}.`);
    if (r.amount < f.amount) warnings.push(`Nilai dibayar ${formatRupiah(r.amount)} kurang dari porsi ${formatRupiah(f.amount)}; porsi ini belum lunas.`);
    if (r.channel !== f.payment_channel) warnings.push(`Kanal ${r.channel} berbeda dari kanal sumber dana (${f.payment_channel}).`);
    if (r.payment_date < f.bill_date) warnings.push('Tanggal pembayaran lebih awal dari tanggal tagihan.');
    const id = randomUUID();
    try {
      await t.run(`INSERT INTO ppk_payments (id, bill_funding_id, channel, reference_number, payment_date, amount, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, billFundingId, r.channel, r.reference_number, r.payment_date, r.amount, r.notes, actor.name, now()]);
    } catch (e) { constraintError(e, 'Pembayaran untuk porsi ini (batalkan pembayaran lama dulu)'); }
    await ppkAudit(t, actor, 'payment.create', 'ppk_payments', id, { bill_id: billId, after: r });
  });
  return { data: await load(s, billId), warnings };
}

export async function voidPayment(s: PpkStore, actor: Actor, paymentId: string, reason: string): Promise<Bill> {
  const why = text(reason, 'Alasan pembatalan', { required: true, max: 500 });
  let billId = '';
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const p = await t.get<{ voided_at: string | null; bill_id: string; amount: number; reference_number: string }>(
      'SELECT py.voided_at, bf.bill_id, py.amount, py.reference_number FROM ppk_payments py JOIN ppk_bill_funding bf ON bf.id = py.bill_funding_id WHERE py.id = ?', [paymentId]);
    if (!p) throw new PpkError('NOT_FOUND', 'Pembayaran tidak ditemukan.');
    if (p.voided_at) throw new PpkError('INVALID', 'Pembayaran sudah dibatalkan.');
    billId = p.bill_id;
    await t.run('UPDATE ppk_payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', [now(), actor.name, why, paymentId]);
    await ppkAudit(t, actor, 'payment.void', 'ppk_payments', paymentId, { bill_id: billId, reason: why, amount: p.amount, reference_number: p.reference_number });
  });
  return load(s, billId);
}
