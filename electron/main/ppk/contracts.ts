import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { formatRupiah } from '@shared/ppk/money';
import type { Warned } from '@shared/ppk/budget';
import {
  CONTRACT_NEXT, CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL, type Addendum, type AddendumInput, type AllocationRow, type AllocationView,
  type Contract, type ContractDetail, type ContractFilter, type ContractInput, type ContractStatus, type ScheduleRow
} from '@shared/ppk/contracts';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { budgetLabel } from './budget';
import { constraintError, date, rupiah, text } from './validate';

const now = () => new Date().toISOString();
const VALID_ADD = 'a.voided_at IS NULL';

/** Nilai kontrak terakhir, tanggal selesai efektif, pembebanan, dan jadwal dihitung dari riwayat, tidak disimpan. */
const SELECT = `SELECT c.*, fy.year, v.name AS vendor_name, p.code AS program_code, act.name AS activity_name, sp.code AS package_code,
  COALESCE((SELECT SUM(a.value_change) FROM ppk_contract_addendums a WHERE a.contract_id = c.id AND ${VALID_ADD}), 0) AS addendum_total,
  (SELECT COUNT(*) FROM ppk_contract_addendums a WHERE a.contract_id = c.id AND ${VALID_ADD}) AS addendum_count,
  COALESCE((SELECT a.new_end_date FROM ppk_contract_addendums a WHERE a.contract_id = c.id AND ${VALID_ADD} AND a.new_end_date IS NOT NULL
    ORDER BY a.addendum_date DESC, a.created_at DESC LIMIT 1), c.end_date) AS effective_end,
  COALESCE((SELECT SUM(fa.amount) FROM ppk_contract_funding_allocations fa WHERE fa.contract_id = c.id), 0) AS allocated,
  COALESCE((SELECT SUM(cs.planned_amount) FROM ppk_contract_schedules cs WHERE cs.contract_id = c.id), 0) AS scheduled
  FROM ppk_contracts c
  JOIN ppk_fiscal_years fy ON fy.id = c.fiscal_year_id JOIN ppk_vendors v ON v.id = c.vendor_id
  JOIN ppk_programs p ON p.id = c.program_id JOIN ppk_activities act ON act.id = c.activity_id
  LEFT JOIN ppk_service_packages sp ON sp.id = c.service_package_id`;
const withLatest = (c: Contract): Contract => ({ ...c, latest_value: c.initial_value + c.addendum_total });

async function load(s: PpkStore, id: string): Promise<Contract> {
  const c = await s.get<Contract>(`${SELECT} WHERE c.id = ?`, [id]);
  if (!c) throw new PpkError('NOT_FOUND', 'Kontrak tidak ditemukan.');
  return withLatest(c);
}

export async function listContracts(s: PpkStore, actor: Actor, f: ContractFilter = {}): Promise<Contract[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  if (f.fiscal_year_id) { w.push('c.fiscal_year_id = ?'); p.push(f.fiscal_year_id); }
  if (f.status && f.status !== 'semua') { w.push('c.status = ?'); p.push(f.status); }
  if (f.vendor_id) { w.push('c.vendor_id = ?'); p.push(f.vendor_id); }
  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    w.push(`(lower(c.contract_number) LIKE ? ESCAPE '\\' OR lower(c.description) LIKE ? ESCAPE '\\' OR lower(v.name) LIKE ? ESCAPE '\\')`); p.push(q, q, q);
  }
  return (await s.all<Contract>(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY fy.year DESC, v.name, c.start_date LIMIT 5000`, p)).map(withLatest);
}

export async function getContract(s: PpkStore, actor: Actor, id: string): Promise<ContractDetail> {
  await requirePpk(s, actor, 'read');
  const contract = await load(s, id);
  const addendums = await s.all<Addendum>('SELECT * FROM ppk_contract_addendums WHERE contract_id = ? ORDER BY addendum_date, created_at', [id]);
  const schedule = await s.all<ScheduleRow>('SELECT month, planned_amount FROM ppk_contract_schedules WHERE contract_id = ? ORDER BY month', [id]);
  const allocations = await s.all<AllocationView>(`SELECT fa.budget_line_id, fa.amount, ba.code AS mak, bl.output_detail, fs.code AS source_code, bl.kind,
    (SELECT bv.amount FROM ppk_budget_versions bv WHERE bv.budget_line_id = bl.id ORDER BY bv.version_no DESC LIMIT 1) AS pagu_terakhir
    FROM ppk_contract_funding_allocations fa JOIN ppk_budget_lines bl ON bl.id = fa.budget_line_id
    JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id
    WHERE fa.contract_id = ? ORDER BY ba.code, fs.code`, [id]);
  return { contract, addendums, schedule, allocations };
}

function clean(i: ContractInput) {
  if (!(i.contract_type in CONTRACT_TYPE_LABEL)) throw new PpkError('INVALID', 'Jenis kontrak tidak dikenal.');
  const start = date(i.start_date, 'Tanggal mulai')!; const end = date(i.end_date, 'Tanggal selesai')!;
  if (end < start) throw new PpkError('INVALID', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  const term_start = i.is_multi_year ? date(i.term_start, 'Awal masa kontrak') : null;
  const term_end = i.is_multi_year ? date(i.term_end, 'Akhir masa kontrak') : null;
  if (term_start && term_end && term_end < term_start) throw new PpkError('INVALID', 'Akhir masa kontrak tidak boleh sebelum awalnya.');
  return {
    fiscal_year_id: i.fiscal_year_id, unit_id: i.unit_id, vendor_id: i.vendor_id, program_id: i.program_id, activity_id: i.activity_id,
    service_package_id: i.service_package_id || null, contract_type: i.contract_type,
    contract_number: text(i.contract_number, 'Nomor kontrak', { required: true, max: 200 }), vendor_contract_number: text(i.vendor_contract_number, 'Nomor kontrak penyedia', { max: 200 }),
    contract_date: date(i.contract_date, 'Tanggal kontrak')!, description: text(i.description, 'Uraian pekerjaan', { required: true, max: 2000 }),
    initial_value: rupiah(i.initial_value, 'Nilai kontrak awal'), start_date: start, end_date: end,
    is_multi_year: i.is_multi_year ? 1 : 0, term_start, term_end, prior_year_paid: i.is_multi_year ? rupiah(i.prior_year_paid, 'Akumulasi pembayaran tahun lalu') : 0,
    notes: text(i.notes, 'Catatan', { max: 2000 })
  };
}
type Row = ReturnType<typeof clean>;
const COLS = ['fiscal_year_id', 'unit_id', 'vendor_id', 'program_id', 'activity_id', 'service_package_id', 'contract_type', 'contract_number', 'vendor_contract_number',
  'contract_date', 'description', 'initial_value', 'start_date', 'end_date', 'is_multi_year', 'term_start', 'term_end', 'prior_year_paid', 'notes'] as const;

async function checkRefs(t: PpkStore, r: Row, vendorWas?: string) {
  const act = await t.get<{ program_id: string }>('SELECT program_id FROM ppk_activities WHERE id = ?', [r.activity_id]);
  if (!act || act.program_id !== r.program_id) throw new PpkError('INVALID', 'Kegiatan tidak termasuk program yang dipilih.');
  const v = await t.get<{ status: string }>('SELECT status FROM ppk_vendors WHERE id = ?', [r.vendor_id]);
  if (!v) throw new PpkError('INVALID', 'Penyedia tidak ditemukan.');
  if (v.status !== 'aktif' && r.vendor_id !== vendorWas) throw new PpkError('INVALID', 'Penyedia tidak aktif. Aktifkan dulu di Database Penyedia.');
}

export async function createContract(s: PpkStore, actor: Actor, i: ContractInput): Promise<Contract> {
  const r = clean(i);
  const id = randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    await checkRefs(t, r);
    const ts = now();
    try {
      await t.run(`INSERT INTO ppk_contracts (id, ${COLS.join(', ')}, status, version, created_by, created_at, updated_by, updated_at)
        VALUES (?, ${COLS.map(() => '?').join(', ')}, 'draft', 1, ?, ?, ?, ?)`, [id, ...COLS.map((c) => r[c]), actor.name, ts, actor.name, ts]);
    } catch (e) { constraintError(e, 'Kontrak (nomor kontrak)'); }
    await ppkAudit(t, actor, 'contract.create', 'ppk_contracts', id, { after: r });
  });
  return load(s, id);
}

/** Nilai awal terkunci setelah kontrak aktif: perubahan nilai lewat addendum. Versi mencegah saling menimpa. */
export async function updateContract(s: PpkStore, actor: Actor, id: string, version: number, i: ContractInput): Promise<Contract> {
  const r = clean(i);
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const before = await t.get<Record<string, unknown> & { status: ContractStatus; initial_value: number; vendor_id: string; fiscal_year_id: string }>('SELECT * FROM ppk_contracts WHERE id = ?', [id]);
    if (!before) throw new PpkError('NOT_FOUND', 'Kontrak tidak ditemukan.');
    if (before.status === 'selesai' || before.status === 'dibatalkan') throw new PpkError('INVALID', `Kontrak berstatus ${CONTRACT_STATUS_LABEL[before.status]} tidak dapat diubah.`);
    if (before.status !== 'draft' && r.initial_value !== before.initial_value) throw new PpkError('INVALID', 'Nilai awal kontrak aktif tidak dapat diubah. Catat perubahan nilai sebagai addendum.');
    if (r.fiscal_year_id !== before.fiscal_year_id && (await t.get('SELECT 1 FROM ppk_contract_funding_allocations WHERE contract_id = ?', [id])))
      throw new PpkError('INVALID', 'Tahun anggaran tidak dapat diubah selama kontrak masih dibebankan ke baris anggaran.');
    await checkRefs(t, r, before.vendor_id);
    try {
      const res = await t.run(`UPDATE ppk_contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`,
        [...COLS.map((c) => r[c]), actor.name, now(), id, version]);
      if (!res.changes) throw new PpkError('CONFLICT', 'Kontrak sudah diubah pengguna lain. Muat ulang lalu ulangi.');
    } catch (e) { constraintError(e, 'Kontrak (nomor kontrak)'); }
    await ppkAudit(t, actor, 'contract.update', 'ppk_contracts', id, { before, after: r });
  });
  return load(s, id);
}

export async function setContractStatus(s: PpkStore, actor: Actor, id: string, status: ContractStatus, reason: string): Promise<Contract> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const c = await t.get<{ status: ContractStatus }>('SELECT status FROM ppk_contracts WHERE id = ?', [id]);
    if (!c) throw new PpkError('NOT_FOUND', 'Kontrak tidak ditemukan.');
    if (!CONTRACT_NEXT[c.status].includes(status)) throw new PpkError('INVALID', `Status ${CONTRACT_STATUS_LABEL[c.status]} tidak dapat diubah menjadi ${CONTRACT_STATUS_LABEL[status] ?? status}.`);
    const why = text(reason, 'Alasan', { required: status === 'dibatalkan', max: 500 });
    await t.run('UPDATE ppk_contracts SET status = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?', [status, actor.name, now(), id]);
    await ppkAudit(t, actor, 'contract.status', 'ppk_contracts', id, { before: c.status, after: status, reason: why });
  });
  return load(s, id);
}

async function writable(t: PpkStore, id: string) {
  const c = await t.get<{ status: ContractStatus }>('SELECT status FROM ppk_contracts WHERE id = ?', [id]);
  if (!c) throw new PpkError('NOT_FOUND', 'Kontrak tidak ditemukan.');
  if (c.status === 'dibatalkan' || c.status === 'selesai') throw new PpkError('INVALID', `Kontrak berstatus ${CONTRACT_STATUS_LABEL[c.status]} tidak dapat diubah.`);
}

export async function addAddendum(s: PpkStore, actor: Actor, contractId: string, i: AddendumInput): Promise<Warned<Contract>> {
  const r = {
    addendum_number: text(i.addendum_number, 'Nomor addendum', { required: true, max: 200 }), addendum_date: date(i.addendum_date, 'Tanggal addendum')!,
    value_change: rupiah(i.value_change, 'Perubahan nilai', { min: null }), period_start: date(i.period_start, 'Awal periode', false),
    period_end: date(i.period_end, 'Akhir periode', false), new_end_date: date(i.new_end_date, 'Tanggal selesai baru', false), description: text(i.description, 'Uraian', { max: 2000 })
  };
  if (r.period_start && r.period_end && r.period_end < r.period_start) throw new PpkError('INVALID', 'Akhir periode tidak boleh sebelum awal periode.');
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    await writable(t, contractId);
    const c = await load(t, contractId);
    if (c.latest_value + r.value_change < 0) throw new PpkError('INVALID', 'Nilai kontrak setelah addendum tidak boleh negatif.');
    const id = randomUUID();
    try {
      await t.run(`INSERT INTO ppk_contract_addendums (id, contract_id, addendum_number, addendum_date, value_change, period_start, period_end, new_end_date, description, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, contractId, r.addendum_number, r.addendum_date, r.value_change, r.period_start, r.period_end, r.new_end_date, r.description, actor.name, now()]);
    } catch (e) { constraintError(e, 'Addendum (nomor addendum pada kontrak ini)'); }
    await ppkAudit(t, actor, 'addendum.create', 'ppk_contract_addendums', id, { contract_id: contractId, after: r, latest_value_before: c.latest_value });
  });
  return checked(s, actor, contractId);
}

export async function voidAddendum(s: PpkStore, actor: Actor, addendumId: string, reason: string): Promise<Warned<Contract>> {
  const why = text(reason, 'Alasan pembatalan', { required: true, max: 500 });
  let contractId = '';
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const a = await t.get<Addendum>('SELECT * FROM ppk_contract_addendums WHERE id = ?', [addendumId]);
    if (!a) throw new PpkError('NOT_FOUND', 'Addendum tidak ditemukan.');
    if (a.voided_at) throw new PpkError('INVALID', 'Addendum sudah dibatalkan.');
    contractId = a.contract_id;
    await writable(t, contractId);
    const c = await load(t, contractId);
    if (c.latest_value - a.value_change < 0) throw new PpkError('INVALID', 'Membatalkan addendum ini membuat nilai kontrak negatif.');
    await t.run('UPDATE ppk_contract_addendums SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', [now(), actor.name, why, addendumId]);
    await ppkAudit(t, actor, 'addendum.void', 'ppk_contract_addendums', addendumId, { contract_id: contractId, reason: why, value_change: a.value_change });
  });
  return checked(s, actor, contractId);
}

/** Peringatan (bukan penolakan) agar pengguna tahu bila jadwal atau pembebanan tidak lagi sama dengan nilai kontrak. */
async function checked(s: PpkStore, actor: Actor, id: string, extra: string[] = []): Promise<Warned<Contract>> {
  const c = (await getContract(s, actor, id)).contract;
  const w = [...extra];
  if (c.scheduled && c.scheduled !== c.latest_value) w.push(`Total jadwal ${formatRupiah(c.scheduled)} berbeda dari nilai kontrak terakhir ${formatRupiah(c.latest_value)}.`);
  if (c.allocated > c.latest_value) w.push(`Pembebanan anggaran ${formatRupiah(c.allocated)} melebihi nilai kontrak terakhir ${formatRupiah(c.latest_value)}.`);
  return { data: c, warnings: w };
}

export async function setSchedule(s: PpkStore, actor: Actor, contractId: string, rows: ScheduleRow[]): Promise<Warned<Contract>> {
  const seen = new Set<string>();
  const clean = rows.map((r) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)) throw new PpkError('INVALID', `Bulan "${r.month}" tidak valid (format YYYY-MM).`);
    if (seen.has(r.month)) throw new PpkError('INVALID', `Bulan ${r.month} tercantum dua kali.`);
    seen.add(r.month);
    return { month: r.month, planned_amount: rupiah(r.planned_amount, `Nilai bulan ${r.month}`) };
  });
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    await writable(t, contractId);
    const before = await t.all<ScheduleRow>('SELECT month, planned_amount FROM ppk_contract_schedules WHERE contract_id = ? ORDER BY month', [contractId]);
    await t.run('DELETE FROM ppk_contract_schedules WHERE contract_id = ?', [contractId]);
    const ts = now();
    for (const r of clean) await t.run('INSERT INTO ppk_contract_schedules (contract_id, month, planned_amount, updated_by, updated_at) VALUES (?,?,?,?,?)', [contractId, r.month, r.planned_amount, actor.name, ts]);
    await ppkAudit(t, actor, 'schedule.set', 'ppk_contracts', contractId, { before, after: clean });
  });
  return checked(s, actor, contractId);
}

/**
 * Ganti seluruh pembebanan kontrak ke baris anggaran. Ditolak bila total melebihi nilai kontrak terakhir atau baris anggaran
 * beda tahun/nonaktif. Pagu yang terlampaui hanya diperingatkan (keputusan PPK, jawaban no. 4).
 */
export async function setAllocations(s: PpkStore, actor: Actor, contractId: string, rows: AllocationRow[]): Promise<Warned<Contract>> {
  const ids = new Set<string>();
  const clean = rows.map((r) => {
    if (ids.has(r.budget_line_id)) throw new PpkError('INVALID', 'Satu baris anggaran hanya boleh muncul sekali.');
    ids.add(r.budget_line_id);
    return { budget_line_id: r.budget_line_id, amount: rupiah(r.amount, 'Nilai pembebanan', { min: 1 }) };
  });
  const warnings: string[] = [];
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    await writable(t, contractId);
    const c = await load(t, contractId);
    const total = clean.reduce((a, r) => a + r.amount, 0);
    if (total > c.latest_value) throw new PpkError('INVALID', `Total pembebanan ${formatRupiah(total)} melebihi nilai kontrak terakhir ${formatRupiah(c.latest_value)}.`);
    const before = await t.all<AllocationRow>('SELECT budget_line_id, amount FROM ppk_contract_funding_allocations WHERE contract_id = ? ORDER BY budget_line_id', [contractId]);
    await t.run('DELETE FROM ppk_contract_funding_allocations WHERE contract_id = ?', [contractId]);
    const ts = now();
    for (const r of clean) {
      const bl = await t.get<{ fiscal_year_id: string; is_active: number; mak: string; output_detail: string; source_code: string; kind: string; pagu: number }>(
        `SELECT bl.fiscal_year_id, bl.is_active, ba.code AS mak, bl.output_detail, fs.code AS source_code, bl.kind,
          (SELECT bv.amount FROM ppk_budget_versions bv WHERE bv.budget_line_id = bl.id ORDER BY bv.version_no DESC LIMIT 1) AS pagu
         FROM ppk_budget_lines bl JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id WHERE bl.id = ?`, [r.budget_line_id]);
      if (!bl) throw new PpkError('INVALID', 'Baris anggaran tidak ditemukan.');
      if (bl.fiscal_year_id !== c.fiscal_year_id) throw new PpkError('INVALID', `Baris anggaran ${budgetLabel(bl)} bukan tahun anggaran kontrak.`);
      if (!bl.is_active && !before.some((b) => b.budget_line_id === r.budget_line_id)) throw new PpkError('INVALID', `Baris anggaran ${budgetLabel(bl)} tidak aktif.`);
      await t.run('INSERT INTO ppk_contract_funding_allocations (id, contract_id, budget_line_id, amount, updated_by, updated_at) VALUES (?,?,?,?,?,?)',
        [randomUUID(), contractId, r.budget_line_id, r.amount, actor.name, ts]);
      const used = (await t.get<{ n: number }>(`SELECT COALESCE(SUM(fa.amount), 0) AS n FROM ppk_contract_funding_allocations fa JOIN ppk_contracts c ON c.id = fa.contract_id
        WHERE fa.budget_line_id = ? AND c.status <> 'dibatalkan'`, [r.budget_line_id]))!.n;
      if (used > bl.pagu) warnings.push(`Komitmen pada ${budgetLabel(bl)} menjadi ${formatRupiah(used)}, melebihi pagu terakhir ${formatRupiah(bl.pagu)}.`);
    }
    await ppkAudit(t, actor, 'allocation.set', 'ppk_contracts', contractId, { before, after: clean });
  });
  return checked(s, actor, contractId, warnings);
}
