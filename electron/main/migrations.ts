import type Database from 'better-sqlite3';

export interface Migration { version: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL, header_text TEXT NOT NULL DEFAULT '', footer_text TEXT NOT NULL DEFAULT '',
  layout_json TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_templates_category ON templates(category_id);
CREATE TABLE template_fields (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1, default_value TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(template_id, key)
);
-- Dokumen menyimpan SALINAN isi (snapshot). template_id hanya referensi lunak:
-- menghapus/mengubah template tidak memengaruhi dokumen yang sudah dibuat.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL, letter_number TEXT NOT NULL DEFAULT '', recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '', doc_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','final')),
  content_json TEXT NOT NULL, content_text TEXT NOT NULL DEFAULT '',
  header_text TEXT NOT NULL DEFAULT '', footer_text TEXT NOT NULL DEFAULT '',
  layout_json TEXT NOT NULL, form_values_json TEXT NOT NULL DEFAULT '{}',
  use_kop INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_category ON documents(category_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created ON documents(created_at);
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  UNIQUE(document_id, version_no)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE backup_history (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);`
  },
  {
    version: 2,
    name: 'smart_template_importer',
    sql: `
ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'editor' CHECK (kind IN ('editor','docx'));
ALTER TABLE documents ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'editor' CHECK (source_kind IN ('editor','docx'));
ALTER TABLE documents ADD COLUMN docx_blob BLOB;
ALTER TABLE documents ADD COLUMN docx_state TEXT NOT NULL DEFAULT 'pristine' CHECK (docx_state IN ('pristine','edited'));

CREATE TABLE imported_templates (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  original_file_path TEXT NOT NULL DEFAULT '',
  original_blob BLOB NOT NULL,
  original_sha256 TEXT NOT NULL,
  adapted_blob BLOB,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  import_status TEXT NOT NULL DEFAULT 'analyzed' CHECK (import_status IN ('analyzed','reviewed','saved','error')),
  analysis_result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_imported_template ON imported_templates(template_id);
-- Dokumen sumber tidak boleh diubah setelah diunggah.
CREATE TRIGGER trg_imported_original_immutable BEFORE UPDATE OF original_blob, original_sha256 ON imported_templates
BEGIN SELECT RAISE(ABORT, 'Dokumen sumber tidak boleh diubah'); END;

CREATE TABLE template_mappings (
  id TEXT PRIMARY KEY,
  imported_template_id TEXT NOT NULL REFERENCES imported_templates(id) ON DELETE CASCADE,
  part TEXT NOT NULL, para_index INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  placeholder_name TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  field_type TEXT NOT NULL DEFAULT 'text', default_value TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1, options_json TEXT NOT NULL DEFAULT '[]',
  confidence_score REAL NOT NULL DEFAULT 0,
  mapping_status TEXT NOT NULL DEFAULT 'auto' CHECK (mapping_status IN ('auto','confirm','confirmed','manual','rejected')),
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_mappings_import ON template_mappings(imported_template_id);

CREATE TABLE template_assets (
  id TEXT PRIMARY KEY,
  imported_template_id TEXT NOT NULL REFERENCES imported_templates(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL, asset_path TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
);`
  },
  {
    version: 3,
    name: 'template_versions_validation',
    sql: `
ALTER TABLE imported_templates ADD COLUMN protected_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE documents ADD COLUMN validation_json TEXT;
CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,
  imported_template_id TEXT NOT NULL REFERENCES imported_templates(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  adapted_blob BLOB NOT NULL,
  mappings_json TEXT NOT NULL,
  groups_json TEXT NOT NULL,
  protected_json TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (imported_template_id, version_no)
);
CREATE INDEX idx_tpl_versions ON template_versions(imported_template_id);`
  },
  {
    version: 4,
    name: 'template_variants',
    sql: `
CREATE TABLE template_variants (
  id TEXT PRIMARY KEY,
  imported_template_id TEXT NOT NULL REFERENCES imported_templates(id) ON DELETE CASCADE,
  group_no INTEGER NOT NULL,
  position INTEGER NOT NULL,
  letter TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('auto','confirm','confirmed','rejected')),
  group_json TEXT NOT NULL,
  item_json TEXT NOT NULL,
  UNIQUE (imported_template_id, group_no, position)
);
CREATE INDEX idx_tpl_variants ON template_variants(imported_template_id);
ALTER TABLE template_versions ADD COLUMN variants_json TEXT NOT NULL DEFAULT '[]';`
  },
  {
    version: 5,
    name: 'document_numbering_registry',
    sql: `
CREATE TABLE app_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('admin','operator')),
  pin_hash TEXT, pin_salt TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE number_registers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (code IN ('SURAT_KELUAR','NOTA_DINAS','BERITA_ACARA','KONTRAK')),
  name TEXT NOT NULL, format TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '', suffix TEXT NOT NULL DEFAULT '',
  seq_length INTEGER NOT NULL DEFAULT 0 CHECK (seq_length BETWEEN 0 AND 10),
  initial_sequence INTEGER NOT NULL DEFAULT 1 CHECK (initial_sequence >= 1),
  ttl_hours INTEGER NOT NULL DEFAULT 72 CHECK (ttl_hours >= 1),
  placeholder_keys_json TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE number_register_config_history (
  id TEXT PRIMARY KEY, register_id TEXT NOT NULL REFERENCES number_registers(id), changed_at TEXT NOT NULL,
  changed_by TEXT, changed_by_name TEXT NOT NULL, old_json TEXT NOT NULL, new_json TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
);
-- Penghitung tahunan: kunci = register (kategori) + tahun dokumen.
CREATE TABLE number_counters (
  register_id TEXT NOT NULL REFERENCES number_registers(id), year INTEGER NOT NULL,
  next_seq INTEGER NOT NULL CHECK (next_seq >= 1), confirmed_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (register_id, year)
);
CREATE TABLE number_imports (
  id TEXT PRIMARY KEY, register_id TEXT NOT NULL REFERENCES number_registers(id), filename TEXT NOT NULL, sheet TEXT NOT NULL,
  file_sha256 TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('committed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0, imported_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}', mapping_json TEXT NOT NULL DEFAULT '{}', created_by TEXT, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE number_records (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES number_registers(id),
  year INTEGER NOT NULL, seq INTEGER, number_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','issued','cancelled')),
  number_date TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '', creator_id TEXT,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','manual','import')),
  import_id TEXT REFERENCES number_imports(id),
  reserved_at TEXT, reserved_by TEXT, expires_at TEXT, issued_at TEXT, issued_by TEXT,
  cancelled_at TEXT, cancelled_by TEXT, cancel_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (register_id, year, seq),
  UNIQUE (register_id, number_text)
);
CREATE INDEX idx_nr_reg_year ON number_records(register_id, year);
CREATE INDEX idx_nr_status ON number_records(register_id, status);
CREATE INDEX idx_nr_doc ON number_records(document_id);
CREATE TABLE number_events (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES number_records(id), register_id TEXT NOT NULL,
  event TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, at TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_ne_record ON number_events(record_id);
CREATE TABLE document_number_refs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES number_records(id), placeholder_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (document_id, record_id, placeholder_key)
);
CREATE TABLE register_category_map (
  category_id TEXT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE, register_id TEXT NOT NULL REFERENCES number_registers(id)
);
CREATE TABLE register_template_map (
  template_id TEXT PRIMARY KEY REFERENCES templates(id) ON DELETE CASCADE, register_id TEXT NOT NULL REFERENCES number_registers(id)
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '', entity_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log(at);

-- Perlindungan di tingkat database: nomor tidak dapat dihapus/diubah; riwayat bersifat append-only.
CREATE TRIGGER trg_nr_nodelete BEFORE DELETE ON number_records
BEGIN SELECT RAISE(ABORT, 'Catatan penomoran tidak boleh dihapus permanen.'); END;
CREATE TRIGGER trg_nr_status BEFORE UPDATE OF status ON number_records
WHEN NOT (OLD.status = NEW.status OR (OLD.status = 'reserved' AND NEW.status IN ('issued','cancelled')))
BEGIN SELECT RAISE(ABORT, 'Transisi status nomor tidak diizinkan (hanya RESERVED menjadi ISSUED atau CANCELLED).'); END;
CREATE TRIGGER trg_nr_key BEFORE UPDATE OF register_id, year, seq, number_text, number_date ON number_records
WHEN OLD.register_id IS NOT NEW.register_id OR OLD.year IS NOT NEW.year OR OLD.seq IS NOT NEW.seq
  OR OLD.number_text IS NOT NEW.number_text OR OLD.number_date IS NOT NEW.number_date
BEGIN SELECT RAISE(ABORT, 'Nomor, tahun, dan tanggal penomoran tidak dapat diubah setelah dicatat.'); END;
CREATE TRIGGER trg_ne_noupd BEFORE UPDATE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;
CREATE TRIGGER trg_ne_nodel BEFORE DELETE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;
CREATE TRIGGER trg_audit_noupd BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'Log audit bersifat append-only.'); END;
CREATE TRIGGER trg_audit_nodel BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'Log audit bersifat append-only.'); END;
CREATE TRIGGER trg_cfg_noupd BEFORE UPDATE ON number_register_config_history BEGIN SELECT RAISE(ABORT, 'Riwayat konfigurasi bersifat append-only.'); END;
CREATE TRIGGER trg_cfg_nodel BEFORE DELETE ON number_register_config_history BEGIN SELECT RAISE(ABORT, 'Riwayat konfigurasi bersifat append-only.'); END;

-- Data awal: administrator lokal dan empat register. Pemetaan kategori dokumen→register diterapkan sekali oleh aplikasi (numbering/service.ts).
-- Format nomor di bawah hanyalah CONTOH awal; sesuaikan di Pengaturan Penomoran.
INSERT INTO app_users (id, name, role, is_active, created_at) VALUES (lower(hex(randomblob(16))), 'Administrator', 'admin', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO number_registers (id, code, name, format, placeholder_keys_json, sort_order, updated_at) VALUES
 (lower(hex(randomblob(16))), 'SURAT_KELUAR', 'Surat Keluar', '{SEQUENCE}/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}', '["NOMOR_SURAT"]', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (lower(hex(randomblob(16))), 'NOTA_DINAS', 'Nota Dinas', '{SEQUENCE}/ND/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}', '["NOMOR_NOTA_DINAS","NOMOR_SURAT"]', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (lower(hex(randomblob(16))), 'BERITA_ACARA', 'Berita Acara', '{SEQUENCE}/BA/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}', '["NOMOR_BA","NOMOR_SURAT"]', 3, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (lower(hex(randomblob(16))), 'KONTRAK', 'Kontrak', '{SEQUENCE}/KONTRAK/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}', '["NOMOR_KONTRAK","NOMOR_SURAT"]', 4, strftime('%Y-%m-%dT%H:%M:%fZ','now'));`
  },
  {
    version: 6,
    name: 'daily_date_based_numbering',
    sql: `
-- Penomoran harian DDSS: kunci penghitung = register (kategori) + TANGGAL DOKUMEN LENGKAP. Tahun/bulan tetap tersimpan di kunci (tanggal penuh).
-- Catatan lama dipertahankan apa adanya (skema 'legacy'): nomor lengkap, tanggal, dan nomor urut tahunan lama (legacy_seq) tidak diubah.
CREATE TEMP TABLE _ev AS SELECT * FROM number_events;
CREATE TEMP TABLE _refs AS SELECT * FROM document_number_refs;
DROP TABLE number_events;
DROP TABLE document_number_refs;
CREATE TABLE number_records_new (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES number_registers(id),
  year INTEGER NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  seq INTEGER,
  seq_scheme TEXT NOT NULL DEFAULT 'daily' CHECK (seq_scheme IN ('daily','legacy')),
  legacy_seq INTEGER,
  number_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','issued','cancelled')),
  number_date TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '', creator_id TEXT,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','manual','import')),
  import_id TEXT REFERENCES number_imports(id),
  reserved_at TEXT, reserved_by TEXT, expires_at TEXT, issued_at TEXT, issued_by TEXT,
  cancelled_at TEXT, cancelled_by TEXT, cancel_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (register_id, number_date, seq),
  UNIQUE (register_id, number_date, number_text),
  CHECK (seq IS NULL OR seq_scheme = 'daily')
);
INSERT INTO number_records_new (id, register_id, year, day, seq, seq_scheme, legacy_seq, number_text, status, number_date, subject, counterparty, notes, creator, creator_id, document_id,
  source, import_id, reserved_at, reserved_by, expires_at, issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at)
SELECT id, register_id, year, substr(number_date, 9, 2), NULL, 'legacy', seq, number_text, status, number_date, subject, counterparty, notes, creator, creator_id, document_id,
  source, import_id, reserved_at, reserved_by, expires_at, issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at FROM number_records;
DROP TABLE number_records;
ALTER TABLE number_records_new RENAME TO number_records;
CREATE INDEX idx_nr_reg_year ON number_records(register_id, year);
CREATE INDEX idx_nr_reg_date ON number_records(register_id, number_date);
CREATE INDEX idx_nr_status ON number_records(register_id, status);
CREATE INDEX idx_nr_doc ON number_records(document_id);
CREATE TABLE number_events (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES number_records(id), register_id TEXT NOT NULL,
  event TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, at TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_ne_record ON number_events(record_id);
CREATE TABLE document_number_refs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES number_records(id), placeholder_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (document_id, record_id, placeholder_key)
);
INSERT INTO number_events SELECT * FROM _ev;
INSERT INTO document_number_refs SELECT * FROM _refs;
DROP TABLE _ev;
DROP TABLE _refs;
CREATE TRIGGER trg_nr_nodelete BEFORE DELETE ON number_records
BEGIN SELECT RAISE(ABORT, 'Catatan penomoran tidak boleh dihapus permanen.'); END;
CREATE TRIGGER trg_nr_status BEFORE UPDATE OF status ON number_records
WHEN NOT (OLD.status = NEW.status OR (OLD.status = 'reserved' AND NEW.status IN ('issued','cancelled')))
BEGIN SELECT RAISE(ABORT, 'Transisi status nomor tidak diizinkan (hanya RESERVED menjadi ISSUED atau CANCELLED).'); END;
CREATE TRIGGER trg_nr_key BEFORE UPDATE OF register_id, year, day, seq, seq_scheme, legacy_seq, number_text, number_date ON number_records
WHEN OLD.register_id IS NOT NEW.register_id OR OLD.year IS NOT NEW.year OR OLD.day IS NOT NEW.day OR OLD.seq IS NOT NEW.seq OR OLD.seq_scheme IS NOT NEW.seq_scheme
  OR OLD.legacy_seq IS NOT NEW.legacy_seq OR OLD.number_text IS NOT NEW.number_text OR OLD.number_date IS NOT NEW.number_date
BEGIN SELECT RAISE(ABORT, 'Nomor, tahun, dan tanggal penomoran tidak dapat diubah setelah dicatat.'); END;
CREATE TRIGGER trg_ne_noupd BEFORE UPDATE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;
CREATE TRIGGER trg_ne_nodel BEFORE DELETE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;

-- Penghitung harian. number_counters (tahunan) dibiarkan sebagai arsip dan tidak dipakai lagi.
CREATE TABLE number_daily_counters (
  register_id TEXT NOT NULL REFERENCES number_registers(id), number_date TEXT NOT NULL,
  next_seq INTEGER NOT NULL CHECK (next_seq >= 1), confirmed_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (register_id, number_date)
);

-- Format baru DDSS untuk keempat register; nilai lama dicatat pada riwayat konfigurasi (nomor yang sudah terbit tidak berubah).
INSERT INTO number_register_config_history (id, register_id, changed_at, changed_by, changed_by_name, old_json, new_json, reason)
SELECT lower(hex(randomblob(16))), id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, 'Migrasi v6',
  json_object('format', format, 'prefix', prefix, 'suffix', suffix, 'seq_length', seq_length),
  json_object('format', '{DAY2}{SEQUENCE}', 'prefix', '', 'suffix', '', 'seq_length', 2), 'Penomoran harian berbasis tanggal dokumen (DDSS)'
FROM number_registers;
UPDATE number_registers SET format = '{DAY2}{SEQUENCE}', prefix = '', suffix = '', seq_length = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');`
  },
  {
    version: 7,
    name: 'number_pool',
    sql: `
-- Bank nomor: nomor dibuat lebih dulu (AVAILABLE), dipilih untuk draf (ASSIGNED), terbit saat dokumen final (ISSUED); VOID hanya oleh administrator.
-- Pemetaan data lama (tidak ada nomor/tanggal/urut yang diubah): issued→issued, cancelled→void, reserved+dokumen→assigned,
-- reserved tanpa dokumen→available TETAPI legacy_review=1 (disembunyikan dari pemilih sampai administrator meninjau; tidak diasumsikan tersedia).
CREATE TABLE number_batches (
  id TEXT PRIMARY KEY, register_id TEXT NOT NULL REFERENCES number_registers(id), number_date TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity >= 1),
  first_number TEXT NOT NULL, last_number TEXT NOT NULL, created_by TEXT, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_nb_reg ON number_batches(register_id, number_date);
CREATE TEMP TABLE _ev AS SELECT * FROM number_events;
CREATE TEMP TABLE _refs AS SELECT * FROM document_number_refs;
DROP TABLE number_events;
DROP TABLE document_number_refs;
CREATE TABLE number_records_new (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES number_registers(id),
  year INTEGER NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  seq INTEGER,
  seq_scheme TEXT NOT NULL DEFAULT 'daily' CHECK (seq_scheme IN ('daily','legacy')),
  legacy_seq INTEGER,
  number_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available','assigned','issued','void')),
  number_date TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '', creator_id TEXT,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','manual','import')),
  import_id TEXT REFERENCES number_imports(id),
  batch_id TEXT REFERENCES number_batches(id),
  generated_at TEXT, generated_by TEXT,
  assigned_at TEXT, assigned_by TEXT, issued_at TEXT, issued_by TEXT,
  voided_at TEXT, voided_by TEXT, void_reason TEXT,
  legacy_review INTEGER NOT NULL DEFAULT 0 CHECK (legacy_review IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (register_id, number_date, seq),
  UNIQUE (register_id, number_date, number_text),
  CHECK (seq IS NULL OR seq_scheme = 'daily')
);
INSERT INTO number_records_new (id, register_id, year, day, seq, seq_scheme, legacy_seq, number_text, status, number_date, subject, counterparty, notes, creator, creator_id, document_id,
  source, import_id, generated_at, generated_by, assigned_at, assigned_by, issued_at, issued_by, voided_at, voided_by, void_reason, legacy_review, created_at, updated_at)
SELECT id, register_id, year, day, seq, seq_scheme, legacy_seq, number_text,
  CASE status WHEN 'cancelled' THEN 'void' WHEN 'issued' THEN 'issued' WHEN 'reserved' THEN CASE WHEN document_id IS NOT NULL THEN 'assigned' ELSE 'available' END END,
  number_date, subject, counterparty, notes, creator, creator_id, document_id,
  source, import_id, COALESCE(reserved_at, created_at), COALESCE(reserved_by, creator),
  CASE WHEN status='reserved' AND document_id IS NOT NULL THEN reserved_at END, CASE WHEN status='reserved' AND document_id IS NOT NULL THEN reserved_by END,
  issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason,
  CASE WHEN status='reserved' AND document_id IS NULL THEN 1 ELSE 0 END, created_at, updated_at FROM number_records;
DROP TABLE number_records;
ALTER TABLE number_records_new RENAME TO number_records;
CREATE INDEX idx_nr_reg_year ON number_records(register_id, year);
CREATE INDEX idx_nr_reg_date ON number_records(register_id, number_date);
CREATE INDEX idx_nr_status ON number_records(register_id, status);
CREATE INDEX idx_nr_doc ON number_records(document_id);
CREATE INDEX idx_nr_batch ON number_records(batch_id);
CREATE TABLE number_events (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES number_records(id), register_id TEXT NOT NULL,
  event TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, at TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_ne_record ON number_events(record_id);
CREATE TABLE document_number_refs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES number_records(id), placeholder_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (document_id, record_id, placeholder_key)
);
INSERT INTO number_events SELECT * FROM _ev;
INSERT INTO document_number_refs SELECT * FROM _refs;
DROP TABLE _ev;
DROP TABLE _refs;
CREATE TRIGGER trg_nr_nodelete BEFORE DELETE ON number_records
BEGIN SELECT RAISE(ABORT, 'Catatan penomoran tidak boleh dihapus permanen.'); END;
CREATE TRIGGER trg_nr_status BEFORE UPDATE OF status ON number_records
WHEN NOT (OLD.status = NEW.status
  OR (OLD.status = 'available' AND NEW.status IN ('assigned','void'))
  OR (OLD.status = 'assigned' AND NEW.status IN ('available','issued')))
BEGIN SELECT RAISE(ABORT, 'Transisi status nomor tidak diizinkan (nomor terbit dan void bersifat final).'); END;
CREATE TRIGGER trg_nr_key BEFORE UPDATE OF register_id, year, day, seq, seq_scheme, legacy_seq, number_text, number_date ON number_records
WHEN OLD.register_id IS NOT NEW.register_id OR OLD.year IS NOT NEW.year OR OLD.day IS NOT NEW.day OR OLD.seq IS NOT NEW.seq OR OLD.seq_scheme IS NOT NEW.seq_scheme
  OR OLD.legacy_seq IS NOT NEW.legacy_seq OR OLD.number_text IS NOT NEW.number_text OR OLD.number_date IS NOT NEW.number_date
BEGIN SELECT RAISE(ABORT, 'Nomor, tahun, dan tanggal penomoran tidak dapat diubah setelah dicatat.'); END;
CREATE TRIGGER trg_ne_noupd BEFORE UPDATE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;
CREATE TRIGGER trg_ne_nodel BEFORE DELETE ON number_events BEGIN SELECT RAISE(ABORT, 'Riwayat penomoran bersifat append-only.'); END;
CREATE TRIGGER trg_nb_noupd BEFORE UPDATE ON number_batches BEGIN SELECT RAISE(ABORT, 'Catatan batch bersifat append-only.'); END;
CREATE TRIGGER trg_nb_nodel BEFORE DELETE ON number_batches BEGIN SELECT RAISE(ABORT, 'Catatan batch bersifat append-only.'); END;`
  }
];

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version;

export function currentVersion(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** Menjalankan migrasi yang belum diterapkan. beforeMigrate dipanggil (untuk backup file) hanya bila DB sudah berisi data. */
export function runMigrations(db: Database.Database, hooks: { beforeMigrate?: (from: number) => void } = {}): number {
  const cur = currentVersion(db);
  if (cur > LATEST_SCHEMA) throw new Error(`Database dibuat oleh versi aplikasi yang lebih baru (skema ${cur}).`);
  const pending = MIGRATIONS.filter((m) => m.version > cur);
  if (!pending.length) return cur;
  if (cur > 0) hooks.beforeMigrate?.(cur);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return LATEST_SCHEMA;
}
