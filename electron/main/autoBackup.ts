import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './db';
import { backupFileName, createBackup, prepareFullRestore } from './backup';

export const AUTO_DIR = 'otomatis';
const AUTO_RE = /^naskahdinas-auto-\d{8}-\d{6}\.zip$/;

/** Sudah lewat 24 jam sejak backup otomatis terakhir (atau belum pernah). */
export const autoBackupDue = (lastIso: string | null, now: Date) => !lastIso || now.getTime() - Date.parse(lastIso) >= 24 * 3600_000;

/** Berkas backup otomatis yang dihapus agar tersisa `keep` terbaru; nama berstempel waktu sehingga urut abjad = urut waktu. */
export const filesToPrune = (names: string[], keep: number) => names.filter((n) => AUTO_RE.test(n)).sort().reverse().slice(Math.max(1, keep));

/**
 * Backup lengkap otomatis harian ke <folder backup>/otomatis, lalu diverifikasi dengan membuka salinannya (integrity_check)
 * sebelum backup lama dirotasi. Backup yang gagal diverifikasi dihapus dan backup lama tidak disentuh.
 */
export async function runAutoBackup(db: DB, baseDir: string, keep: number, now = new Date()): Promise<{ path: string; size: number; pruned: string[] } | null> {
  const last = db.prepare("SELECT created_at FROM backup_history WHERE type = 'auto' ORDER BY created_at DESC LIMIT 1").get() as { created_at: string } | undefined;
  if (!autoBackupDue(last?.created_at ?? null, now)) return null;
  const dir = path.join(baseDir, AUTO_DIR);
  const dest = path.join(dir, backupFileName('full', now).replace('backup-full', 'auto'));
  const { size } = await createBackup(db, 'full', dest);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-verify-'));
  try {
    prepareFullRestore(dest, work);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw new Error(`Backup otomatis gagal diverifikasi: ${e instanceof Error ? e.message : e}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  db.prepare('INSERT INTO backup_history (id, path, size_bytes, type, note, created_at) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), dest, size, 'auto', 'Otomatis harian, terverifikasi', now.toISOString());
  const pruned = filesToPrune(fs.readdirSync(dir), keep);
  for (const n of pruned) fs.rmSync(path.join(dir, n), { force: true });
  return { path: dest, size, pruned };
}
