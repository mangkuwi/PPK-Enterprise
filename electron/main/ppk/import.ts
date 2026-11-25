import type { Actor } from '@shared/numbering';
import { formatRupiah } from '@shared/ppk/money';
import { vendorNameKey } from '@shared/ppk/vendors';
import { fundingOrder, splitByRemaining } from '@shared/ppk/bills';
import { parsePpkWorkbook, type ImportIssue, type ImportSheet, type ParsedBill, type ParsedChain, type ImportChainResult, type PpkImportReport } from '@shared/ppk/import';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { saveMaster } from './master';
import { createVendor } from './vendors';
import { createBudgetLine, getBudgetLine } from './budget';
import { addAddendum, createContract, setContractStatus } from './contracts';
import { saveBill, setBillStatus } from './bills';

export interface ImportOptions { fiscal_year_id: string; program_id: string; file_name: string }
class DryRun extends Error {}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Jalankan impor lewat fungsi domain yang sama dengan input manual (validasi, pajak, audit tetap berlaku).
 * commit=false: semua dijalankan lalu dibatalkan, sehingga pratinjau = hasil sebenarnya. Data yang sudah ada tidak ditimpa:
 * kontrak dengan nomor sama dilewati, baris anggaran dan penyedia yang sama dipakai ulang.
 */
export async function runPpkImport(s: PpkStore, actor: Actor, sheets: ImportSheet[], o: ImportOptions, commit: boolean): Promise<PpkImportReport> {
  await requirePpk(s, actor, 'master');
  const fy = await s.get<{ year: number }>('SELECT year FROM ppk_fiscal_years WHERE id = ?', [o.fiscal_year_id]);
  if (!fy) throw new PpkError('INVALID', 'Tahun anggaran tidak ditemukan.');
  if (!(await s.get('SELECT 1 FROM ppk_programs WHERE id = ?', [o.program_id]))) throw new PpkError('INVALID', 'Program tidak ditemukan.');
  const p = parsePpkWorkbook(sheets, fy.year);
  const r: PpkImportReport = {
    committed: commit, chains: [], issues: [...p.issues], sheets: p.sheets,
    counts: { units: 0, activities: 0, accounts: 0, budget_lines: 0, budget_lines_existing: 0, vendors: 0, vendors_existing: 0, contracts: 0, contracts_existing: 0,
      addendums: 0, bills_verified: 0, bills_draft: 0, bills_failed: 0, billed: 0 }
  };
  const doc = `Impor ${o.file_name}`;
  try {
    await s.tx(async (t) => {
      const cache = new Map<string, string>();
      const once = async (key: string, find: () => Promise<string | undefined>, make: () => Promise<string>, counter: keyof PpkImportReport['counts']) => {
        if (cache.has(key)) return cache.get(key)!;
        let id = await find();
        if (!id) { id = await make(); r.counts[counter]++; }
        cache.set(key, id);
        return id;
      };
      const unitId = (label: string | null) => {
        const code = (label || 'PPK').replace(/\s+/g, '').toUpperCase();
        return once(`u:${code}`, async () => (await t.get<{ id: string }>("SELECT id FROM ppk_units WHERE upper(replace(code, ' ', '')) = ?", [code]))?.id,
          async () => String((await saveMaster(t, actor, 'units', { code, name: label || code, is_active: true })).id), 'units');
      };
      const activityId = (mak: string) => {
        const code = mak.split('.')[0];
        return once(`a:${code}`, async () => (await t.get<{ id: string }>('SELECT id FROM ppk_activities WHERE program_id = ? AND code = ?', [o.program_id, code]))?.id,
          async () => String((await saveMaster(t, actor, 'activities', { program_id: o.program_id, code, name: `Kegiatan ${code}`, is_active: true })).id), 'activities');
      };
      const accountId = (mak: string, name: string) => once(`m:${mak}`, async () => (await t.get<{ id: string }>('SELECT id FROM ppk_budget_accounts WHERE code = ?', [mak]))?.id,
        async () => String((await saveMaster(t, actor, 'budget_accounts', { code: mak, name: (name || mak).slice(0, 300), is_active: true })).id), 'accounts');
      const sourceId = async (code: string) => (await t.get<{ id: string }>('SELECT id FROM ppk_funding_sources WHERE upper(code) = ?', [code]))?.id;

      // 1. Baris anggaran dari ringkasan.
      const lines: Array<{ id: string; mak: string; source: string; detail: string; kind: string }> = [];
      for (const b of p.budgetLines) {
        const issue = (level: ImportIssue['level'], message: string) => r.issues.push({ sheet: b.sheet, row: b.row, level, message });
        const src = await sourceId(b.source);
        if (!src) { issue('galat', `Sumber dana "${b.source}" tidak ada di master. Tambahkan di Pengaturan PPK.`); continue; }
        try {
          await t.tx(async () => {
            const acc = await accountId(b.mak, b.output_detail); const act = await activityId(b.mak); const unit = await unitId(b.unit);
            const ex = await t.get<{ id: string }>('SELECT id FROM ppk_budget_lines WHERE fiscal_year_id = ? AND budget_account_id = ? AND output_detail = ? AND funding_source_id = ? AND kind = ?',
              [o.fiscal_year_id, acc, b.output_detail, src, b.kind]);
            let id = ex?.id;
            if (id) {
              r.counts.budget_lines_existing++;
              const cur = await getBudgetLine(t, actor, id);
              if (cur.pagu_terakhir !== b.amount) issue('peringatan', `Baris anggaran ${b.mak} (${b.source}) sudah ada dengan pagu ${formatRupiah(cur.pagu_terakhir)}; nilai di berkas ${formatRupiah(b.amount)} tidak diterapkan. Catat revisi bila perlu.`);
            } else {
              id = (await createBudgetLine(t, actor, { fiscal_year_id: o.fiscal_year_id, unit_id: unit, program_id: o.program_id, activity_id: act, budget_account_id: acc,
                output_detail: b.output_detail, funding_source_id: src, kind: b.kind, description: doc },
                { amount: b.amount, effective_date: `${fy.year}-01-01`, source_document: `${doc} · ${b.sheet} baris ${b.row}`, notes: '' })).id;
              r.counts.budget_lines++;
            }
            lines.push({ id, mak: b.mak, source: b.source, detail: b.output_detail, kind: b.kind });
          });
        } catch (e) { issue('galat', `Baris anggaran ${b.mak} (${b.source}) gagal: ${errText(e)}`); }
      }

      // 2. Kontrak per kelompok baris: kontrak induk + PKS lanjutan sebagai addendum + tagihan.
      for (const ch of p.chains) {
        const res: ImportChainResult = { sheet: ch.sheet, row: ch.row, vendor: ch.vendor, contract_number: ch.contract.number, status: 'baru', bills: 0, billed: 0 };
        r.chains.push(res);
        if (await t.get('SELECT 1 FROM ppk_contracts WHERE contract_number = ?', [ch.contract.number])) {
          res.status = 'sudah ada'; r.counts.contracts_existing++;
          r.issues.push({ sheet: ch.sheet, row: ch.row, level: 'info', message: `Kontrak ${ch.contract.number} sudah ada; kelompok ini dilewati (data lama tidak ditimpa).` });
          continue;
        }
        let contractId = '';
        try {
          await t.tx(async () => {
            const vendor = await once(`v:${vendorNameKey(ch.vendor)}`,
              async () => { const v = (await t.get<{ id: string }>('SELECT id FROM ppk_vendors WHERE name_key = ?', [vendorNameKey(ch.vendor)]))?.id; if (v) r.counts.vendors_existing++; return v; },
              async () => (await createVendor(t, actor, { name: ch.vendor, npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '', bank_name: '', account_number: '',
                account_holder: '', service_category_id: null, notes: doc })).id, 'vendors');
            const c = await createContract(t, actor, { fiscal_year_id: o.fiscal_year_id, unit_id: await unitId(ch.unit), vendor_id: vendor, program_id: o.program_id,
              activity_id: await activityId(ch.bills[0]?.mak || lines[0]?.mak || '0'), service_package_id: null, contract_type: ch.kpbu ? 'kpbu' : 'biasa',
              contract_number: ch.contract.number, vendor_contract_number: '', contract_date: ch.contract.date ?? ch.contract.start, description: ch.description.slice(0, 2000),
              initial_value: ch.contract.value, start_date: ch.contract.start, end_date: ch.contract.end, is_multi_year: false, term_start: null, term_end: null,
              prior_year_paid: 0, notes: `${doc} · ${ch.sheet} baris ${ch.row}` });
            contractId = c.id;
            await setContractStatus(t, actor, c.id, 'aktif', '');
            let end = ch.contract.end;
            for (const a of ch.addendums) {
              const newEnd = a.end && a.end > end ? a.end : null;
              await addAddendum(t, actor, c.id, { addendum_number: a.number, addendum_date: a.start ?? ch.contract.start, value_change: a.value, period_start: a.start, period_end: a.end,
                new_end_date: newEnd, description: `PKS lanjutan (${doc} · baris ${a.row})` });
              if (newEnd) end = newEnd;
              r.counts.addendums++;
            }
          });
          r.counts.contracts++;
        } catch (e) {
          res.status = 'galat';
          r.issues.push({ sheet: ch.sheet, row: ch.row, level: 'galat', message: `Kontrak ${ch.contract.number} gagal diimpor: ${errText(e)}` });
          continue;
        }
        for (const b of ch.bills) {
          try {
            await t.tx(async () => {
              const funding = await fundingFor(t, actor, lines, ch, b);
              const saved = await saveBill(t, actor, null, null, {
                contract_id: contractId, bill_number: b.bill_number.slice(0, 200), bill_date: b.bill_date, received_date: null, service_month: b.service_month,
                period_start: b.period_start, period_end: b.period_end, amount: b.amount, pass_through: b.pass_through, faktur_code: b.faktur, faktur_number: '',
                ppn: b.faktur ? b.ppn : null, pph23: b.faktur ? b.pph23 : null, deduction: b.deduction, deduction_reason: b.deduction ? 'Denda (impor)' : '',
                fx_rate: '', fx_amount: '', ba_number: b.ba_number.slice(0, 200), ba_date: b.ba_date, official_id: null,
                notes: [`${doc} · ${ch.sheet} baris ${b.row} · periode ${b.periode}`, b.spp && `SPP ${b.spp}`].filter(Boolean).join(' · '), funding
              });
              for (const w of saved.warnings) r.issues.push({ sheet: ch.sheet, row: b.row, level: 'info', message: w });
              if (b.complete) { await setBillStatus(t, actor, saved.data.id, 'diverifikasi', ''); r.counts.bills_verified++; } else r.counts.bills_draft++;
              res.bills++; res.billed += b.amount + b.pass_through; r.counts.billed += b.amount + b.pass_through;
            });
          } catch (e) {
            r.counts.bills_failed++;
            r.issues.push({ sheet: ch.sheet, row: b.row, level: 'galat', message: `Tagihan ${b.periode} (${b.bill_number}) gagal: ${errText(e)}` });
          }
        }
      }
      await ppkAudit(t, actor, 'import.excel', 'ppk_import', o.file_name, { file: o.file_name, counts: r.counts, galat: r.issues.filter((i) => i.level === 'galat').length });
      if (!commit) throw new DryRun();
    });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return r;
}

/** Baris anggaran untuk satu tagihan: MAK + sumber dana sama; bila lembar terhubung ke satu rincian output, pakai itu; dibagi sesuai sisa pagu. */
async function fundingFor(t: PpkStore, actor: Actor, lines: Array<{ id: string; mak: string; source: string; detail: string; kind: string }>, ch: ParsedChain, b: ParsedBill) {
  let c = lines.filter((l) => l.mak === b.mak && l.source === b.source);
  if (!c.length) throw new PpkError('INVALID', `Tidak ada baris anggaran untuk MAK ${b.mak} sumber ${b.source}. Periksa lembar ringkasan.`);
  const pass = c.filter((l) => /pass/i.test(l.detail));
  if (b.pass_row && pass.length) c = pass;
  else {
    if (pass.length < c.length) c = c.filter((l) => !/pass/i.test(l.detail));
    const own = c.filter((l) => l.detail === ch.output_detail);
    if (own.length) c = own;
  }
  const withRest = await Promise.all(c.map(async (l) => { const x = await getBudgetLine(t, actor, l.id); return { id: l.id, kind: l.kind, source_code: l.source, remaining: x.sisa_realisasi }; }));
  return splitByRemaining(b.amount + b.pass_through, withRest.sort(fundingOrder));
}
