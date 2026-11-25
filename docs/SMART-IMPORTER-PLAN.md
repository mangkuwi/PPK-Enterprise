# Rencana Implementasi – Smart Template Importer

## Keputusan arsitektur
- **DOCX asli = basis.** Berkas sumber disimpan tanpa modifikasi (BLOB di SQLite + trigger yang menolak `UPDATE` pada kolom itu).
  *Template teradaptasi* = salinan sumber yang teks terpetanya diganti penanda `{{KEY}}` langsung pada XML.
  *Dokumen hasil* = salinan template teradaptasi dengan penanda diisi nilai formulir. Berkas template/sumber tidak pernah diubah saat generate.
- **Tanpa parser–serializer XML.** XML dipindai sebagai teks mentah; hanya isi elemen `<w:t>` yang disentuh. Byte lain (rPr, pPr, tabel, section, header/footer)
  tidak berubah. Entri zip yang tidak diubah (gambar, styles, settings, …) disalin **byte-per-byte** (data terkompresi asli dipakai ulang).
- **Teks terpecah di banyak run:** teks paragraf digabung dan dipetakan kembali ke segmen `<w:t>`; penggantian menaruh hasil di run pertama
  (format run pertama) dan mengosongkan sisa potongan, tanpa meratakan run.
- **Analisis heuristik deterministik** (label–nilai, nomor surat, tanggal Indonesia, jam, NIP/nama/jabatan penandatangan, isian titik-titik, penanda eksplisit)
  dengan *confidence score*. `auto` (≥0,75) diterapkan otomatis; `confirm` baru diterapkan setelah dikonfirmasi pengguna; semuanya dapat dikoreksi. Tanpa AI.
- **Dua jenis template, satu pustaka:** `templates.kind = 'editor' | 'docx'`.
- **Dokumen hasil `docx`:** disimpan sebagai BLOB asli + rendisi TipTap untuk pratinjau. Selama tidak diedit di editor (`docx_state = pristine`) export DOCX
  memakai berkas asli; bila diedit di editor, export memakai rendisi editor dan pengguna diperingatkan. "Perbarui dari Formulir" membuat ulang DOCX asli.
- **PDF:** dari DOCX asli lewat LibreOffice bila terpasang (opsional, offline); tanpa itu PDF dari rendisi editor dan diberi catatan perkiraan.
- Backup penuh otomatis menyertakan semua BLOB (semuanya ada di database).

## Tahapan
| # | Tahap | Isi |
|---|---|---|
| A | Data | migrasi v2: `imported_templates`, `template_mappings`, `template_assets`, `templates.kind`, `documents.source_kind/docx_blob/docx_state`, trigger sumber-immutable |
| B | Mesin OOXML | `ooxml/zip.ts`, `scan.ts`, `fill.ts`, `signature.ts` |
| C | Analyzer | `ooxml/analyze.ts` |
| D | Backend | `importer-repo.ts`, `ipc/importer.ts`, integrasi generate/export/backup |
| E | UI | Smart Importer: Upload, Review Mapping (3 panel), Bandingkan, Imported Templates, Riwayat; integrasi Generator & Workbench |
| F | Uji | unit + integrasi, sample DOCX 9 variasi, regresi visual via LibreOffice |

## Di luar cakupan tahap ini (jujur)
- **PDF sebagai sumber & OCR:** belum — butuh pustaka ekstraksi PDF/OCR yang tidak dapat diuji offline.
- **`.doc` lama:** hanya bila LibreOffice terpasang (konversi lokal); tanpa itu diminta menyimpan ulang sebagai `.docx`.
- Penggantian hanya untuk teks di `<w:t>`; kotak teks/field kompleks tetap dipertahankan apa adanya.

## Status implementasi
| Tahap | Status |
|---|---|
| A Data (migrasi v2) | selesai, diuji (tests/importer.test.ts) |
| B Mesin OOXML (zip/scan/fill/inspect) | selesai, diuji pada 9 fixture + regresi visual LibreOffice (selisih piksel 0 untuk 8/9; fixture 09 sengaja memakai format campuran) |
| C Analyzer + adapt | selesai, diuji |
| D Backend + IPC | selesai; layer IPC/Electron (`electron/ipc/importer.ts`, `soffice.ts`) belum dijalankan di Electron |
| E UI | selesai ditulis; belum dijalankan/dilihat di Electron |
| F Tes | `tests/ooxml.test.ts`, `tests/importer.test.ts` |
