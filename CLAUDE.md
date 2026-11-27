# NASKAHDINAS AI + PPK Management

Aplikasi desktop Windows offline (Electron + React + TypeScript + SQLite). Bahasa UI dan pesan error: Bahasa Indonesia. Mata uang: Rupiah.

## Perintah
- `npm install` lalu `npm run typecheck`, `npm run lint`, `npx vitest run` (semua test, termasuk DB; perlu `npm rebuild better-sqlite3` untuk Node bila modul dipasang untuk Electron).
- `npm run test:db` menjalankan test DB lalu mengembalikan better-sqlite3 ke ABI Electron.
- `npm run dist` hanya di Windows.

## Arsitektur (ikuti, jangan diganti)
- Renderer (`src/`) hanya memanggil `src/services/api.ts` → `window.api.invoke`. Tidak ada akses Node/DB di renderer.
- Setiap channel baru: tambah di `shared/channels.ts`, daftarkan dengan `handle()` (`electron/ipc/handle.ts`) + skema zod.
- Logika domain = fungsi yang menerima `db` di `electron/main/**`; logika murni di `shared/**` agar bisa diuji tanpa DB.
- Database: better-sqlite3, SQL tulisan tangan, migrasi bernomor di `electron/main/migrations.ts` (`PRAGMA user_version`). Tanpa ORM (Prisma sengaja tidak dipakai).
- Migrasi hanya menambah; perubahan tabel lama = tabel baru + salin + rename, dan wajib persetujuan pemilik.
- Riwayat dan log bersifat append-only (trigger). Catat perubahan lewat `audit()` (`electron/main/numbering/audit.ts`).

## Modul PPK
- Kode: `shared/ppk/` (murni), `electron/main/ppk/` (domain + data), `electron/ipc/ppk.ts`, `src/pages/ppk/`.
- Tabel berawalan `ppk_`. Jangan mengubah tabel modul dokumen/penomoran untuk kebutuhan PPK.
- Rupiah = bilangan bulat (`INTEGER`), tidak pernah float. Kurs/valas = teks desimal.
- Nilai turunan (sisa kontrak, sisa pagu, realisasi) dihitung query, tidak disimpan.
- Data keuangan final tidak diubah; koreksi = baris penyesuaian + audit (`before`/`after`).
- Setiap channel `ppk:*` wajib cek izin (`requirePpk`). Modul PPK tidak boleh memanggil AI, kecuali pembaca undangan Agenda Center (disetujui pemilik 2026-11-27): AI hanya dipanggil dari Gateway (`gateway/`), hasilnya hanya draf yang wajib diverifikasi staf, dan tidak pernah untuk data keuangan.
- SQL PPK ditulis portabel (rencana PostgreSQL di Tahap 6): hindari fungsi khusus SQLite di query domain.
- Rancangan domain: dokumen "Fase 0 — Analisis Spreadsheet" dan "Fase 0 — Audit Repositori" (lihat project).

## Kualitas
- Ponytail mode full. Shortcut dengan batas yang diketahui diberi komentar `shortcut: <batas>, <kapan ditingkatkan>`.
- Logika uang, pajak, dan migrasi wajib punya test.
