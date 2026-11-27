import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { getDb } from '../main/database';
import * as repo from '../main/repo';
import { getMainWindow } from '../main/window';
import { renderHtmlPdf } from '../main/pdf';
import { currentActor, login, logout, needsSetup, peekActor } from '../main/numbering/session';
import { createUser, listUsers, setPin, updateUser } from '../main/numbering/users';
import { configHistory, ensureDefaultMappings, getRegister, listCategoryMap, listRegisters, setCategoryMap, setTemplateMap, updateRegister } from '../main/numbering/registers';
import { setNextSequence, suggestNext } from '../main/numbering/engine';
import { createManual, documentsReferencing, generateBatch, getRecord, issueNumber, listAvailable, listBatches, migrationReview, previewBatch, queryRecords, recordEvents, releaseNumber, resolveLegacy, searchReferenceable, summaries, updateMeta, voidNumber } from '../main/numbering/records';
import { contextForTemplate, documentNumbering, releaseDraft, selectNumber } from '../main/numbering/integration';
import { listAudit } from '../main/numbering/audit';
import { commitImport, listImports, previewImport, validateImport } from '../main/numbering/import';
import { exportRegisterXlsx, registerHtml } from '../main/numbering/export';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD');
const year = z.number().int().min(1990).max(2200);
const query = z.object({
  register_id: S.id, search: z.string().max(200).optional(), date_from: date.optional(), date_to: date.optional(), year: year.optional(),
  subject: z.string().max(200).optional(), counterparty: z.string().max(200).optional(), creator: z.string().max(120).optional(),
  status: z.enum(['available', 'assigned', 'issued', 'void']).optional(), batch_id: S.id.optional(), date: date.optional(),
  sort: z.enum(['number_date', 'seq', 'number_text', 'subject', 'counterparty', 'creator', 'status', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).optional(), page: z.number().int().min(1).max(100000).optional(), page_size: z.number().int().min(1).max(500).optional()
});
const importInput = z.object({
  register_id: S.id, sheet: z.string().max(100), header_row: z.number().int().min(1).max(1000),
  mapping: z.object({ date: z.number().int().min(0).max(59), month: z.number().int().min(0).max(59), seq: z.number().int().min(0).max(59), number: z.number().int().min(0).max(59),
    counterparty: z.number().int().min(0).max(59), subject: z.number().int().min(0).max(59), notes: z.number().int().min(0).max(59), creator: z.number().int().min(0).max(59) }).partial(),
  confirm_gaps: z.boolean(), skip_duplicates: z.boolean(), file_name: z.string().max(260)
});

const files = new Map<string, { buf: Buffer; name: string }>();
const MAX_XLSX = 25 * 1024 * 1024;
const fileOf = (token: string) => { const f = files.get(token); if (!f) throw new Error('Berkas impor sudah tidak tersedia. Pilih ulang berkas Excel.'); return f; };

export async function saveFile(buf: Buffer, name: string, ext: 'xlsx' | 'pdf') {
  const s = repo.getSettings(getDb());
  let dir = '';
  try { if (s.export_dir && fs.statSync(s.export_dir).isDirectory()) dir = s.export_dir; } catch { /* abaikan */ }
  const res = await dialog.showSaveDialog(getMainWindow()!, { defaultPath: dir ? path.join(dir, name) : name, filters: [{ name: ext === 'xlsx' ? 'Excel' : 'PDF', extensions: [ext] }] });
  if (res.canceled || !res.filePath) return { canceled: true as const };
  fs.writeFileSync(res.filePath, buf);
  return { canceled: false as const, path: res.filePath };
}
const stamp = () => new Date().toISOString().slice(0, 10);

export function registerNumberingHandlers() {
  const db = () => getDb();
  const actor = () => currentActor(db());
  try { ensureDefaultMappings(db()); } catch { /* DB belum siap pada start; dicoba lagi saat panggilan pertama */ }

  // ----- pengguna & sesi -----
  handle('numbering:whoami', S.empty, () => { ensureDefaultMappings(db()); return { actor: peekActor(db()), users: listUsers(db()).filter((u) => u.is_active), setup: needsSetup(db()) }; });
  handle('numbering:login', z.object({ user_id: S.id, pin: z.string().max(64).optional() }), ({ user_id, pin }) => login(db(), user_id, pin));
  handle('numbering:logout', S.empty, () => { logout(); return true; });
  handle('numbering:users', S.empty, () => listUsers(db()));
  handle('numbering:createUser', z.object({ name: z.string().max(80), role: z.enum(['admin', 'operator']), pin: z.string().max(64).nullish() }), (i) => createUser(db(), actor(), i));
  handle('numbering:updateUser', z.object({ id: S.id, name: z.string().max(80).optional(), role: z.enum(['admin', 'operator']).optional(), is_active: z.boolean().optional() }), ({ id, ...p }) => updateUser(db(), actor(), id, p));
  handle('numbering:setPin', z.object({ id: S.id, pin: z.string().max(64).nullable() }), ({ id, pin }) => { setPin(db(), actor(), id, pin); return true; });

  // ----- register & konfigurasi -----
  handle('numbering:summary', z.object({ year }), ({ year: y }) => summaries(db(), y));
  handle('numbering:registers', S.empty, () => listRegisters(db()));
  handle('numbering:updateRegister', z.object({
    id: S.id, reason: z.string().max(300).optional(),
    patch: z.object({ name: z.string().max(80), format: z.string().max(200), prefix: z.string().max(60), suffix: z.string().max(60), seq_length: z.number().int(), initial_sequence: z.number().int(),
      ttl_hours: z.number().int(), placeholder_keys: z.array(z.string().max(41)).max(10), is_active: z.boolean() }).partial()
  }), ({ id, patch, reason }) => updateRegister(db(), actor(), id, patch, reason ?? ''));
  handle('numbering:configHistory', z.object({ register_id: S.id }), ({ register_id }) => configHistory(db(), register_id));
  handle('numbering:next', z.object({ register_id: S.id, date }), ({ register_id, date: d }) => suggestNext(db(), register_id, d));
  handle('numbering:setNext', z.object({ register_id: S.id, date, next: z.number().int().min(1).max(10_000_000), confirm: z.boolean() }), (i) => setNextSequence(db(), actor(), i.register_id, i.date, i.next, i.confirm));
  handle('numbering:mappings', S.empty, () => ({ categories: listCategoryMap(db()), templates: db().prepare('SELECT t.id, t.name, c.name category_name, m.register_id FROM templates t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN register_template_map m ON m.template_id=t.id ORDER BY t.name').all() }));
  handle('numbering:setCategoryMap', z.object({ category_id: S.id, register_id: S.id.nullable() }), (i) => { setCategoryMap(db(), actor(), i.category_id, i.register_id); return true; });
  handle('numbering:setTemplateMap', z.object({ template_id: S.id, register_id: S.id.nullable() }), (i) => { setTemplateMap(db(), actor(), i.template_id, i.register_id); return true; });
  handle('numbering:audit', z.object({ search: z.string().max(100).optional(), action: z.string().max(60).optional() }), (f) => listAudit(db(), { ...f, limit: 300 }));

  // ----- catatan nomor -----
  handle('numbering:records', query, (q) => queryRecords(db(), q));
  handle('numbering:record', z.object({ id: S.id }), ({ id }) => ({ record: getRecord(db(), id), events: recordEvents(db(), id), referenced_by: documentsReferencing(db(), id) }));
  handle('numbering:createManual', z.object({ register_id: S.id, number_date: date, subject: z.string().max(500).optional(), counterparty: z.string().max(300).optional(), notes: z.string().max(1000).optional(), creator: z.string().max(120).optional(), seq: z.number().int().min(1).optional(), number_text: z.string().max(200).optional() }), (i) => createManual(db(), actor(), i));
  handle('numbering:updateMeta', z.object({ id: S.id, subject: z.string().max(500).optional(), counterparty: z.string().max(300).optional(), notes: z.string().max(1000).optional(), creator: z.string().max(120).optional() }), ({ id, ...p }) => updateMeta(db(), actor(), id, p));
  handle('numbering:void', z.object({ id: S.id, reason: z.string().max(300), confirm: z.boolean() }), ({ id, reason, confirm }) => voidNumber(db(), actor(), id, reason, confirm));
  handle('numbering:release', z.object({ id: S.id, reason: z.string().max(300) }), ({ id, reason }) => releaseNumber(db(), actor(), id, reason));
  handle('numbering:issue', z.object({ id: S.id }), ({ id }) => issueNumber(db(), actor(), id));
  handle('numbering:search', z.object({ register_id: S.id, q: z.string().max(100) }), ({ register_id, q }) => searchReferenceable(db(), register_id, q));

  // ----- integrasi pembuatan dokumen -----
  handle('numbering:forTemplate', z.object({ template_id: S.id }), ({ template_id }) => contextForTemplate(db(), template_id));
  handle('numbering:assign', z.object({ template_id: S.id, record_id: S.id, previous_id: S.id.nullish() }), (i) => selectNumber(db(), actor(), i.template_id, i.record_id, i.previous_id));
  handle('numbering:releaseDraft', z.object({ record_id: S.id }), (i) => releaseDraft(db(), actor(), i.record_id));
  handle('numbering:available', z.object({ register_id: S.id, search: z.string().max(100).optional(), date: date.optional(), date_from: date.optional(), include_all: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }), (q) => listAvailable(db(), q));

  // ----- bank nomor -----
  handle('numbering:previewBatch', z.object({ register_id: S.id, number_date: date, quantity: z.number().int().min(1).max(500) }), (i) => previewBatch(db(), i.register_id, i.number_date, i.quantity));
  handle('numbering:generateBatch', z.object({ register_id: S.id, number_date: date, quantity: z.number().int().min(1).max(500), expect_first: z.string().max(200).optional(), expect_last: z.string().max(200).optional(), note: z.string().max(300).optional() }), (i) => generateBatch(db(), actor(), i));
  handle('numbering:batches', z.object({ register_id: S.id }), ({ register_id }) => listBatches(db(), register_id));
  handle('numbering:migrationReview', S.empty, () => migrationReview(db(), actor()));
  handle('numbering:resolveLegacy', z.object({ ids: z.array(S.id).min(1).max(1000), action: z.enum(['release', 'void']), reason: z.string().max(300) }), (i) => resolveLegacy(db(), actor(), i.ids, i.action, i.reason));
  handle('numbering:documentInfo', z.object({ document_id: S.id }), ({ document_id }) => documentNumbering(db(), document_id));

  // ----- impor/ekspor Excel -----
  handle('numbering:importPick', S.empty, async () => {
    const res = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > MAX_XLSX) throw new Error('Berkas terlalu besar (maks. 25 MB).');
    const buf = fs.readFileSync(file);
    const preview = previewImport(buf);
    const token = randomUUID();
    files.set(token, { buf, name: path.basename(file) });
    while (files.size > 3) files.delete(files.keys().next().value as string);
    return { canceled: false as const, token, file_name: path.basename(file), preview };
  });
  handle('numbering:importPreview', z.object({ token: S.id, sheet: z.string().max(100).optional(), header_row: z.number().int().min(1).max(1000).optional() }), (i) => previewImport(fileOf(i.token).buf, i.sheet, i.header_row));
  handle('numbering:importValidate', z.object({ token: S.id, input: importInput }), ({ token, input }) => validateImport(db(), fileOf(token).buf, input));
  handle('numbering:importCommit', z.object({ token: S.id, input: importInput }), ({ token, input }) => {
    const f = fileOf(token);
    const r = commitImport(db(), actor(), f.buf, { ...input, file_name: f.name });
    files.delete(token);
    return r;
  });
  handle('numbering:imports', z.object({ register_id: S.id.optional() }), ({ register_id }) => listImports(db(), register_id));
  handle('numbering:exportXlsx', query, async (q) => saveFile(exportRegisterXlsx(db(), q), `register-${getRegister(db(), q.register_id).code.toLowerCase()}-${stamp()}.xlsx`, 'xlsx'));
  handle('numbering:exportPdf', query, async (q) => saveFile(await renderHtmlPdf(registerHtml(db(), q)), `register-${getRegister(db(), q.register_id).code.toLowerCase()}-${stamp()}.pdf`, 'pdf'));
}
