import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // penulis bersamaan menunggu, bukan gagal
  return db;
}
