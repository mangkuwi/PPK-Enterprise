import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { formatRupiah } from '@shared/ppk/money';
import { BUDGET_KIND_LABEL, type BudgetAmountInput, type BudgetLine, type BudgetLineInput, type BudgetVersion, type Warned } from '@shared/ppk/budget';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { constraintError, date, rupiah, text } from './validate';

const now = () => new Date().toISOString();

/** Pagu dan komitmen dihitung dari riwayat, tidak disimpan. Komitmen = pembebanan kontrak yang tidak dibatalkan. */
const SELECT = `SELECT bl.*, fy.year, u.name AS unit_name, p.code AS program_code, p.name AS program_name, a.name AS activity_name,
  ba.code AS mak, ba.name AS mak_name, fs.code AS source_code, fs.name AS source_name,
  (SELECT v.amount FROM ppk_budget_versions v WHERE v.budget_line_id = bl.id AND v.version_no = 1) AS pagu_awal,
  (SELECT v.amount FROM ppk_budget_versions v WHERE v.budget_line_id = bl.id ORDER BY v.version_no DESC LIMIT 1) AS pagu_terakhir,
  (SELECT COUNT(*) FROM ppk_budget_versions v WHERE v.budget_line_id = bl.id) - 1 AS revisions,
  COALESCE((SELECT SUM(fa.amount) FROM ppk_contract_funding_allocations fa JOIN ppk_contracts c ON c.id = fa.contract_id
    WHERE fa.budget_line_id = bl.id AND c.status <> 'dibatalkan'), 0) AS allocated
  FROM ppk_budget_lines bl
  JOIN ppk_fiscal_years fy ON fy.id = bl.fiscal_year_id JOIN ppk_units u ON u.id = bl.unit_id
  JOIN ppk_programs p ON p.id = bl.program_id JOIN ppk_activities a ON a.id = bl.activity_id
  JOIN ppk_budget_accounts ba ON ba.id = bl.budget_account_id JOIN ppk_funding_sources fs ON fs.id = bl.funding_source_id`;
const withSisa = (r: BudgetLine): BudgetLine => ({ ...r, sisa: r.pagu_terakhir - r.allocated });

export async function listBudgetLines(s: PpkStore, actor: Actor, f: { fiscal_year_id?: string; include_inactive?: boolean } = {}): Promise<BudgetLine[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  if (f.fiscal_year_id) { w.push('bl.fiscal_year_id = ?'); p.push(f.fiscal_year_id); }
  if (!f.include_inactive) w.push('bl.is_active = 1');
  const rows = await s.all<BudgetLine>(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY fy.year DESC, p.code, ba.code, bl.output_detail, fs.code, bl.kind`, p);
  return rows.map(withSisa);
}

export async function getBudgetLine(s: PpkStore, actor: Actor, id: string): Promise<BudgetLine> {
  await requirePpk(s, actor, 'read');
  const r = await s.get<BudgetLine>(`${SELECT} WHERE bl.id = ?`, [id]);
  if (!r) throw new PpkError('NOT_FOUND', 'Baris anggaran tidak ditemukan.');
  return withSisa(r);
}

function amountInput(i: BudgetAmountInput) {
  return {
    amount: rupiah(i.amount, 'Nilai pagu'), effective_date: date(i.effective_date, 'Tanggal berlaku')!,
    source_document: text(i.source_document, 'Dokumen sumber (mis. nomor DIPA/revisi)', { required: true, max: 300 }), notes: text(i.notes, 'Catatan', { max: 1000 })
  };
}

export async function createBudgetLine(s: PpkStore, actor: Actor, i: BudgetLineInput, pagu: BudgetAmountInput): Promise<BudgetLine> {
  const a = amountInput(pagu);
  const row = { ...i, output_detail: text(i.output_detail, 'Detail rincian output', { max: 300 }), description: text(i.description, 'Uraian', { max: 1000 }) };
  if (!(row.kind in BUDGET_KIND_LABEL)) throw new PpkError('INVALID', 'Jenis pagu tidak dikenal.');
  const id = randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const act = await t.get<{ program_id: string }>('SELECT program_id FROM ppk_activities WHERE id = ?', [row.activity_id]);
    if (!act || act.program_id !== row.program_id) throw new PpkError('INVALID', 'Kegiatan tidak termasuk program yang dipilih.');
    const ts = now();
    try {
      await t.run(`INSERT INTO ppk_budget_lines (id, fiscal_year_id, unit_id, program_id, activity_id, budget_account_id, output_detail, funding_source_id, kind, description,
        created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, row.fiscal_year_id, row.unit_id, row.program_id, row.activity_id, row.budget_account_id, row.output_detail, row.funding_source_id, row.kind, row.description, actor.name, ts, actor.name, ts]);
    } catch (e) { constraintError(e, 'Baris anggaran (TA + MAK + detail output + sumber dana + jenis)'); }
    await t.run(`INSERT INTO ppk_budget_versions (id, budget_line_id, version_no, kind, amount, effective_date, source_document, notes, created_by, created_at)
      VALUES (?,?,1,'awal',?,?,?,?,?,?)`, [randomUUID(), id, a.amount, a.effective_date, a.source_document, a.notes, actor.name, ts]);
    await ppkAudit(t, actor, 'budget.create', 'ppk_budget_lines', id, { after: { ...row, pagu_awal: a } });
  });
  return getBudgetLine(s, actor, id);
}

/** Identitas baris (TA, MAK, sumber dana, ...) tidak diubah agar riwayat tetap utuh; buat baris baru dan nonaktifkan yang salah. */
export async function updateBudgetLine(s: PpkStore, actor: Actor, id: string, version: number, p: { description: string; is_active: boolean }): Promise<BudgetLine> {
  const description = text(p.description, 'Uraian', { max: 1000 });
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const before = await t.get<{ description: string; is_active: number }>('SELECT description, is_active FROM ppk_budget_lines WHERE id = ?', [id]);
    if (!before) throw new PpkError('NOT_FOUND', 'Baris anggaran tidak ditemukan.');
    const r = await t.run('UPDATE ppk_budget_lines SET description = ?, is_active = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?',
      [description, p.is_active ? 1 : 0, actor.name, now(), id, version]);
    if (!r.changes) throw new PpkError('CONFLICT', 'Baris anggaran sudah diubah pengguna lain. Muat ulang lalu ulangi.');
    await ppkAudit(t, actor, 'budget.update', 'ppk_budget_lines', id, { before, after: { description, is_active: p.is_active ? 1 : 0 } });
  });
  return getBudgetLine(s, actor, id);
}

/** Revisi pagu = versi baru; versi lama tetap. Peringatan bila pagu baru di bawah komitmen kontrak. */
export async function addBudgetRevision(s: PpkStore, actor: Actor, lineId: string, i: BudgetAmountInput): Promise<Warned<BudgetLine>> {
  const a = amountInput(i);
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const last = await t.get<{ version_no: number; amount: number; effective_date: string }>(
      'SELECT version_no, amount, effective_date FROM ppk_budget_versions WHERE budget_line_id = ? ORDER BY version_no DESC LIMIT 1', [lineId]);
    if (!last) throw new PpkError('NOT_FOUND', 'Baris anggaran tidak ditemukan.');
    if (a.effective_date < last.effective_date) throw new PpkError('INVALID', `Tanggal berlaku revisi tidak boleh sebelum versi terakhir (${last.effective_date}).`);
    await t.run(`INSERT INTO ppk_budget_versions (id, budget_line_id, version_no, kind, amount, effective_date, source_document, notes, created_by, created_at)
      VALUES (?,?,?,'revisi',?,?,?,?,?,?)`, [randomUUID(), lineId, last.version_no + 1, a.amount, a.effective_date, a.source_document, a.notes, actor.name, now()]);
    await ppkAudit(t, actor, 'budget.revise', 'ppk_budget_lines', lineId, { before: { version_no: last.version_no, amount: last.amount }, after: { version_no: last.version_no + 1, ...a } });
  });
  const line = await getBudgetLine(s, actor, lineId);
  const warnings = line.sisa < 0 ? [`Pagu terakhir ${formatRupiah(line.pagu_terakhir)} lebih kecil dari komitmen kontrak ${formatRupiah(line.allocated)}.`] : [];
  return { data: line, warnings };
}

export async function listBudgetVersions(s: PpkStore, actor: Actor, lineId: string): Promise<BudgetVersion[]> {
  await requirePpk(s, actor, 'read');
  return s.all<BudgetVersion>('SELECT id, version_no, kind, amount, effective_date, source_document, notes, created_by, created_at FROM ppk_budget_versions WHERE budget_line_id = ? ORDER BY version_no', [lineId]);
}
