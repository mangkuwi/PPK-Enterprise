import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { buildExportName } from '@shared/filename';
import type { ExportDoc, KopInfo } from '@shared/types';
import { buildDocx, type ExportInput } from '../main/docx-export';
import { renderPdf, printDocument } from '../main/pdf';
import { closeDatabase, dataDir, dbPath, defaultBackupDir, getDb, reopenDatabase } from '../main/database';
import { backupFileName, commitFullRestore, createBackup, prepareFullRestore, readManifest, restorePartial } from '../main/backup';
import { addBackupHistory, getSettings, listBackupHistory } from '../main/repo';
import { getMainWindow } from '../main/window';
import { currentActor } from '../main/numbering/session';
import { requireAdmin } from '../main/numbering/users';

export function toExportInput(doc: ExportDoc): ExportInput {
  const s = getSettings(getDb());
  const kopOn = doc.use_kop && s.kop_enabled === 'true' && (s.institution_name || s.institution_logo);
  const kop: KopInfo | null = kopOn ? { name: s.institution_name, address: s.institution_address, logo: s.institution_logo } : null;
  return { title: doc.title, content: doc.content, layout: doc.layout, headerText: doc.header_text, footerText: doc.footer_text, kop };
}

function validDir(dir: string): boolean {
  try { return !!dir && fs.statSync(dir).isDirectory(); } catch { return false; }
}

/** Menyimpan hanya ke lokasi yang dipilih pengguna lewat dialog sistem (renderer tidak pernah memberi path tulis). */
async function saveViaDialog(buf: Buffer, ext: 'docx' | 'pdf', doc: ExportDoc) {
  const s = getSettings(getDb());
  const dir = validDir(s.export_dir) ? s.export_dir : app.getPath('documents');
  const name = buildExportName({ code: doc.category_code, title: doc.title, date: doc.doc_date, ext });
  const res = await dialog.showSaveDialog(getMainWindow()!, {
    defaultPath: path.join(dir, name),
    filters: [{ name: ext === 'docx' ? 'Microsoft Word' : 'PDF', extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true as const };
  const target = res.filePath.toLowerCase().endsWith(`.${ext}`) ? res.filePath : `${res.filePath}.${ext}`;
  fs.writeFileSync(target, buf);
  return { canceled: false as const, path: target };
}

export function registerFileHandlers() {
  handle('export:docx', S.exportDoc, async ({ doc }) => saveViaDialog(await buildDocx(toExportInput(doc)), 'docx', doc));
  handle('export:pdf', S.exportDoc, async ({ doc }) => saveViaDialog(await renderPdf(toExportInput(doc)), 'pdf', doc));
  handle('export:print', S.exportDoc, ({ doc }) => printDocument(toExportInput(doc)));

  handle('app:showInFolder', z.object({ path: z.string().max(1000) }), ({ path: p }) => {
    if (!/\.(docx|pdf|zip|json)$/i.test(p) || !fs.existsSync(p)) throw new Error('Berkas tidak ditemukan.');
    shell.showItemInFolder(p);
    return true;
  });

  // ----- backup & restore -----
  handle('backup:history', S.empty, () => listBackupHistory(getDb()));

  handle('backup:create', z.object({ type: z.enum(['full', 'templates', 'documents']) }), async ({ type }) => {
    const s = getSettings(getDb());
    const dir = validDir(s.backup_dir) ? s.backup_dir : defaultBackupDir();
    const dest = path.join(dir, backupFileName(type));
    const { size } = await createBackup(getDb(), type, dest);
    addBackupHistory(getDb(), { path: dest, size_bytes: size, type, note: '' });
    return { path: dest, size };
  });

  handle('backup:restore', S.empty, async () => {
    // Restore mengganti/menggabungkan seluruh data (termasuk keuangan PPK): hanya administrator.
    requireAdmin(currentActor(getDb()));
    const win = getMainWindow()!;
    const s = getSettings(getDb());
    const pick = await dialog.showOpenDialog(win, {
      properties: ['openFile'], defaultPath: validDir(s.backup_dir) ? s.backup_dir : defaultBackupDir(),
      filters: [{ name: 'Backup PPK Management', extensions: ['zip'] }]
    });
    if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
    const zipFile = pick.filePaths[0];
    const m = readManifest(zipFile); // melempar error bila bukan backup yang sah

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Batal', 'Restore'], defaultId: 0, cancelId: 0, title: 'Konfirmasi Restore',
      message: m.type === 'full' ? 'Restore backup penuh?' : `Gabungkan backup ${m.type === 'templates' ? 'template' : 'arsip dokumen'}?`,
      detail: `Dibuat: ${new Date(m.created_at).toLocaleString('id-ID')}\nIsi: ${m.counts.templates} template, ${m.counts.documents} dokumen.\n\n` +
        (m.type === 'full'
          ? 'SELURUH data saat ini akan DIGANTI dengan isi backup. Sebuah backup otomatis dari data saat ini dibuat terlebih dahulu.'
          : 'Data dari backup digabungkan ke data saat ini; data yang sudah ada tidak ditimpa.')
    });
    if (confirm.response !== 1) return { canceled: true };

    // Selalu simpan salinan keadaan saat ini sebelum menimpa/menggabungkan.
    const safety = path.join(defaultBackupDir(), backupFileName('full').replace('backup-', 'pre-restore-'));
    const { size } = await createBackup(getDb(), 'full', safety);
    addBackupHistory(getDb(), { path: safety, size_bytes: size, type: 'pre-restore', note: 'Otomatis sebelum restore' });

    if (m.type !== 'full') {
      const r = restorePartial(getDb(), zipFile);
      return { canceled: false, type: r.type, imported: r.imported, safetyBackup: safety };
    }
    const tmp = prepareFullRestore(zipFile, path.join(dataDir(), 'tmp')); // validasi sebelum DB ditutup
    try {
      closeDatabase();
      commitFullRestore(tmp, dbPath());
    } finally {
      reopenDatabase(); // juga menjalankan migrasi bila backup berskema lebih lama
    }
    win.reload();
    return { canceled: false, type: 'full' as const, safetyBackup: safety };
  });
}
