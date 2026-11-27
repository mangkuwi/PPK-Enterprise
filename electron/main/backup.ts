import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import type { DB } from './db';
import { LATEST_SCHEMA, currentVersion } from './migrations';
import { exportAllDocuments, exportTemplates, importDocuments, importTemplates, listTemplates } from './repo';
import type { BackupType } from '@shared/types';

export interface Manifest {
  app: 'NASKAHDINAS AI'; format: 1; type: BackupType; created_at: string; schema_version: number;
  counts: { templates: number; documents: number };
}

const DB_ENTRY = 'naskahdinas.db';
const SQLITE_MAGIC = 'SQLite format 3\u0000';

function counts(db: DB) {
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  return { templates: n('templates'), documents: n('documents') };
}

export function backupFileName(type: BackupType, d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `naskahdinas-backup-${type}-${stamp}.zip`;
}

export async function createBackup(db: DB, type: BackupType, destFile: string): Promise<{ size: number }> {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const manifest: Manifest = {
    app: 'NASKAHDINAS AI', format: 1, type, created_at: new Date().toISOString(),
    schema_version: currentVersion(db), counts: counts(db)
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  if (type === 'full') {
    // db.backup() membuat salinan yang konsisten walau DB sedang dipakai.
    const tmp = path.join(os.tmpdir(), `nd-backup-${process.pid}-${Date.now()}.db`);
    try {
      await db.backup(tmp);
      zip.addFile(DB_ENTRY, fs.readFileSync(tmp));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } else if (type === 'templates') {
    // Template Word (kind='docx') bergantung pada berkas DOCX di tabel impor; ia hanya tercakup pada backup lengkap.
    const ids = listTemplates(db).filter((t) => t.kind === 'editor').map((t) => t.id);
    zip.addFile('data.json', Buffer.from(JSON.stringify(exportTemplates(db, ids))));
  } else {
    zip.addFile('data.json', Buffer.from(JSON.stringify(exportAllDocuments(db))));
  }
  zip.writeZip(destFile);
  return { size: fs.statSync(destFile).size };
}

export function readManifest(zipFile: string): Manifest {
  const zip = new AdmZip(zipFile);
  const e = zip.getEntry('manifest.json');
  if (!e) throw new Error('Berkas bukan backup aplikasi ini (manifest tidak ditemukan).');
  const m = JSON.parse(e.getData().toString('utf8')) as Manifest;
  if (m.app !== 'NASKAHDINAS AI' || m.format !== 1 || !['full', 'templates', 'documents'].includes(m.type)) {
    throw new Error('Format backup tidak dikenali.');
  }
  return m;
}

/** Ekstrak & validasi DB dari backup penuh ke berkas sementara. Mengembalikan path berkas tervalidasi. */
export function prepareFullRestore(zipFile: string, workDir: string): string {
  const m = readManifest(zipFile);
  if (m.type !== 'full') throw new Error('Backup ini bukan backup penuh.');
  if (m.schema_version > LATEST_SCHEMA) throw new Error('Backup dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi terlebih dahulu.');
  const entry = new AdmZip(zipFile).getEntry(DB_ENTRY);
  if (!entry) throw new Error('Berkas database tidak ditemukan di dalam backup.');
  const data = entry.getData();
  if (data.subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) throw new Error('Berkas database pada backup rusak.');
  fs.mkdirSync(workDir, { recursive: true });
  const tmp = path.join(workDir, `restoring-${Date.now()}.db`);
  fs.writeFileSync(tmp, data);
  const check = new Database(tmp, { readonly: true });
  try {
    const res = check.pragma('integrity_check', { simple: true });
    if (res !== 'ok') throw new Error('Pemeriksaan integritas database backup gagal.');
  } finally {
    check.close();
  }
  return tmp;
}

/** Ganti berkas DB aktif (DB harus sudah ditutup oleh pemanggil). */
export function commitFullRestore(validatedTmp: string, dbPath: string) {
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.copyFileSync(validatedTmp, dbPath);
  fs.rmSync(validatedTmp, { force: true });
}

/** Restore parsial (template / arsip): menggabungkan data ke database aktif. */
export function restorePartial(db: DB, zipFile: string): { type: BackupType; imported: number } {
  const m = readManifest(zipFile);
  const entry = new AdmZip(zipFile).getEntry('data.json');
  if (!entry) throw new Error('data.json tidak ditemukan di dalam backup.');
  const payload = JSON.parse(entry.getData().toString('utf8'));
  if (m.type === 'templates' && payload.format === 'naskahdinas-templates') {
    return { type: 'templates', imported: importTemplates(db, payload, { keepIds: true }) };
  }
  if (m.type === 'documents' && payload.format === 'naskahdinas-documents') {
    return { type: 'documents', imported: importDocuments(db, payload) };
  }
  throw new Error('Isi backup tidak sesuai dengan jenisnya.');
}
