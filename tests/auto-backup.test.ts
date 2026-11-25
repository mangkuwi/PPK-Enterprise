import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { autoBackupDue, filesToPrune, runAutoBackup, AUTO_DIR } from '../electron/main/autoBackup';
import { commitFullRestore, prepareFullRestore } from '../electron/main/backup';

describe('backup otomatis', () => {
  it('jatuh tempo setelah 24 jam dan rotasi menyisakan yang terbaru', () => {
    expect(autoBackupDue(null, new Date())).toBe(true);
    expect(autoBackupDue('2026-11-25T00:00:00Z', new Date('2026-11-25T23:00:00Z'))).toBe(false);
    expect(autoBackupDue('2026-11-25T00:00:00Z', new Date('2026-11-26T00:00:00Z'))).toBe(true);
    const names = ['naskahdinas-auto-20261101-010000.zip', 'naskahdinas-auto-20261103-010000.zip', 'naskahdinas-auto-20261102-010000.zip', 'lain.zip'];
    expect(filesToPrune(names, 2)).toEqual(['naskahdinas-auto-20261101-010000.zip']);
    expect(filesToPrune(names, 0)).toEqual(['naskahdinas-auto-20261102-010000.zip', 'naskahdinas-auto-20261101-010000.zip']);
  });

  it('membuat backup terverifikasi, sekali sehari, merotasi, dan bisa dipulihkan utuh termasuk data PPK', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-auto-'));
    const file = path.join(dir, 'live.db');
    const db = openDatabase(file); runMigrations(db); seedDefaults(db);
    db.prepare("INSERT INTO ppk_programs (id, code, name, is_active, created_at, updated_at) VALUES ('p1','SATRIA','SATRIA-1',1,'t','t')").run();
    const day = (d: number) => new Date(2026, 10, d, 9, 0, 0);
    const first = await runAutoBackup(db, dir, 2, day(1));
    expect(first).not.toBeNull();
    expect(await runAutoBackup(db, dir, 2, new Date(2026, 10, 1, 20))).toBeNull();
    await runAutoBackup(db, dir, 2, day(2));
    const third = await runAutoBackup(db, dir, 2, day(3));
    expect(third!.pruned).toEqual([path.basename(first!.path)]);
    expect(fs.readdirSync(path.join(dir, AUTO_DIR)).length).toBe(2);
    expect((db.prepare("SELECT COUNT(*) n FROM backup_history WHERE type='auto'").get() as { n: number }).n).toBe(3);

    // Pulihkan ke berkas baru dan bandingkan isinya.
    const target = path.join(dir, 'restored.db');
    commitFullRestore(prepareFullRestore(third!.path, path.join(dir, 'tmp')), target);
    const r = openDatabase(target);
    expect(r.prepare("SELECT name FROM ppk_programs WHERE id='p1'").get()).toEqual({ name: 'SATRIA-1' });
    expect(r.pragma('user_version', { simple: true })).toBe(db.pragma('user_version', { simple: true }));
    r.close(); db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
