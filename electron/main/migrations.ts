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
  },
  {
    version: 8,
    name: 'ppk_master_data',
    sql: `
-- Modul PPK, tahap 1: data master. Hanya menambah tabel ppk_*; tabel modul dokumen dan penomoran tidak diubah.
-- SQL dijaga portabel (rencana PostgreSQL): tanpa AUTOINCREMENT, tanggal TEXT ISO, boolean 0/1, rupiah INTEGER.
CREATE TABLE ppk_user_roles (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('admin','ppk','staf','pembaca')),
  assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL
);
CREATE TABLE ppk_fiscal_years (
  id TEXT PRIMARY KEY, year INTEGER NOT NULL UNIQUE CHECK (year BETWEEN 2000 AND 2100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ppk_units (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Riwayat pejabat PPK per unit (jawaban no. 7: pergantian pejabat tidak memindahkan kontrak/anggaran).
CREATE TABLE ppk_officials (
  id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES ppk_units(id), name TEXT NOT NULL CHECK (length(trim(name)) > 0), nip TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL, end_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_ppk_officials_unit ON ppk_officials(unit_id, start_date);
CREATE TABLE ppk_programs (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ppk_activities (
  id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES ppk_programs(id), code TEXT NOT NULL CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (program_id, code)
);
-- Kanal pembayaran: RM/PNBP lewat SAKTI, BLU lewat FO BAKTI (jawaban B).
CREATE TABLE ppk_funding_sources (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  payment_channel TEXT NOT NULL CHECK (payment_channel IN ('SAKTI','FO','LAINNYA')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ppk_budget_accounts (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ppk_service_categories (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Penanda proyek/paket (kode hub H58, H73, ...; jawaban no. 14).
CREATE TABLE ppk_service_packages (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', capacity TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Tarif pajak berlaku per tanggal (basis poin: 1100 = 11%).
CREATE TABLE ppk_tax_rates (
  id TEXT PRIMARY KEY, valid_from TEXT NOT NULL UNIQUE, ppn_bp INTEGER NOT NULL CHECK (ppn_bp BETWEEN 0 AND 5000),
  pph23_bp INTEGER NOT NULL CHECK (pph23_bp BETWEEN 0 AND 5000), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
-- Penyedia: satu master untuk semua modul. name_key = nama dinormalisasi (huruf kecil, tanpa PT/CV/tanda baca) untuk cegah ganda.
CREATE TABLE ppk_vendors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0), name_key TEXT NOT NULL UNIQUE,
  npwp TEXT NOT NULL DEFAULT '', nib TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '', account_holder TEXT NOT NULL DEFAULT '',
  service_category_id TEXT REFERENCES ppk_service_categories(id),
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif','arsip')), notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_ppk_vendors_npwp ON ppk_vendors(npwp) WHERE npwp <> '';
CREATE INDEX idx_ppk_vendors_status ON ppk_vendors(status);
-- Master tidak dihapus permanen (arsipkan/nonaktifkan), agar riwayat kontrak/tagihan tetap utuh.
CREATE TRIGGER trg_ppk_vendors_nodel BEFORE DELETE ON ppk_vendors BEGIN SELECT RAISE(ABORT, 'Penyedia tidak boleh dihapus; arsipkan saja.'); END;

INSERT INTO ppk_funding_sources (id, code, name, payment_channel, created_at, updated_at) VALUES
 (lower(hex(randomblob(16))), 'RM', 'Rupiah Murni', 'SAKTI', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (lower(hex(randomblob(16))), 'PNBP', 'Penerimaan Negara Bukan Pajak', 'SAKTI', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 (lower(hex(randomblob(16))), 'BLU', 'Badan Layanan Umum', 'FO', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO ppk_tax_rates (id, valid_from, ppn_bp, pph23_bp, note, created_at) VALUES
 (lower(hex(randomblob(16))), '2022-04-01', 1100, 200, 'PPN 11% (UU HPP), PPh 23 2%', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO ppk_fiscal_years (id, year, created_at, updated_at) VALUES
 (lower(hex(randomblob(16))), 2026, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));`
  },
  {
    version: 9,
    name: 'ppk_budget_contracts',
    sql: `
-- Modul PPK, tahap 2: anggaran dan kontrak. Hanya menambah tabel. Rupiah = INTEGER. Nilai turunan dihitung query.
-- Baris anggaran: pembeda = TA + MAK + detail rincian output + sumber dana + jenis (jawaban C: MAK bisa sama untuk pagu DIPA dan saldo kas).
CREATE TABLE ppk_budget_lines (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL REFERENCES ppk_fiscal_years(id),
  unit_id TEXT NOT NULL REFERENCES ppk_units(id),
  program_id TEXT NOT NULL REFERENCES ppk_programs(id),
  activity_id TEXT NOT NULL REFERENCES ppk_activities(id),
  budget_account_id TEXT NOT NULL REFERENCES ppk_budget_accounts(id),
  output_detail TEXT NOT NULL DEFAULT '',
  funding_source_id TEXT NOT NULL REFERENCES ppk_funding_sources(id),
  kind TEXT NOT NULL CHECK (kind IN ('dipa','saldo_kas')),
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (fiscal_year_id, budget_account_id, output_detail, funding_source_id, kind)
);
CREATE INDEX idx_ppk_bl_year ON ppk_budget_lines(fiscal_year_id, program_id);
CREATE TRIGGER trg_ppk_bl_nodel BEFORE DELETE ON ppk_budget_lines BEGIN SELECT RAISE(ABORT, 'Baris anggaran tidak boleh dihapus; nonaktifkan saja.'); END;

-- Riwayat pagu (awal, revisi): append-only. Pagu terakhir = versi tertinggi. Koreksi = revisi baru, bukan menimpa.
CREATE TABLE ppk_budget_versions (
  id TEXT PRIMARY KEY,
  budget_line_id TEXT NOT NULL REFERENCES ppk_budget_lines(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('awal','revisi')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  effective_date TEXT NOT NULL,
  source_document TEXT NOT NULL CHECK (length(trim(source_document)) > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (budget_line_id, version_no),
  CHECK ((version_no = 1) = (kind = 'awal'))
);
CREATE TRIGGER trg_ppk_bv_noupd BEFORE UPDATE ON ppk_budget_versions BEGIN SELECT RAISE(ABORT, 'Riwayat pagu tidak boleh diubah; catat revisi baru.'); END;
CREATE TRIGGER trg_ppk_bv_nodel BEFORE DELETE ON ppk_budget_versions BEGIN SELECT RAISE(ABORT, 'Riwayat pagu tidak boleh dihapus; catat revisi baru.'); END;

-- Kontrak induk per penyedia + paket (jawaban no. 6). Nilai kontrak terakhir = nilai awal + perubahan nilai addendum yang sah.
CREATE TABLE ppk_contracts (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL REFERENCES ppk_fiscal_years(id),
  unit_id TEXT NOT NULL REFERENCES ppk_units(id),
  vendor_id TEXT NOT NULL REFERENCES ppk_vendors(id),
  program_id TEXT NOT NULL REFERENCES ppk_programs(id),
  activity_id TEXT NOT NULL REFERENCES ppk_activities(id),
  service_package_id TEXT REFERENCES ppk_service_packages(id),
  contract_type TEXT NOT NULL DEFAULT 'biasa' CHECK (contract_type IN ('biasa','kpbu')),
  contract_number TEXT NOT NULL UNIQUE CHECK (length(trim(contract_number)) > 0),
  vendor_contract_number TEXT NOT NULL DEFAULT '',
  contract_date TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  initial_value INTEGER NOT NULL CHECK (initial_value >= 0),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  is_multi_year INTEGER NOT NULL DEFAULT 0 CHECK (is_multi_year IN (0,1)),
  term_start TEXT, term_end TEXT,
  prior_year_paid INTEGER NOT NULL DEFAULT 0 CHECK (prior_year_paid >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','aktif','selesai','dibatalkan')),
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start)
);
CREATE INDEX idx_ppk_contracts_vendor ON ppk_contracts(vendor_id);
CREATE INDEX idx_ppk_contracts_year ON ppk_contracts(fiscal_year_id, status);
CREATE TRIGGER trg_ppk_contracts_nodel BEFORE DELETE ON ppk_contracts BEGIN SELECT RAISE(ABORT, 'Kontrak tidak boleh dihapus; ubah status menjadi dibatalkan.'); END;

-- Addendum terpisah dari kontrak, tidak pernah menimpa nilai awal. Salah catat = dibatalkan (void) dengan alasan, bukan dihapus.
CREATE TABLE ppk_contract_addendums (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES ppk_contracts(id),
  addendum_number TEXT NOT NULL CHECK (length(trim(addendum_number)) > 0),
  addendum_date TEXT NOT NULL,
  value_change INTEGER NOT NULL DEFAULT 0,
  period_start TEXT, period_end TEXT, new_end_date TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  voided_at TEXT, voided_by TEXT, void_reason TEXT,
  UNIQUE (contract_id, addendum_number),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX idx_ppk_add_contract ON ppk_contract_addendums(contract_id);
CREATE TRIGGER trg_ppk_add_nodel BEFORE DELETE ON ppk_contract_addendums BEGIN SELECT RAISE(ABORT, 'Addendum tidak boleh dihapus; batalkan dengan alasan.'); END;
CREATE TRIGGER trg_ppk_add_upd BEFORE UPDATE ON ppk_contract_addendums
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
  OR NEW.contract_id IS NOT OLD.contract_id OR NEW.addendum_number IS NOT OLD.addendum_number OR NEW.addendum_date IS NOT OLD.addendum_date
  OR NEW.value_change IS NOT OLD.value_change OR NEW.period_start IS NOT OLD.period_start OR NEW.period_end IS NOT OLD.period_end
  OR NEW.new_end_date IS NOT OLD.new_end_date OR NEW.description IS NOT OLD.description
BEGIN SELECT RAISE(ABORT, 'Addendum hanya dapat dibatalkan sekali; isinya tidak dapat diubah.'); END;

-- Jadwal nilai per bulan (rencana).
CREATE TABLE ppk_contract_schedules (
  contract_id TEXT NOT NULL REFERENCES ppk_contracts(id),
  month TEXT NOT NULL CHECK (length(month) = 7),
  planned_amount INTEGER NOT NULL CHECK (planned_amount >= 0),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, month)
);

-- Pembebanan kontrak ke baris anggaran (sumber dana + MAK). Satu kontrak bisa ke beberapa baris anggaran.
CREATE TABLE ppk_contract_funding_allocations (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES ppk_contracts(id),
  budget_line_id TEXT NOT NULL REFERENCES ppk_budget_lines(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (contract_id, budget_line_id)
);
CREATE INDEX idx_ppk_cfa_line ON ppk_contract_funding_allocations(budget_line_id);`
  },
  {
    version: 10,
    name: 'ppk_bills_payments',
    sql: `
-- Modul PPK, tahap 3: tagihan dan pembayaran. Hanya menambah tabel.
-- Tagihan per bulan layanan. Nilai = bagian kena pajak (termasuk PPN) + pass-through (tanpa pajak).
-- Pajak disimpan sesuai faktur (jawaban no. 12); usulan sistem hanya pembanding. Setelah diverifikasi, isi terkunci; koreksi = batalkan + tagihan baru.
CREATE TABLE ppk_bills (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES ppk_contracts(id),
  bill_number TEXT NOT NULL CHECK (length(trim(bill_number)) > 0),
  bill_date TEXT NOT NULL,
  received_date TEXT,
  service_month TEXT NOT NULL CHECK (length(service_month) = 7),
  period_start TEXT, period_end TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  pass_through INTEGER NOT NULL DEFAULT 0 CHECK (pass_through >= 0),
  faktur_code TEXT CHECK (faktur_code IN ('02','04')),
  faktur_number TEXT NOT NULL DEFAULT '',
  tax_rate_id TEXT REFERENCES ppk_tax_rates(id),
  dpp INTEGER NOT NULL CHECK (dpp >= 0),
  ppn INTEGER NOT NULL CHECK (ppn >= 0),
  pph23 INTEGER NOT NULL CHECK (pph23 >= 0),
  deduction INTEGER NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  deduction_reason TEXT NOT NULL DEFAULT '',
  fx_rate TEXT NOT NULL DEFAULT '',
  fx_amount TEXT NOT NULL DEFAULT '',
  ba_number TEXT NOT NULL DEFAULT '',
  ba_date TEXT,
  official_id TEXT REFERENCES ppk_officials(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diverifikasi','dibatalkan')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (contract_id, bill_number),
  CHECK (ppn + pph23 + deduction <= amount + pass_through),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX idx_ppk_bills_contract ON ppk_bills(contract_id, service_month);
CREATE TRIGGER trg_ppk_bills_nodel BEFORE DELETE ON ppk_bills BEGIN SELECT RAISE(ABORT, 'Tagihan tidak boleh dihapus; batalkan dengan alasan.'); END;
CREATE TRIGGER trg_ppk_bills_lock BEFORE UPDATE ON ppk_bills
WHEN OLD.status = 'dibatalkan'
  OR (OLD.status = 'diverifikasi' AND (NEW.status <> 'dibatalkan' OR length(trim(NEW.cancel_reason)) = 0
    OR NEW.contract_id IS NOT OLD.contract_id OR NEW.bill_number IS NOT OLD.bill_number OR NEW.bill_date IS NOT OLD.bill_date
    OR NEW.service_month IS NOT OLD.service_month OR NEW.amount IS NOT OLD.amount OR NEW.pass_through IS NOT OLD.pass_through
    OR NEW.faktur_code IS NOT OLD.faktur_code OR NEW.dpp IS NOT OLD.dpp OR NEW.ppn IS NOT OLD.ppn OR NEW.pph23 IS NOT OLD.pph23
    OR NEW.deduction IS NOT OLD.deduction))
BEGIN SELECT RAISE(ABORT, 'Tagihan terverifikasi atau dibatalkan tidak dapat diubah; batalkan lalu buat tagihan baru.'); END;

-- Pembagian nilai tagihan ke baris anggaran (satu tagihan bisa RM + BLU). Hanya dapat diubah selama tagihan draf.
CREATE TABLE ppk_bill_funding (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES ppk_bills(id),
  budget_line_id TEXT NOT NULL REFERENCES ppk_budget_lines(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  UNIQUE (bill_id, budget_line_id)
);
CREATE INDEX idx_ppk_bf_line ON ppk_bill_funding(budget_line_id);
CREATE TRIGGER trg_ppk_bf_ins BEFORE INSERT ON ppk_bill_funding WHEN (SELECT status FROM ppk_bills WHERE id = NEW.bill_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'Sumber dana tagihan terkunci setelah diverifikasi.'); END;
CREATE TRIGGER trg_ppk_bf_upd BEFORE UPDATE ON ppk_bill_funding BEGIN SELECT RAISE(ABORT, 'Sumber dana tagihan tidak diubah; ganti selama draf.'); END;
CREATE TRIGGER trg_ppk_bf_del BEFORE DELETE ON ppk_bill_funding WHEN (SELECT status FROM ppk_bills WHERE id = OLD.bill_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'Sumber dana tagihan terkunci setelah diverifikasi.'); END;

-- Pembayaran per porsi sumber dana: RM/PNBP lewat SAKTI (nomor dan tanggal SP2D), BLU lewat FO. Salah catat = dibatalkan, bukan dihapus.
CREATE TABLE ppk_payments (
  id TEXT PRIMARY KEY,
  bill_funding_id TEXT NOT NULL REFERENCES ppk_bill_funding(id),
  channel TEXT NOT NULL CHECK (channel IN ('SAKTI','FO','LAINNYA')),
  reference_number TEXT NOT NULL CHECK (length(trim(reference_number)) > 0),
  payment_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE UNIQUE INDEX uq_ppk_pay_active ON ppk_payments(bill_funding_id) WHERE voided_at IS NULL;
CREATE TRIGGER trg_ppk_pay_nodel BEFORE DELETE ON ppk_payments BEGIN SELECT RAISE(ABORT, 'Pembayaran tidak boleh dihapus; batalkan dengan alasan.'); END;
CREATE TRIGGER trg_ppk_pay_upd BEFORE UPDATE ON ppk_payments
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR length(trim(COALESCE(NEW.void_reason, ''))) = 0
  OR NEW.bill_funding_id IS NOT OLD.bill_funding_id OR NEW.channel IS NOT OLD.channel OR NEW.reference_number IS NOT OLD.reference_number
  OR NEW.payment_date IS NOT OLD.payment_date OR NEW.amount IS NOT OLD.amount
BEGIN SELECT RAISE(ABORT, 'Pembayaran hanya dapat dibatalkan sekali dengan alasan; isinya tidak dapat diubah.'); END;`
  },
  {
    version: 11,
    name: 'ppk_rpd_sp2d_multiyear',
    sql: `
-- Modul PPK, tahap 5: RPD, rekonsiliasi SP2D, nilai kontrak tahun jamak per tahun anggaran. Hanya menambah tabel.
-- RPD (rencana penarikan dana) per baris anggaran per bulan. Rencana, bukan data keuangan final: diganti utuh, perubahan tercatat di audit.
CREATE TABLE ppk_budget_plans (
  budget_line_id TEXT NOT NULL REFERENCES ppk_budget_lines(id),
  month TEXT NOT NULL CHECK (length(month) = 7),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_line_id, month)
);

-- SP2D menurut SAKTI (dicatat dari laporan SAKTI) untuk dicocokkan dengan pembayaran di aplikasi lewat nomor SP2D.
-- Data keuangan: tidak dihapus atau diubah; salah catat = batalkan dengan alasan lalu catat ulang.
CREATE TABLE ppk_sp2d_records (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL REFERENCES ppk_fiscal_years(id),
  sp2d_number TEXT NOT NULL CHECK (length(trim(sp2d_number)) > 0),
  sp2d_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE UNIQUE INDEX uq_ppk_sp2d_active ON ppk_sp2d_records(fiscal_year_id, sp2d_number) WHERE voided_at IS NULL;
CREATE TRIGGER trg_ppk_sp2d_nodel BEFORE DELETE ON ppk_sp2d_records BEGIN SELECT RAISE(ABORT, 'Data SP2D tidak boleh dihapus; batalkan dengan alasan.'); END;
CREATE TRIGGER trg_ppk_sp2d_upd BEFORE UPDATE ON ppk_sp2d_records
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR length(trim(COALESCE(NEW.void_reason, ''))) = 0
  OR NEW.fiscal_year_id IS NOT OLD.fiscal_year_id OR NEW.sp2d_number IS NOT OLD.sp2d_number OR NEW.sp2d_date IS NOT OLD.sp2d_date OR NEW.amount IS NOT OLD.amount
BEGIN SELECT RAISE(ABORT, 'Data SP2D hanya dapat dibatalkan sekali dengan alasan; isinya tidak dapat diubah.'); END;
CREATE INDEX idx_ppk_pay_ref ON ppk_payments(reference_number);

-- Kontrak tahun jamak: nilai estimasi per tahun anggaran (mis. SATRIA-1 15 tahun). Dipakai prognosis tahun itu.
CREATE TABLE ppk_contract_year_values (
  contract_id TEXT NOT NULL REFERENCES ppk_contracts(id),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, year)
);`
  },
  {
    version: 12,
    name: 'invitation_whatsapp',
    sql: `
-- Distribusi surat undangan lewat WhatsApp (modul dokumen, selalu lokal). Hanya menambah tabel; disetujui pemilik 2026-11-26.
-- Penerima per surat undangan. Nomor disimpan sebagai digit E.164 tanpa '+'.
CREATE TABLE invitation_recipients (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 8 AND 15 AND phone NOT GLOB '*[^0-9]*'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (document_id, phone)
);
-- Riwayat pengiriman, append-only: setiap perubahan status = baris baru. Tanpa FK ke dokumen agar riwayat tetap ada bila dokumen dihapus.
-- whatsapp_opened = chat dibuka (click-to-chat); sent/delivered/read hanya dari konfirmasi WhatsApp Business API.
CREATE TABLE invitation_delivery_logs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('wa_desktop','wa_web','cloud_api')),
  status TEXT NOT NULL CHECK (status IN ('whatsapp_opened','submitted','sent','delivered','read','failed')),
  pdf_sha256 TEXT, provider_message_id TEXT, error TEXT,
  actor_id TEXT, actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_inv_log_doc ON invitation_delivery_logs(document_id, created_at);
CREATE INDEX idx_inv_log_msg ON invitation_delivery_logs(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TRIGGER trg_inv_log_noupd BEFORE UPDATE ON invitation_delivery_logs BEGIN SELECT RAISE(ABORT, 'Riwayat pengiriman bersifat append-only.'); END;
CREATE TRIGGER trg_inv_log_nodel BEFORE DELETE ON invitation_delivery_logs BEGIN SELECT RAISE(ABORT, 'Riwayat pengiriman bersifat append-only.'); END;`
  },
  {
    version: 13,
    name: 'ppk_agendas',
    sql: `
-- Agenda PPK dari surat undangan (ikut ke server PPK bila mode server). Hanya menambah tabel; disetujui pemilik 2026-11-26.
-- source_document_id tanpa FK: dokumen tetap lokal di komputer pembuat. Hari dihitung dari tanggal, tidak disimpan.
CREATE TABLE ppk_agendas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  letter_number TEXT NOT NULL DEFAULT '',
  source_document_id TEXT,
  agenda_date TEXT NOT NULL CHECK (length(agenda_date) = 10),
  start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '', meeting_url TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL DEFAULT '', agenda_text TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'terjadwal' CHECK (status IN ('terjadwal','selesai','dibatalkan')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (start_time = '' OR end_time = '' OR end_time >= start_time)
);
CREATE INDEX idx_ppk_agendas_date ON ppk_agendas(agenda_date);
CREATE TRIGGER trg_ppk_agendas_nodel BEFORE DELETE ON ppk_agendas BEGIN SELECT RAISE(ABORT, 'Agenda tidak boleh dihapus; batalkan dengan alasan.'); END;
-- Penanggung jawab utama (tepat satu) dan staf pendukung. Diganti utuh saat agenda diubah; perubahan tercatat di audit.
CREATE TABLE ppk_agenda_assignees (
  agenda_id TEXT NOT NULL REFERENCES ppk_agendas(id),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('utama','pendukung')),
  PRIMARY KEY (agenda_id, user_id)
);
CREATE UNIQUE INDEX uq_ppk_agenda_utama ON ppk_agenda_assignees(agenda_id) WHERE role = 'utama';`
  },
  {
    version: 14,
    name: 'ppk_agenda_center',
    sql: `
-- Agenda Center: undangan masuk (WhatsApp/unggah), file, hasil ekstraksi, nomor WA staf, notifikasi. Hanya menambah; disetujui pemilik 2026-11-27.
-- Undangan belum terverifikasi tidak pernah menjadi agenda; agenda hanya lahir dari verifikasi staf.
CREATE TABLE ppk_invitations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('whatsapp','unggah')),
  wa_message_id TEXT UNIQUE,
  sender_phone TEXT NOT NULL DEFAULT '', sender_name TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL, message_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','diproses','menunggu_verifikasi','dikonversi','gagal','ditolak','diarsipkan')),
  error_message TEXT NOT NULL DEFAULT '', duplicate_of TEXT,
  verified_by TEXT, verified_at TEXT, reject_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_ppk_inv_status ON ppk_invitations(status, received_at);
CREATE TRIGGER trg_ppk_inv_nodel BEFORE DELETE ON ppk_invitations BEGIN SELECT RAISE(ABORT, 'Undangan tidak boleh dihapus; arsipkan saja.'); END;
-- File asli (undangan, kelak laporan rapat). Tidak bisa diubah atau dihapus; batas 20 MB.
CREATE TABLE ppk_files (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('undangan','laporan')), owner_id TEXT NOT NULL,
  filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64), content BLOB NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_ppk_files_owner ON ppk_files(owner_type, owner_id);
CREATE INDEX idx_ppk_files_sha ON ppk_files(sha256);
CREATE TRIGGER trg_ppk_files_noupd BEFORE UPDATE ON ppk_files BEGIN SELECT RAISE(ABORT, 'File asli tidak boleh diubah.'); END;
CREATE TRIGGER trg_ppk_files_nodel BEFORE DELETE ON ppk_files BEGIN SELECT RAISE(ABORT, 'File asli tidak boleh dihapus.'); END;
-- Satu baris per percobaan ekstraksi (append-only). confidence = 0..100.
CREATE TABLE ppk_invitation_extractions (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES ppk_invitations(id),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', prompt_version TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  missing_fields_json TEXT NOT NULL DEFAULT '[]', error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (invitation_id, attempt)
);
CREATE TRIGGER trg_ppk_ext_noupd BEFORE UPDATE ON ppk_invitation_extractions BEGIN SELECT RAISE(ABORT, 'Hasil ekstraksi bersifat append-only.'); END;
CREATE TRIGGER trg_ppk_ext_nodel BEFORE DELETE ON ppk_invitation_extractions BEGIN SELECT RAISE(ABORT, 'Hasil ekstraksi bersifat append-only.'); END;
-- Nomor WhatsApp staf: hanya pengirim terdaftar yang diproses AI.
CREATE TABLE ppk_user_phones (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id),
  phone TEXT NOT NULL UNIQUE, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Pusat notifikasi internal (tanpa pesan WhatsApp keluar).
CREATE TABLE ppk_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  entity TEXT NOT NULL DEFAULT '', entity_id TEXT,
  created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX idx_ppk_notif_user ON ppk_notifications(user_id, read_at);
ALTER TABLE ppk_agendas ADD COLUMN invitation_id TEXT REFERENCES ppk_invitations(id);
ALTER TABLE ppk_agendas ADD COLUMN letter_date TEXT;
ALTER TABLE ppk_agendas ADD COLUMN program_id TEXT REFERENCES ppk_programs(id);
ALTER TABLE ppk_agendas ADD COLUMN participants TEXT NOT NULL DEFAULT '';
ALTER TABLE ppk_agendas ADD COLUMN verified_by TEXT;
ALTER TABLE ppk_agendas ADD COLUMN verified_at TEXT;
ALTER TABLE ppk_agendas ADD COLUMN archived_at TEXT;
CREATE INDEX idx_ppk_agendas_inv ON ppk_agendas(invitation_id);
CREATE INDEX idx_ppk_agendas_prog ON ppk_agendas(program_id);
ALTER TABLE ppk_agenda_assignees ADD COLUMN duty TEXT NOT NULL DEFAULT '';
ALTER TABLE ppk_agenda_assignees ADD COLUMN status TEXT NOT NULL DEFAULT 'ditugaskan' CHECK (status IN ('ditugaskan','diterima','selesai'));`
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
