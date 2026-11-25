import type { DB } from '../db';

export type Param = string | number | null;

/**
 * Akses data modul PPK. Sengaja async agar implementasi PostgreSQL (Tahap 6) bisa dipasang tanpa mengubah domain.
 * SQL memakai placeholder `?`; implementasi PostgreSQL mengubahnya menjadi $1, $2, ...
 */
export interface PpkStore {
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Semua tulis di dalam fn atomik: gagal = tidak ada yang tersimpan. Bersarang = savepoint, gagal hanya membatalkan bagian dalam. */
  tx<T>(fn: (s: PpkStore) => Promise<T>): Promise<T>;
}

/**
 * shortcut: transaksi SQLite memakai BEGIN IMMEDIATE dan mengandalkan fn hanya menunggu promise dari store ini
 * (selesai seketika), sehingga tidak ada panggilan IPC lain yang menyela. Jangan memanggil I/O async lain
 * (berkas, dialog, jaringan) di dalam tx; bila perlu, ganti dengan antrean tulis atau pindah ke PostgreSQL.
 */
export function sqliteStore(db: DB): PpkStore {
  let depth = 0;
  const s: PpkStore = {
    all: async <T>(sql: string, p: Param[] = []) => db.prepare(sql).all(...p) as T[],
    get: async <T>(sql: string, p: Param[] = []) => db.prepare(sql).get(...p) as T | undefined,
    run: async (sql, p = []) => ({ changes: db.prepare(sql).run(...p).changes }),
    tx: async (fn) => {
      if (depth > 0) {
        // Transaksi bersarang = savepoint: gagal di dalam hanya membatalkan bagian itu (dipakai impor per baris).
        const sp = `sp_${depth}`;
        db.exec(`SAVEPOINT ${sp}`);
        depth++;
        try { const out = await fn(s); db.exec(`RELEASE ${sp}`); return out; }
        catch (e) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; }
        finally { depth--; }
      }
      db.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = await fn(s);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    }
  };
  return s;
}
