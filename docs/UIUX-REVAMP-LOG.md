# Log Revamp UI/UX (progress & keputusan)

## Audit (ringkas)
- Stack: Electron + React + TS + Vite + Tailwind (palet `navy`), react-router. Komponen bersama: `components/ui/*` (button, card, dialog, form, feedback), `layout/{Page,Sidebar}`. Data lewat IPC (`src/services/api.ts`), logika bisnis di proses utama.
- Rute yang ada dipertahankan semuanya (tidak ada yang dihapus/diganti): `/`, `/generator`, `/templates*`, `/archive`, `/documents/:id`, `/importer*`, `/bank-nomor`, `/penomoran*`, `/register/:slug`, `/settings`.
- Keputusan: tidak ada dependensi baru; sidebar diganti di tempat; filter lewat query string (`/archive?status=`, `/generator?register=`) agar tidak ada rute baru yang kosong.

## Selesai
- **Fase 1 (sebagian)**: font Inter→Segoe UI (offline, tanpa unduhan font), sidebar dengan kelompok Workspace / Template Management / Administrasi / Settings, bisa dilipat (status tersimpan, otomatis lipat pada layar <1100px), indikator aktif, ikon seragam, tooltip saat terlipat, `aria-label`.
- **Fase 2**: dashboard dari data nyata (total dokumen, draf aktif, template, nomor tersedia = AVAILABLE yang bisa dipilih, tanpa catatan "tinjau migrasi"), aksi cepat, dokumen terbaru dengan status + edit, template favorit, ringkasan Bank Nomor per kategori. `Stats.activeDrafts` ditambahkan (query `COUNT` biasa; tanpa migrasi skema).
- `/archive?status=draft|review|final` dan `/generator?register=KODE` didukung.

## Belum dikerjakan (jujur)
- Fase 3 alur 6 langkah (wizard) + fase 4 (langkah nomor sebagai langkah tersendiri; saat ini pemilih "PILIH NOMOR DOKUMEN" sudah ada di formulir)
- Fase 5 galeri template, fase 6 autosave/indikator simpan/pratinjau real-time, fase 7 aksesibilitas menyeluruh, fase 8 optimasi.
- Breadcrumb dan komponen tabel/toast seragam.
- Ponytail (`/ponytail ultra`, review, audit, debt): plugin tidak dapat dimuat di sesi ini; prinsipnya diterapkan manual.

## Catatan teknis
- `UserBadge` tidak lagi dipakai sidebar (masih diekspor); tombol "Profil Pengguna" membuka dialog ganti pengguna yang sama (belum ada halaman profil terpisah).
- "Register Lainnya & Impor" → `/penomoran` (ringkasan + tautan Nota Dinas, BA, Kontrak, Impor Excel, Pengaturan Nomor melalui halaman tersebut). Tombol Impor Excel dan Pengaturan Nomor ada di header halaman itu.
