import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { saveFile } from './numbering';
import { getDb } from '../main/database';
import { readXlsx, writeXlsx, type Sheet } from '../main/numbering/xlsx';
import { getMainWindow } from '../main/window';
import { runPpkImport } from '../main/ppk/import';
import { ppkReport, reportSheets } from '../main/ppk/reports';
import { addSp2d, sp2dReport, voidSp2d } from '../main/ppk/sp2d';
import { relatedDocuments } from '../main/ppk/documents';
import { sqliteStore } from '../main/ppk/store';
import { peekPpkActor, ppkActor, ppkStore } from '../main/ppk/server';
import { registerPpkServerHandlers } from './ppkServer';
import { listPpkUsers, ppkAccess, setPpkRole } from '../main/ppk/access';
import { listMaster, listTaxRates, saveMaster } from '../main/ppk/master';
import { VENDOR_EXPORT_HEADER, createVendor, getVendor, listVendors, setVendorStatus, similarVendors, updateVendor, vendorExportRow } from '../main/ppk/vendors';
import { addBudgetRevision, createBudgetLine, getBudgetPlan, listBudgetLines, listBudgetVersions, setBudgetPlan, updateBudgetLine } from '../main/ppk/budget';
import { addAddendum, createContract, getContract, listContracts, setAllocations, setContractStatus, setSchedule, setYearValues, updateContract, voidAddendum } from '../main/ppk/contracts';
import { BUDGET_KIND_LABEL, type BudgetKind } from '@shared/ppk/budget';
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL, type ContractStatus, type ContractType } from '@shared/ppk/contracts';
import { addPayment, getBill, listBills, saveBill, setBillStatus, voidPayment } from '../main/ppk/bills';
import { BILL_STATUS_LABEL, PAYMENT_CHANNELS, type BillStatus } from '@shared/ppk/bills';
import { MASTER_KEYS, type MasterKey } from '@shared/ppk/master';
import { PPK_ROLES } from '@shared/ppk/access';
import { VENDOR_STATUS } from '@shared/ppk/vendors';

const text = (max: number) => z.string().max(max);
const vendorInput = z.object({
  name: text(200), npwp: text(30), nib: text(30), address: text(500), contact_person: text(120), email: text(120), phone: text(40),
  bank_name: text(120), account_number: text(40), account_holder: text(200), service_category_id: S.id.nullable(), notes: text(2000)
});
const day = z.string().max(10);
const money = z.number().int();
const keys = <T extends string>(o: Record<T, string>) => z.enum(Object.keys(o) as [T, ...T[]]);
const budgetAmount = z.object({ amount: money, effective_date: day, source_document: text(300), notes: text(1000) });
const budgetLine = z.object({
  fiscal_year_id: S.id, unit_id: S.id, program_id: S.id, activity_id: S.id, budget_account_id: S.id, output_detail: text(300), funding_source_id: S.id,
  kind: keys<BudgetKind>(BUDGET_KIND_LABEL), description: text(1000)
});
const contractStatus = keys<ContractStatus>(CONTRACT_STATUS_LABEL);
const contractInput = z.object({
  fiscal_year_id: S.id, unit_id: S.id, vendor_id: S.id, program_id: S.id, activity_id: S.id, service_package_id: S.id.nullable(),
  contract_type: keys<ContractType>(CONTRACT_TYPE_LABEL), contract_number: text(200), vendor_contract_number: text(200), contract_date: day, description: text(2000),
  initial_value: money, start_date: day, end_date: day, is_multi_year: z.boolean(), term_start: day.nullable(), term_end: day.nullable(), prior_year_paid: money, notes: text(2000)
});
const addendumInput = z.object({
  addendum_number: text(200), addendum_date: day, value_change: money, period_start: day.nullable(), period_end: day.nullable(), new_end_date: day.nullable(), description: text(2000)
});
const billInput = z.object({
  contract_id: S.id, bill_number: text(200), bill_date: day, received_date: day.nullable(), service_month: z.string().max(7), period_start: day.nullable(), period_end: day.nullable(),
  amount: money, pass_through: money, faktur_code: z.enum(['02', '04']).nullable(), faktur_number: text(100), ppn: money.nullable(), pph23: money.nullable(),
  deduction: money, deduction_reason: text(500), fx_rate: text(40), fx_amount: text(40), ba_number: text(200), ba_date: day.nullable(), official_id: S.id.nullable(),
  notes: text(2000), funding: z.array(z.object({ budget_line_id: S.id, amount: money })).max(50)
});
const billStatus = keys<BillStatus>(BILL_STATUS_LABEL);
const masterKey = z.enum(MASTER_KEYS as [MasterKey, ...MasterKey[]]);

/** Semua channel ppk:* memeriksa izin di lapisan domain (requirePpk), bukan hanya menyembunyikan menu. */
export function registerPpkHandlers() {
  const st = () => ppkStore(getDb());
  const actor = () => ppkActor(getDb());
  registerPpkServerHandlers();

  handle('ppk:access', S.empty, async () => { const a = peekPpkActor(getDb()); return a ? ppkAccess(st(), a) : null; });
  handle('ppk:users', S.empty, () => listPpkUsers(st(), actor()));
  handle('ppk:setRole', z.object({ user_id: S.id, role: z.enum(PPK_ROLES).nullable() }), async ({ user_id, role }) => { await setPpkRole(st(), actor(), user_id, role); return true; });

  handle('ppk:master:list', z.object({ key: masterKey }), ({ key }) => listMaster(st(), actor(), key));
  handle('ppk:master:save', z.object({ key: masterKey, values: z.record(z.union([z.string().max(300), z.number(), z.boolean(), z.null()])) }),
    ({ key, values }) => saveMaster(st(), actor(), key, values as Record<string, unknown> & { id?: string }));
  handle('ppk:taxRates', S.empty, () => listTaxRates(st(), actor()));

  handle('ppk:vendors:list', z.object({ search: text(200).optional(), status: z.enum([...VENDOR_STATUS, 'semua']).optional(), service_category_id: S.id.optional() }),
    (f) => listVendors(st(), actor(), f));
  handle('ppk:vendors:get', z.object({ id: S.id }), ({ id }) => getVendor(st(), actor(), id));
  handle('ppk:vendors:similar', z.object({ name: text(200), npwp: text(30), except_id: S.id.optional() }), ({ name, npwp, except_id }) => similarVendors(st(), actor(), name, npwp, except_id));
  handle('ppk:vendors:create', vendorInput, (i) => createVendor(st(), actor(), i));
  handle('ppk:vendors:update', z.object({ id: S.id, version: z.number().int().min(1), values: vendorInput }), ({ id, version, values }) => updateVendor(st(), actor(), id, version, values));
  handle('ppk:vendors:setStatus', z.object({ id: S.id, status: z.enum(VENDOR_STATUS), reason: text(500) }), ({ id, status, reason }) => setVendorStatus(st(), actor(), id, status, reason));
  handle('ppk:vendors:export', z.object({ status: z.enum([...VENDOR_STATUS, 'semua']).optional() }), async ({ status }) => {
    const rows = await listVendors(st(), actor(), { status: status ?? 'semua' });
    const buf = writeXlsx([{ name: 'Penyedia', header: VENDOR_EXPORT_HEADER, rows: rows.map(vendorExportRow), widths: [36, 20, 18, 40, 22, 26, 16, 18, 20, 28, 20, 12, 30] }]);
    return saveFile(buf, `Database-Penyedia-${new Date().toISOString().slice(0, 10)}.xlsx`, 'xlsx');
  });

  handle('ppk:budget:list', z.object({ fiscal_year_id: S.id.optional(), include_inactive: z.boolean().optional() }), (f) => listBudgetLines(st(), actor(), f));
  handle('ppk:budget:create', z.object({ line: budgetLine, pagu: budgetAmount }), ({ line, pagu }) => createBudgetLine(st(), actor(), line, pagu));
  handle('ppk:budget:update', z.object({ id: S.id, version: z.number().int().min(1), description: text(1000), is_active: z.boolean() }),
    ({ id, version, ...p }) => updateBudgetLine(st(), actor(), id, version, p));
  handle('ppk:budget:revise', z.object({ id: S.id, revision: budgetAmount }), ({ id, revision }) => addBudgetRevision(st(), actor(), id, revision));
  handle('ppk:budget:versions', z.object({ id: S.id }), ({ id }) => listBudgetVersions(st(), actor(), id));

  handle('ppk:contracts:list', z.object({ fiscal_year_id: S.id.optional(), status: z.union([contractStatus, z.literal('semua')]).optional(), vendor_id: S.id.optional(), search: text(200).optional() }),
    (f) => listContracts(st(), actor(), f));
  handle('ppk:contracts:get', z.object({ id: S.id }), ({ id }) => getContract(st(), actor(), id));
  handle('ppk:contracts:create', contractInput, (i) => createContract(st(), actor(), i));
  handle('ppk:contracts:update', z.object({ id: S.id, version: z.number().int().min(1), values: contractInput }), ({ id, version, values }) => updateContract(st(), actor(), id, version, values));
  handle('ppk:contracts:setStatus', z.object({ id: S.id, status: contractStatus, reason: text(500) }), ({ id, status, reason }) => setContractStatus(st(), actor(), id, status, reason));
  handle('ppk:contracts:addAddendum', z.object({ id: S.id, addendum: addendumInput }), ({ id, addendum }) => addAddendum(st(), actor(), id, addendum));
  handle('ppk:contracts:voidAddendum', z.object({ id: S.id, reason: text(500) }), ({ id, reason }) => voidAddendum(st(), actor(), id, reason));
  handle('ppk:contracts:setSchedule', z.object({ id: S.id, rows: z.array(z.object({ month: z.string().max(7), planned_amount: money })).max(600) }),
    ({ id, rows }) => setSchedule(st(), actor(), id, rows));
  handle('ppk:contracts:setAllocations', z.object({ id: S.id, rows: z.array(z.object({ budget_line_id: S.id, amount: money })).max(200) }),
    ({ id, rows }) => setAllocations(st(), actor(), id, rows));

  handle('ppk:bills:list', z.object({ fiscal_year_id: S.id.optional(), contract_id: S.id.optional(), status: z.union([billStatus, z.literal('semua')]).optional(), search: text(200).optional() }),
    (f) => listBills(st(), actor(), f));
  handle('ppk:bills:get', z.object({ id: S.id }), ({ id }) => getBill(st(), actor(), id));
  handle('ppk:bills:save', z.object({ id: S.id.nullable(), version: z.number().int().min(1).nullable(), values: billInput }), ({ id, version, values }) => saveBill(st(), actor(), id, version, values));
  handle('ppk:bills:setStatus', z.object({ id: S.id, status: z.enum(['diverifikasi', 'dibatalkan']), reason: text(500) }), ({ id, status, reason }) => setBillStatus(st(), actor(), id, status, reason));
  handle('ppk:bills:addPayment', z.object({ bill_funding_id: S.id, payment: z.object({ channel: z.enum(PAYMENT_CHANNELS), reference_number: text(100), payment_date: day, amount: money, notes: text(1000) }) }),
    ({ bill_funding_id, payment }) => addPayment(st(), actor(), bill_funding_id, payment));
  handle('ppk:bills:voidPayment', z.object({ id: S.id, reason: text(500) }), ({ id, reason }) => voidPayment(st(), actor(), id, reason));

  // Impor spreadsheet PPK lama: pilih berkas → pratinjau (commit=false, semua dibatalkan) → simpan.
  handle('ppk:import:pick', S.empty, async () => {
    await ppkAccess(st(), actor());
    const res = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > 25 * 1024 * 1024) throw new Error('Berkas terlalu besar (maks. 25 MB).');
    const sheets = readXlsx(fs.readFileSync(file));
    const token = randomUUID();
    importFiles.set(token, { sheets, name: path.basename(file) });
    while (importFiles.size > 3) importFiles.delete(importFiles.keys().next().value as string);
    return { canceled: false as const, token, file_name: path.basename(file) };
  });
  handle('ppk:import:run', z.object({ token: S.id, fiscal_year_id: S.id, program_id: S.id, commit: z.boolean() }), async ({ token, fiscal_year_id, program_id, commit }) => {
    const f = importFiles.get(token);
    if (!f) throw new Error('Berkas impor sudah tidak tersedia. Pilih ulang berkas Excel.');
    const r = await runPpkImport(st(), actor(), f.sheets, { fiscal_year_id, program_id, file_name: f.name }, commit);
    if (commit) importFiles.delete(token);
    return r;
  });

  const reportArgs = z.object({ fiscal_year_id: S.id, cutoff: z.string().regex(/^\d{4}-\d{2}$/), extend: z.boolean() });
  handle('ppk:reports:get', reportArgs, (a) => ppkReport(st(), actor(), a.fiscal_year_id, a.cutoff, a.extend));
  handle('ppk:reports:export', reportArgs, async (a) => {
    const r = await ppkReport(st(), actor(), a.fiscal_year_id, a.cutoff, a.extend);
    return saveFile(writeXlsx(reportSheets(r)), `Prognosis-PPK-${r.year}-sd-${r.cutoff}.xlsx`, 'xlsx');
  });

  handle('ppk:budget:plan', z.object({ id: S.id }), ({ id }) => getBudgetPlan(st(), actor(), id));
  handle('ppk:budget:setPlan', z.object({ id: S.id, rows: z.array(z.object({ month: z.string().max(7), amount: money })).max(12) }), ({ id, rows }) => setBudgetPlan(st(), actor(), id, rows));
  handle('ppk:contracts:setYearValues', z.object({ id: S.id, rows: z.array(z.object({ year: z.number().int(), amount: money })).max(60) }), ({ id, rows }) => setYearValues(st(), actor(), id, rows));
  handle('ppk:sp2d:report', z.object({ fiscal_year_id: S.id }), ({ fiscal_year_id }) => sp2dReport(st(), actor(), fiscal_year_id));
  handle('ppk:sp2d:add', z.object({ fiscal_year_id: S.id, record: z.object({ sp2d_number: text(100), sp2d_date: day, amount: money, notes: text(1000) }) }),
    ({ fiscal_year_id, record }) => addSp2d(st(), actor(), fiscal_year_id, record));
  handle('ppk:documents:related', z.object({ numbers: z.array(text(300)).max(20) }), ({ numbers }) => relatedDocuments(st(), sqliteStore(getDb()), actor(), numbers));
  handle('ppk:sp2d:void', z.object({ id: S.id, reason: text(500) }), ({ id, reason }) => voidSp2d(st(), actor(), id, reason));
}

const importFiles = new Map<string, { sheets: Sheet[]; name: string }>();
