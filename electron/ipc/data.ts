import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { dbPath, getDb } from '../main/database';
import * as repo from '../main/repo';
import { getMainWindow } from '../main/window';
import { importDocxBuffer } from '../main/docx-import-file';
import { currentActor } from '../main/numbering/session';
import { bindDocument, contextForTemplate, onDocumentDeleting, onDocumentStatus } from '../main/numbering/integration';
import { recordForDocument } from '../main/numbering/records';

export function registerDataHandlers() {
  handle('app:info', S.empty, () => ({
    name: app.getName(), version: app.getVersion(), platform: process.platform, dbPath: dbPath(), userData: app.getPath('userData')
  }));
  handle('stats:get', S.empty, () => repo.getStats(getDb()));
  handle('categories:list', S.empty, () => repo.listCategories(getDb()));

  // ----- templates -----
  handle('templates:list', S.templateFilter, (f) => repo.listTemplates(getDb(), f));
  handle('templates:get', z.object({ id: S.id }), ({ id }) => {
    const t = repo.getTemplate(getDb(), id);
    if (!t) throw new Error('Template tidak ditemukan.');
    return t;
  });
  handle('templates:save', S.templateInput, (input) => {
    const id = repo.saveTemplate(getDb(), input);
    return repo.getTemplate(getDb(), id);
  });
  handle('templates:delete', z.object({ id: S.id }), ({ id }) => { repo.deleteTemplate(getDb(), id); return true; });
  handle('templates:duplicate', z.object({ id: S.id }), ({ id }) => repo.getTemplate(getDb(), repo.duplicateTemplate(getDb(), id)));
  handle('templates:favorite', z.object({ id: S.id, value: z.boolean() }), ({ id, value }) => { repo.setTemplateFavorite(getDb(), id, value); return true; });

  handle('templates:export', z.object({ ids: z.array(S.id).min(1).max(500) }), async ({ ids }) => {
    const payload = repo.exportTemplates(getDb(), ids);
    const win = getMainWindow();
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: `template-naskahdinas-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Template PPK Management (JSON)', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { canceled: false, path: res.filePath, count: payload.templates.length };
  });

  handle('templates:import', S.empty, async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Template PPK Management (JSON)', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('Berkas terlalu besar (maks 50 MB).');
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Berkas bukan JSON yang valid.'); }
    const check = S.templateImportFile.safeParse(parsed);
    if (!check.success) throw new Error('Format berkas template tidak valid atau bukan berkas template aplikasi ini.');
    return { canceled: false, imported: repo.importTemplates(getDb(), check.data as repo.TemplateExport) };
  });

  handle('templates:importDocx', S.empty, async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Dokumen Word', extensions: ['docx', 'dotx'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('Berkas terlalu besar (maks 50 MB).');
    return { canceled: false, template: importDocxBuffer(fs.readFileSync(file), path.basename(file)) };
  });

  // ----- documents -----
  handle('documents:list', S.documentFilter, (f) => repo.listDocuments(getDb(), f));
  handle('documents:get', z.object({ id: S.id }), ({ id }) => {
    const d = repo.getDocument(getDb(), id);
    if (!d) throw new Error('Dokumen tidak ditemukan.');
    return d;
  });
  handle('documents:save', S.documentInput.extend({ number_record_id: S.id.nullish(), number_refs: S.numberRefs.optional() }), (input) => {
    const { number_record_id, number_refs, ...doc } = input;
    const db = getDb();
    return db.transaction(() => {
      if (!doc.id && doc.template_id && !number_record_id && contextForTemplate(db, doc.template_id).register) {
        throw new Error('Template ini terhubung ke register penomoran, tetapi nomor belum dipilih. Pilih nomor yang tersedia dari Bank Nomor.');
      }
      let saved = repo.saveDocument(db, doc);
      let numbering: { number_text: string; in_content: boolean } | null = null;
      const linked = recordForDocument(db, saved.id);
      if (number_record_id || linked) {
        const rid = number_record_id ?? (linked as { id: string }).id;
        const b = bindDocument(db, currentActor(db), { record_id: rid, document_id: saved.id, values: saved.form_values as Record<string, string>, refs: number_refs, template_id: saved.template_id });
        saved = repo.getDocument(db, saved.id) as typeof saved;
        numbering = { number_text: b.record.number_text, in_content: b.in_content };
      }
      return { ...saved, numbering };
    })();
  });
  handle('documents:delete', z.object({ id: S.id }), ({ id }) => {
    const db = getDb();
    db.transaction(() => { if (recordForDocument(db, id)) onDocumentDeleting(db, currentActor(db), id); repo.deleteDocument(db, id); })();
    return true;
  });
  handle('documents:duplicate', z.object({ id: S.id }), ({ id }) => repo.duplicateDocument(getDb(), id));
  handle('documents:setStatus', z.object({ id: S.id, status: z.enum(['draft', 'review', 'final']) }), ({ id, status }) => {
    const db = getDb();
    db.transaction(() => { repo.setDocumentStatus(db, id, status); if (recordForDocument(db, id)) onDocumentStatus(db, currentActor(db), id, status); })();
    return true;
  });
  handle('documents:versions', z.object({ id: S.id }), ({ id }) => repo.listVersions(getDb(), id));
  handle('documents:version', z.object({ id: S.id }), ({ id }) => {
    const v = repo.getVersion(getDb(), id);
    if (!v) throw new Error('Versi tidak ditemukan.');
    return v;
  });
  handle('documents:restoreVersion', z.object({ id: S.id }), ({ id }) => repo.restoreVersion(getDb(), id));
}
