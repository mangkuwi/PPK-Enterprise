# SRS Ringkas – NASKAHDINAS AI

## 1. Tujuan & ruang lingkup
Aplikasi desktop Windows 10/11 64-bit offline untuk pegawai pemerintahan membuat naskah dinas dari template, mengedit, mengarsipkan, dan mengekspor ke DOCX/PDF.
Prinsip: **CREATE ONCE, REUSE FOREVER**. Tanpa login, tanpa iklan, data lokal.

## 2. Kebutuhan fungsional (kode modul → file utama)
| ID | Kebutuhan | Implementasi |
|---|---|---|
| F1 | Dashboard (total dokumen/template, bulan ini, terakhir, tombol cepat, template favorit) | `pages/DashboardPage`, `repo.getStats` |
| F2 | CRUD/duplikasi/pencarian/favorit/preview/import/export template, 10 kategori bawaan | `TemplatesPage`, `TemplateEditorPage`, `repo.*Template*`, `seed.ts` |
| F3 | Placeholder engine: deteksi otomatis, form dinamis (text/textarea/date/select/richtext/number), opsional, default, penanda belum terisi | `shared/placeholder.ts`, `FieldInput`, `PlaceholderHighlight` |
| F4 | Alur generator: kategori → template → isi → Generate → edit → simpan/export; Regenerate, Save as Draft/New, Reset, Preview, Duplicate | `GeneratorPage`, `Workbench` |
| F5 | Editor TipTap: B/I/U/S, font & ukuran, rata, daftar, indentasi, tabel, gambar, header/footer, page break, undo/redo, cari-ganti, kertas A4, margin & spasi | `features/editor/*` |
| F6 | Arsip: status Draft/Dalam Pemeriksaan/Final, search, filter kategori/tanggal, sort, buka/duplikat/hapus/export ulang, versi dokumen | `ArchivePage`, `repo.*Document*`, `document_versions` |
| F7 | Export DOCX/PDF/Cetak, pilih lokasi, penamaan otomatis, preview | `docx-export.ts`, `pdf.ts`, `ipc/files.ts`, `shared/filename.ts` |
| F8 | Pengaturan: instansi, logo, alamat, kop, identitas pengirim, font/margin default, lokasi, backup | `SettingsPage`, `ipc/settings.ts` |
| F9 | Backup/restore penuh & parsial dengan konfirmasi, backup otomatis sebelum restore dan sebelum migrasi | `backup.ts`, `ipc/files.ts` |
| F10 | Arsitektur AI opsional dengan guardrail | `ipc/settings.ts (ai:run)`, `shared/ai-guard.ts` |

## 3. Kebutuhan non-fungsional
Offline penuh; tanpa Node.js di komputer pengguna; keamanan Electron (lihat README §5); data & backup portabel; antarmuka navy/putih/abu-abu bergaya korporat pemerintahan.

## 4. Arsitektur
```
┌──────────── Renderer (React, sandbox, CSP) ────────────┐
│ pages → features → components/ui → services/api.ts     │
└───────────────┬───────────────────────────────────────┘
                │ window.api.invoke(channel, payload)   (preload: daftar putih channel)
┌───────────────▼────────────── Main (Node) ────────────┐
│ ipc/handle.ts: verifikasi pengirim + zod + envelope   │
│ ipc/{data,files,settings}.ts → main/{repo,backup,docx-export,pdf,database}.ts │
│ SQLite (better-sqlite3)  ·  docx  ·  printToPDF       │
└───────────────────────────────────────────────────────┘
shared/ (logika murni, dipakai kedua sisi & test)
```
Keputusan: dokumen menyimpan **snapshot** isi (bukan referensi template) → template dapat diubah/dihapus tanpa memengaruhi dokumen lama.
Isi dokumen = JSON TipTap; konversi ke HTML (`shared/render.ts`) dan DOCX (`docx-export.ts`) dari satu sumber.

## 5. Skema database (SQLite, migrasi `PRAGMA user_version`)
```
categories(id, name UNIQUE, code, sort_order, is_default, created_at, updated_at)
templates(id, category_id→categories SET NULL, name, description, content_json, header_text, footer_text, layout_json, is_favorite, is_active, created_at, updated_at)
template_fields(id, template_id→templates CASCADE, key, label, type, required, default_value, options_json, sort_order, UNIQUE(template_id,key))
documents(id, template_id→templates SET NULL, template_name, category_id→categories SET NULL, title, letter_number, recipient, subject, doc_date,
          status CHECK(draft|review|final), content_json, content_text, header_text, footer_text, layout_json, form_values_json, use_kop, created_at, updated_at)
document_versions(id, document_id→documents CASCADE, version_no, title, content_json, note, created_at, UNIQUE(document_id,version_no))
settings(key PK, value, updated_at)          backup_history(id, path, size_bytes, type, note, created_at)
```
ID berupa UUID teks sehingga backup parsial dapat digabung tanpa bentrok.

## 5b. Penomoran & Register (migrasi v5; penomoran harian DDSS: v6; Bank Nomor/number pool: v7)
Tabel: `app_users`, `number_registers`, `number_register_config_history`, `number_daily_counters` (PK register+tanggal dokumen; `number_counters` tahunan v5 diarsipkan, tidak dipakai), `number_records` (kolom `day`, `seq` harian, `seq_scheme` daily/legacy, `legacy_seq`; UNIQUE register+tanggal+urut dan register+tanggal+nomor), `number_batches` (batch pembuatan, append-only), `number_events`, `number_imports`, `document_number_refs`, `register_category_map`, `register_template_map`, `audit_log`.
Aturan: nomor dialokasikan di mesin (`electron/main/numbering/engine.ts`) = max(awal terkonfigurasi, penghitung harian, nomor urut tertinggi tercatat pada tanggal itu + 1) dalam satu transaksi `IMMEDIATE` (dengan ulang-coba bila UNIQUE bentrok dan busy_timeout) untuk kunci kategori + tanggal dokumen; batas 10^panjang_urut−1 (99) → galat LIMIT tanpa pemotongan; catatan lama (v5) dimigrasi sebagai `legacy` tanpa mengubah nomor/tanggal dan tidak memengaruhi urutan harian; status AVAILABLE/ASSIGNED/ISSUED/VOID dengan transisi dibatasi trigger DB (available→assigned|void, assigned→available|issued; issued/void final); pembuatan nomor dipisah dari pemakaian: `generateBatch` (atomik, pratinjau + deteksi pratinjau basi) lalu `assignNumber` (UPDATE bersyarat, atomik), `releaseNumber`, `issueNumber`, `voidNumber` (admin, alasan wajib); tidak ada penghapusan/daur ulang; riwayat penugasan diturunkan dari `number_events` + `audit_log`; migrasi v7 memetakan data lama tanpa asumsi (lihat README 3b); AI tidak berinteraksi dengan modul penomoran.
Integrasi: `integration.ts` (konteks template→register, `selectNumber` ganti-nomor atomik, `releaseDraft`, `applyToValues` memaksa nomor/tanggal/rujukan, `bindDocument` menautkan dokumen, hook finalisasi/hapus). IPC: `electron/ipc/numbering.ts`; hook di `documents:save/delete/setStatus` dan `importer:generate/regenerate`.

## 4b. Wireframe (ASCII)
```
Dashboard                                   Generator (hasil)
┌────────┬──────────────────────────────┐   ┌────────┬──────────────────────────────┬──────────────┐
│Sidebar │ [Nota Dinas][Undangan][Baru] │   │Sidebar │ [Nama dokumen........][Status]│ Informasi    │
│navy    │ [Dok][Tmpl][Bulan][Terakhir] │   │        │ [Simpan][Baru][Preview][DOCX]│ arsip, kop,  │
│        │ Favorit │ Dokumen terbaru    │   │        │ ── toolbar editor ─────────── │ header/footer│
└────────┴──────────────────────────────┘   │        │        ┌── kertas A4 ──┐     │ font, margin │
                                            └────────┴────────└───────────────┘─────┴──────────────┘
```

## 6. Roadmap & status fase
| Fase | Isi | Status |
|---|---|---|
| 1 Fondasi | repo, Electron+React+TS+Vite+Tailwind, DB+migrasi, UI, skrip build/installer | kode selesai |
| 2 Template | CRUD, kategori, placeholder engine, import/export | kode selesai; engine & DB terverifikasi di Linux |
| 3 Generator | form dinamis, generate, editor, preview | kode selesai; belum diuji UI |
| 4 Dokumen | arsip, pencarian, filter, versi | kode selesai; query terverifikasi di Linux |
| 5 Export | DOCX, PDF, cetak, validasi format | kode selesai; uji buka di Word **belum** |
| 6 Backup & keamanan | backup/restore, error handling, hardening | kode selesai; belum diuji di Windows |
| 7 Test & rilis | test otomatis, installer NSIS/portable | test ditulis; build `.exe` **belum** dijalankan |

## Lampiran: Smart Template Importer
Lihat `docs/SMART-IMPORTER-PLAN.md` (arsitektur, keputusan, batasan) dan README bagian "Smart Template Importer".
Tabel baru (migrasi v2): `imported_templates`, `template_mappings`, `template_assets`; kolom baru `templates.kind`, `documents.source_kind/docx_blob/docx_state`.
Modul: `electron/main/ooxml/*` (zip, scan, fill, analyze, adapt, inspect), `electron/main/importer-service.ts`, `electron/ipc/importer.ts`, UI `src/pages/Importer*`, `src/features/importer/*`.
