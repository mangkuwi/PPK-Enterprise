import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from './db';
import { runMigrations } from './migrations';
import { seedDefaults } from './seed';

let db: DB | null = null;
let dbFile = '';

export const dataDir = () => path.join(app.getPath('userData'), 'data');
export const defaultBackupDir = () => path.join(app.getPath('userData'), 'backups');
export const dbPath = () => dbFile;

export function getDb(): DB {
  if (!db) throw new Error('Database belum diinisialisasi.');
  return db;
}

function open() {
  fs.mkdirSync(dataDir(), { recursive: true });
  dbFile = path.join(dataDir(), 'naskahdinas.db');
  const handle = openDatabase(dbFile);
  runMigrations(handle, {
    // Backup otomatis sebelum migrasi skema (berkas DB disalin utuh).
    beforeMigrate: (from) => {
      fs.mkdirSync(defaultBackupDir(), { recursive: true });
      handle.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(dbFile, path.join(defaultBackupDir(), `pre-migration-v${from}-${Date.now()}.db`));
    }
  });
  seedDefaults(handle);
  db = handle;
}

export function initDatabase() { open(); }

export function closeDatabase() { db?.close(); db = null; }
export function reopenDatabase() { closeDatabase(); open(); }
