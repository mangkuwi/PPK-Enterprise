import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { getDb } from '../main/database';
import * as svc from '../main/importer-service';
import * as repo from '../main/repo';
import { docxToPdf, findSoffice } from '../main/soffice';
import { compareLayout, extractMetrics } from '../main/pdf-metrics';
import { getMainWindow } from '../main/window';
import { buildExportName } from '@shared/filename';
import { AI_DRAFT_SYSTEM, buildDraftPrompt, parseDraft } from '@shared/ai-guard';
import { aiComplete } from './settings';
import { currentActor } from '../main/numbering/session';
import { applyToValues, bindDocument, contextForTemplate, forcedValuesForDocument } from '../main/numbering/integration';
import { recordForDocument } from '../main/numbering/records';

const fieldType = z.enum(['text', 'textarea', 'date', 'select', 'richtext', 'number']);
const status = z.enum(['auto', 'confirm', 'confirmed', 'manual', 'rejected']);
const mapping = z.object({
  id: S.id, part: z.string().max(120), para_index: z.number().int().min(0), start: z.number().int().min(0), end: z.number().int().min(0),
  source_text: z.string().max(5000), placeholder_name: z.string().regex(/^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)?$/).max(60), label: z.string().max(120),
  field_type: fieldType, default_value: z.string().max(5000), required: z.boolean(), options: z.array(z.string().max(200)).max(50),
  confidence: z.number().min(0).max(1), status, reason: z.string().max(400)
});
const group = z.object({
  id: S.id, name: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(40), label: z.string().max(120), part: z.string().max(120), tbl: z.number().int(), header_tr: z.number().int(),
  rows: z.array(z.number().int()).max(500),
  columns: z.array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(40), label: z.string().max(120), tc: z.number().int(), type: fieldType, auto_number: z.boolean().optional() })).max(30),
  default_rows: z.array(z.record(z.string().max(2000))).max(500), confidence: z.number(), status, reason: z.string().max(400)
});
const saveInput = z.object({ id: S.id, mappings: z.array(mapping).max(3000), groups: z.array(group).max(30), name: z.string().min(1).max(200), description: z.string().max(1000), category_id: S.id.nullable(), protected_keys: z.array(z.string().max(200)).max(5000),
  variant_edits: z.array(z.object({ group_no: z.number().int().min(1).max(50), status: z.literal('confirmed').optional(), labels: z.record(z.string().max(120)).optional() })).max(50).optional() });
const MAX = 50 * 1024 * 1024;

async function saveBuffer(buf: Buffer, defaultName: string, ext: 'docx' | 'pdf') {
  const s = repo.getSettings(getDb());
  let dir = '';
  try { if (s.export_dir && fs.statSync(s.export_dir).isDirectory()) dir = s.export_dir; } catch { /* abaikan */ }
  const res = await dialog.showSaveDialog(getMainWindow()!, { defaultPath: dir ? path.join(dir, defaultName) : defaultName, filters: [{ name: ext === 'docx' ? 'Microsoft Word' : 'PDF', extensions: [ext] }] });
  if (res.canceled || !res.filePath) return { canceled: true as const };
  const target = res.filePath.toLowerCase().endsWith(`.${ext}`) ? res.filePath : `${res.filePath}.${ext}`;
  fs.writeFileSync(target, buf);
  return { canceled: false as const, path: target };
}

export function registerImporterHandlers() {
  handle('importer:upload', S.empty, async () => {
    const res = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openFile'], filters: [{ name: 'Dokumen Word', extensions: ['docx', 'dotx', 'doc'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > MAX) throw new Error('Berkas terlalu besar (maks 50 MB).');
    if (/\.doc$/i.test(file)) throw new Error('Format .doc lama belum dapat dibaca langsung. Buka di Word lalu "Simpan Sebagai" .docx, kemudian unggah ulang.');
    const id = svc.importDocx(getDb(), fs.readFileSync(file), path.basename(file), file);
    return { canceled: false as const, id };
  });
  handle('importer:list', S.empty, () => svc.listImports(getDb()));
  handle('importer:review', z.object({ id: S.id }), ({ id }) => svc.getReview(getDb(), id));
  handle('importer:saveReview', saveInput, (i) => { svc.saveReview(getDb(), i as any); return true; });
  handle('importer:reanalyze', z.object({ id: S.id }), ({ id }) => { svc.reanalyze(getDb(), id); return svc.getReview(getDb(), id); });
  handle('importer:saveTemplate', saveInput, (i) => { svc.saveReview(getDb(), i as any); return { templateId: svc.saveAsTemplate(getDb(), i.id) }; });
  handle('importer:restoreVersion', z.object({ id: S.id, versionId: S.id }), ({ id, versionId }) => ({ templateId: svc.restoreVersion(getDb(), id, versionId) }));
  handle('importer:compare', z.object({ id: S.id }), ({ id }) => svc.compare(getDb(), id));
  handle('importer:restoreSource', z.object({ id: S.id }), ({ id }) => { svc.restoreSource(getDb(), id); return svc.getReview(getDb(), id); });
  handle('importer:delete', z.object({ id: S.id, withTemplate: z.boolean() }), ({ id, withTemplate }) => { svc.deleteImport(getDb(), id, withTemplate); return true; });
  handle('importer:saveOriginal', z.object({ id: S.id }), async ({ id }) => {
    const o = svc.originalBuffer(getDb(), id);
    return saveBuffer(o.buf, o.name, 'docx');
  });
  handle('importer:docxInfo', z.object({ templateId: S.id }), ({ templateId }) => svc.getDocxTemplateInfo(getDb(), templateId));
  handle('importer:generate', z.object({
    templateId: S.id, title: z.string().max(300), values: z.record(z.string().max(100_000)), categoryId: S.id.nullable(), templateName: z.string().max(200),
    docDate: z.string().max(10), letterNumber: z.string().max(200), recipient: z.string().max(500), subject: z.string().max(500),
    number_record_id: S.id.nullish(), number_refs: S.numberRefs.optional()
  }), (i) => {
    const db = getDb();
    return db.transaction(() => {
      let { values, docDate, letterNumber } = i;
      const refs = i.number_refs ?? [];
      if (i.number_record_id) {
        // Nomor & tanggal resmi dipaksa dari register; isian dari formulir/AI untuk kunci tersebut diabaikan.
        const ap = applyToValues(db, i.templateId, i.number_record_id, values, refs);
        values = ap.values; docDate = ap.record.number_date; letterNumber = ap.record.number_text;
      } else if (contextForTemplate(db, i.templateId).register) {
        throw new Error('Template ini terhubung ke register penomoran, tetapi nomor belum dipilih. Pilih nomor yang tersedia dari Bank Nomor.');
      }
      const doc = svc.createDocxDocument(db, { template_id: i.templateId, title: i.title, values, category_id: i.categoryId, template_name: i.templateName, doc_date: docDate, letter_number: letterNumber, recipient: i.recipient, subject: i.subject });
      if (i.number_record_id) bindDocument(db, currentActor(db), { record_id: i.number_record_id, document_id: doc.id, values, refs, template_id: i.templateId });
      return repo.getDocument(db, doc.id);
    })();
  });
  handle('importer:regenerate', z.object({ id: S.id, values: z.record(z.string().max(100_000)) }), ({ id, values }) => {
    const db = getDb();
    const tid = (db.prepare('SELECT template_id t FROM documents WHERE id=?').get(id) as { t: string | null } | undefined)?.t;
    // Dokumen bernomor: nomor, tanggal, dan rujukan tertaut dipaksa ulang sehingga tidak dapat berubah lewat formulir.
    const forced = tid && recordForDocument(db, id) ? forcedValuesForDocument(db, id, tid, values) : values;
    return svc.regenerateDocxDocument(db, id, forced);
  });
  handle('importer:exportDocx', z.object({ id: S.id }), async ({ id }) => {
    const d = svc.getDocumentDocx(getDb(), id);
    svc.verifyForExport(getDb(), id);
    const doc = repo.getDocument(getDb(), id)!;
    return { ...(await saveBuffer(d.buf as Buffer, buildExportName({ code: doc.category_code, title: doc.title, date: doc.doc_date, ext: 'docx' }), 'docx')), state: d.state };
  });
  handle('importer:exportPdf', z.object({ id: S.id }), async ({ id }) => {
    const d = svc.getDocumentDocx(getDb(), id);
    svc.verifyForExport(getDb(), id);
    if (d.state === 'edited') throw new Error('Dokumen telah disunting di editor; gunakan Ekspor PDF biasa atau "Perbarui dari Formulir" dahulu.');
    if (!findSoffice()) throw new Error('PDF yang setia pada tata letak Word membutuhkan LibreOffice. Instal LibreOffice, atau ekspor DOCX lalu "Simpan sebagai PDF" dari Word.');
    const doc = repo.getDocument(getDb(), id)!;
    return saveBuffer(await docxToPdf(d.buf as Buffer), buildExportName({ code: doc.category_code, title: doc.title, date: doc.doc_date, ext: 'pdf' }), 'pdf');
  });
  handle('importer:validation', z.object({ id: S.id }), ({ id }) => svc.getValidation(getDb(), id));
  handle('importer:visualCompare', z.object({ id: S.id }), async ({ id }) => {
    if (!findSoffice()) throw new Error('Perbandingan visual membutuhkan LibreOffice (render headless). Instal LibreOffice lalu coba lagi. Microsoft Word tetap acuan kompatibilitas akhir.');
    const { original, generated } = svc.getVisualInputs(getDb(), id);
    const [po, pg] = await Promise.all([docxToPdf(original), docxToPdf(generated)]);
    const report = compareLayout(await extractMetrics(po), await extractMetrics(pg));
    return { report, original_pdf: po.toString('base64'), generated_pdf: pg.toString('base64') };
  });
  // AI hanya untuk area editable: kunci selain isian bertipe teks panjang pada template dibuang.
  handle('importer:aiDraft', z.object({
    templateId: S.id, title: z.string().max(300), recipient: z.string().max(500), subject: z.string().max(500),
    instructions: z.string().min(1).max(5000), references: z.string().max(15000),
    consent: z.literal(true, { errorMap: () => ({ message: 'Persetujuan pengiriman teks ke layanan AI diperlukan' }) })
  }), async (i) => {
    const t = repo.getTemplate(getDb(), i.templateId);
    if (!t || t.kind !== 'docx') throw new Error('Template Word tidak ditemukan.');
    const editable = t.fields.filter((f) => f.type === 'textarea' || f.type === 'richtext');
    if (!editable.length) throw new Error('Template ini tidak memiliki area isi (teks panjang) yang dapat disusun AI. Isi formulir secara manual.');
    const prompt = buildDraftPrompt({ ...i, fields: editable.map((f) => ({ key: f.key, label: f.label })) });
    const out = await aiComplete(AI_DRAFT_SYSTEM, prompt);
    return parseDraft(out, editable.map((f) => f.key), prompt);
  });
  // Varian template: keputusan pengguna, pratinjau PDF per varian, dan ringkasan registrasi (tanpa duplikasi).
  handle('importer:variantDecision', z.object({ id: S.id, groupNo: z.number().int().min(1).max(50), decision: z.enum(['confirm', 'reject']) }), ({ id, groupNo, decision }) => {
    svc.decideVariants(getDb(), id, groupNo, decision);
    return svc.getReview(getDb(), id);
  });
  handle('importer:variantPdf', z.object({ id: S.id, variantId: S.id }), async ({ id, variantId }) => {
    if (!findSoffice()) throw new Error('Pratinjau PDF varian membutuhkan LibreOffice. Pratinjau teks tetap tersedia.');
    return { pdf: (await docxToPdf(svc.variantSourceDocx(getDb(), id, variantId))).toString('base64') };
  });
  handle('importer:variantRegistry', z.object({ id: S.id }), ({ id }) => svc.variantRegistry(getDb(), id));
  handle('importer:capabilities', S.empty, () => ({ libreoffice: !!findSoffice() }));
}
