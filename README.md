# NASKAHDINAS AI – Smart Document Generator

Aplikasi desktop Windows dan macOS (Electron + React + TypeScript) untuk membuat naskah dinas dari template: **buat sekali, pakai berulang kali**.
Berjalan sepenuhnya **offline**, tanpa akun, tanpa iklan; data tersimpan lokal (SQLite).

> **Status jujur:** seluruh kode, skema, test, dan konfigurasi installer sudah ditulis. Build `.exe` dan uji pada Windows 10/11
> **belum dijalankan** (dikerjakan di lingkungan Linux tanpa internet). Ikuti `docs/TEST-CHECKLIST.md` sebelum dipakai produksi.

## 1. Persyaratan pengembang (hanya untuk membangun, bukan untuk pengguna akhir)
- Windows 10/11 64-bit, atau macOS 11+ (Apple Silicon maupun Intel)
- Node.js 20 LTS atau 22 LTS, npm 10+
- Visual Studio Build Tools **tidak** diperlukan bila prebuilt `better-sqlite3` untuk Electron tersedia (diunduh otomatis saat `npm install`).
  Jika unduhan prebuilt gagal, pasang "Desktop development with C++" dari Visual Studio Build Tools (Windows) atau `xcode-select --install` (macOS).

## 2. Perintah
```bash
npm install            # memasang dependensi + rebuild better-sqlite3 untuk ABI Electron (postinstall)
npm run dev            # mode pengembangan (Vite + Electron)
npm run typecheck      # TypeScript (renderer + electron + test)
npm run lint           # ESLint
npm test               # unit test: placeholder engine, render, DOCX, mesin OOXML + analyzer (9 fixture)
npm run test:db        # test database, backup/restore, Smart Template Importer (DB) (otomatis rebuild untuk Node lalu kembalikan ke Electron)
npm run build          # typecheck + build renderer + build Electron
npm run pack           # build + folder aplikasi tanpa installer (release/win-unpacked)
npm run dist           # build + installer NSIS (x64 dan ARM64) + portable x64  →  folder release/ (jalankan di Windows)
npm run dist:mac       # build + .dmg dan .zip untuk Apple Silicon dan Intel, tanda tangan ad-hoc  →  folder release/ (jalankan di Mac)
npm run smoke          # uji jalan aplikasi hasil build pada OS ini (perlu `npx vite build && node scripts/build-electron.mjs`)
```

### Berkas rilis
| Berkas | Untuk |
| --- | --- |
| `PPK-Management-Setup-<versi>-x64.exe` | Windows 10/11 64-bit (installer per pengguna, tanpa hak administrator) |
| `PPK-Management-Setup-<versi>-arm64.exe` | Windows 11 ARM |
| `PPK-Management-Portable-<versi>-x64.exe` | Windows tanpa instalasi; data di folder `NaskahDinasAI-Data` di samping .exe |
| `PPK-Management-macOS-AppleSilicon-<versi>.dmg` | Mac M1–M4 dan sesudahnya, macOS 13+ |
| `PPK-Management-macOS-Intel-<versi>.dmg` | Mac Intel, macOS 13+ |
| `SHA256SUMS.txt`, `RELEASE-NOTES.md` | Checksum dan catatan rilis (hasil uji per platform) |

Rilis dibuat otomatis oleh workflow **Lintas platform** (`.github/workflows/cross-platform.yml`) saat tag `v<versi>` di-push: uji jalan di Windows dan Mac, paket, pasang-dan-jalankan installer, lalu draft GitHub Release. Detail dan penandatanganan: `docs/RELEASE.md`. Hasil uji per platform: `docs/COMPATIBILITY.md`.

### Instalasi
- **Windows:** jalankan `PPK-Management-Setup-…exe`. Bila SmartScreen muncul ("Windows protected your PC"), klik **More info** → **Run anyway** (installer belum ditandatangani sertifikat code signing). Pembaruan: pasang installer versi baru di atas versi lama; data tetap.
- **macOS:** buka `.dmg`, seret **NASKAHDINAS AI** ke **Applications**. Selama aplikasi belum dinotarisasi Apple, pembukaan pertama ditahan Gatekeeper: klik kanan aplikasi → **Open** (macOS 13–14), atau System Settings → Privacy & Security → **Open Anyway** (macOS 15). Gatekeeper tidak perlu dimatikan dan tidak ada perintah Terminal. Pembaruan: ganti aplikasi di Applications; data tetap.
- **Lokasi data:** Windows `%APPDATA%\NASKAHDINAS AI`, macOS `~/Library/Application Support/NASKAHDINAS AI`. Database tidak pernah disimpan di folder instalasi. Backup `.zip` bisa dipulihkan di OS mana pun.

Pengguna akhir **tidak perlu** memasang Node.js. Ikon: `build/icon.png` (1024×1024; .ico dan .icns dibuat otomatis saat build).

## 3. Cara pakai
1. **Pengaturan** → isi nama instansi, alamat, logo (kop surat), identitas pengirim/pejabat default, font & margin default.
2. **Template** → **Import dari Word** (lihat bawah), atau pakai template contoh (Nota Dinas, Undangan, Surat Tugas, Berita Acara, Surat Pengantar) atau **Tambah Template**.
   Ketik placeholder langsung di isi template; formulir isian dibuat otomatis.
3. **Buat Dokumen** → pilih kategori → pilih template → isi formulir → **Generate Document** → edit di editor kertas A4 →
   **Simpan** (masuk arsip) / **Export DOCX** / **Export PDF** / **Cetak**.
4. **Arsip** → cari, filter (kategori/status/tanggal), urutkan, buka, duplikat, ubah status, export ulang, hapus.
5. **Pengaturan → Backup & Restore** untuk mencadangkan dan memulihkan data.

### Import template dari Word (.docx / .dotx)
**Template → Import dari Word** → pilih berkas → aplikasi membuka editor template berisi hasil konversi (belum tersimpan) beserta daftar catatan → tinjau → ubah bagian yang berubah-ubah menjadi placeholder → **Simpan Template**.
- Dibaca: paragraf, tebal/miring/garis bawah/coret, ukuran & jenis font, rata teks, indentasi, daftar bernomor/berpoin bertingkat, tabel (gabung kolom/baris, lebar kolom, ada/tanpa garis, baris judul), gambar PNG/JPEG/GIF/BMP, pemisah halaman, margin, font & spasi dasar, header/footer teks, nomor halaman.
- Penanda `{{nama}}`, `«Nama»`, `<<nama>>` otomatis menjadi `[NAMA]`; run yang terpecah (`[NOMOR` + `_SURAT]`) digabung agar placeholder terdeteksi utuh.
- Isian titik-titik/garis bawah (`.......`) dilaporkan; pilih teksnya di editor lalu klik **Sisipkan** untuk menggantinya dengan placeholder.
- **Tidak** diimpor: kotak teks, bentuk/VML/OLE, gambar WebP/SVG/EMF, header/footer berisi gambar atau tabel (gunakan Kop Surat di Pengaturan), komentar, perubahan terlacak yang dihapus. Format `.doc` lama harus disimpan ulang sebagai `.docx`.
- Fidelitas tampilan dengan Word tidak dijamin identik; selalu periksa hasilnya.

### Sintaks placeholder
| Penulisan | Arti |
|---|---|
| `[NOMOR_SURAT]` | wajib, teks |
| `[?LAMPIRAN]` | opsional; dihapus bila kosong dan dilaporkan setelah Generate |
| `[LATAR_BELAKANG\|textarea]` | tipe: `text`, `textarea`, `date`, `select`/`dropdown`, `richtext`, `number` |
| `[?SIFAT\|select:Biasa,Segera,Rahasia\|default=Biasa]` | dropdown opsional dengan nilai bawaan |
| `[LOKASI_SURAT\|default=Jakarta\|label=Kota]` | nilai bawaan dan label formulir |

Aturan: nama placeholder `A–Z`, angka, `_` (diawali huruf). Nilai default/label/pilihan tidak boleh mengandung `| [ ]`.
Placeholder **wajib** yang tidak diisi tetap tampil sebagai `[KEY]` dengan sorotan kuning di editor dan dikonfirmasi sebelum export.
Tipe/label/wajib/default tiap field dapat diubah di panel "Isian terdeteksi" pada editor template.
Placeholder sebaiknya diketik dalam satu gaya format (jangan sebagian dicetak tebal) agar terdeteksi utuh.

Otomatis terisi dari Pengaturan: `[PENGIRIM]`, `[NAMA_PEJABAT]`, `[JABATAN_PEJABAT]`, dan `[TANGGAL]` (hari ini) bila nilai bawaan kosong.

### Penamaan file export
`KODEKATEGORI_Judul_Dokumen_TANGGAL.ext`, contoh `ND_Pembahasan_IP_HUB_2026-11-23.docx`. Lokasi dipilih lewat dialog simpan (folder awal diatur di Pengaturan).

## 3b. Penomoran Dokumen & Register
Empat register mandiri — **Surat Keluar, Nota Dinas, Berita Acara, Kontrak** — masing-masing dengan penghitung sendiri. **Penomoran harian (DDSS)**: `DD` = tanggal (hari) dokumen 2 digit, `SS` = urutan harian 01–99; kunci penghitung = **kategori + tanggal dokumen lengkap** (bukan jam komputer), sehingga urutan kembali ke 01 setiap tanggal berganti. Contoh: 24 Nov 2026 → `2401`, `2402`…; 25 Nov → `2501`; 1 Des → `0101`. Dokumen mundur (backdate) melanjutkan urutan tanggalnya; tanggal masa depan memakai urutan sendiri. Catatan: nomor DDSS **unik per kategori + tanggal lengkap**, bukan unik global lintas bulan/tahun — rujuk nomor bersama tanggalnya. Laporan/filter tahunan tetap tersedia.

- **Nomor resmi hanya dibuat sistem** (mesin penomoran di proses utama). Isian `NOMOR_SURAT` / `NOMOR_NOTA_DINAS` / `NOMOR_BA` / `NOMOR_KONTRAK` di formulir bersifat baca-saja; nilai dari formulir/AI untuk kunci itu **diabaikan server**. `TANGGAL_SURAT`/`TANGGAL` juga dipaksa sama dengan tanggal penomoran.
- **Alur (Bank Nomor Dokumen, migrasi v7)**: dua proses terpisah. **A.** Menu *Bank Nomor Dokumen*: nomor dibuat lebih dulu per kategori (1 atau banyak, pilih tanggal, **pratinjau** dulu, konfirmasi) dan berstatus **AVAILABLE**. **B.** Saat membuat dokumen, pengguna **memilih** nomor AVAILABLE pada isian nomor (**ASSIGNED**); dokumen difinalkan → **ISSUED**. Status: AVAILABLE, ASSIGNED, ISSUED, VOID. Membuka halaman buat dokumen **tidak** membuat nomor; AI tidak membuat nomor. Membatalkan/menutup/menghapus draf **tidak** membatalkan nomor: nomor kembali AVAILABLE (riwayat tetap). Mengganti nomor terpilih = nomor lama dilepas, nomor baru ditugaskan. Hanya admin yang dapat **VOID** (konfirmasi + alasan; pelaku tercatat; permanen, tidak dipakai ulang). Nomor ISSUED tidak pernah dilepas otomatis.
- Contoh pembuatan massal: Berita Acara, 25 Nov 2026, jumlah 10 → `2501`–`2510`, semua AVAILABLE, dalam satu transaksi atomik (gagal sebagian = tidak ada yang tersimpan). Dua pengguna tidak dapat memilih nomor AVAILABLE yang sama (hanya satu berhasil). Tanggal dokumen mengikuti tanggal nomor yang dipilih.
- **Batas 99 per kategori per tanggal**: pembuatan yang melewati batas ditolak seluruhnya dengan pesan jelas (tidak dipotong; nomor yang ada tidak berubah). Admin dapat memperpanjang *Panjang nomor urut* (mis. 3 digit) pada Pengaturan Nomor. Masa berlaku reservasi (TTL) sudah tidak dipakai.
- **Pemetaan bawaan** (dapat diubah admin di *Pengaturan Nomor → Pemetaan*): Surat Undangan → Surat Keluar, Nota Dinas → Nota Dinas, Berita Acara → Berita Acara, Kontrak → Kontrak; pemetaan per-template menimpa kategori. Kategori tanpa register tidak memesan nomor.
- **Format** dapat diatur admin per register: `{SEQUENCE} {MONTH} {MONTH2} {ROMAN} {YEAR} {YY} {DAY} {DAY2}` (bawaan: `{DAY2}{SEQUENCE}` dengan urut 2 digit = DDSS), awalan, akhiran, panjang nomor urut, nomor urut awal, masa berlaku reservasi, dan kunci placeholder. Format dapat dikembalikan/diubah admin; perubahan hanya berlaku untuk nomor baru. Perubahan dicatat (riwayat konfigurasi); nomor lama tidak berubah.
- **Merujuk nomor yang sudah terbit** (mis. nomor kontrak di Berita Acara): kolom `NOMOR_KONTRAK` pada template BA menjadi pemilih rujukan; tidak ada nomor baru di register Kontrak. Rujukan tersimpan dan terlihat di detail nomor.
- **Impor Excel** (admin): *Penomoran & Register → Impor Excel*. Pemetaan kolom otomatis (TGL | BULAN | NOMOR | NOMOR BA | PIHAK | PERIHAL | KETERANGAN | PEMBUAT), deteksi duplikat, celah nomor, dan konflik; nomor historis dicatat apa adanya (status Terbit; tanggal & nomor asli tidak ditulis ulang). Baris bernomor DDSS yang harinya cocok dengan tanggal menentukan urutan harian (nomor tertinggi per tanggal, **bukan baris terakhir berkas**); baris lain dicatat sebagai *nomor lama* dan tidak memengaruhi urutan. Laporan review admin memuat duplikat, celah per tanggal, dan ketidakkonsistenan hari; celah wajib dikonfirmasi. Seluruh impor satu transaksi (gagal = tidak ada yang tersimpan; kegagalan dicatat).
- **Halaman register**: cari, filter (tahun, status, rentang tanggal, perihal, pihak, pembuat), urut, halaman, catat nomor manual (status Terbit), ubah keterangan (nomor/tanggal terkunci), lepas, void (admin), terbitkan, buka dokumen tertaut, ekspor **Excel** (format sama dengan impor) dan **PDF**.
- **Peran**: *Administrator* (konfigurasi, impor, nomor awal, VOID, tinjauan migrasi, pengguna) dan *Operator* (membuat nomor, memilih/melepas/menerbitkan nomor yang ia pilih sendiri). PIN opsional per pengguna. Ini aplikasi lokal tanpa server: peran mencegah salah pakai, **bukan** pengganti keamanan komputer/akun Windows.
- **Perlindungan di database**: UNIQUE (register+tanggal+urut, register+tanggal+nomor), trigger yang menolak `DELETE`, perubahan nomor/tanggal, dan transisi status selain AVAILABLE→ASSIGNED/VOID dan ASSIGNED→AVAILABLE/ISSUED; ISSUED dan VOID final. Penugasan dilakukan dengan `UPDATE … WHERE status='available'` dalam transaksi `IMMEDIATE`. Riwayat nomor, batch, log audit, dan riwayat konfigurasi bersifat *append-only*.
- **Data lama (migrasi v7)**: tidak diregenerasi dan tidak diasumsikan AVAILABLE. Dibatalkan → VOID; dipesan **dengan** dokumen → ASSIGNED; Terbit tetap. Dipesan **tanpa** dokumen → AVAILABLE bertanda *tinjau migrasi* dan **disembunyikan dari pemilih** sampai admin meninjau (Bank Nomor Dokumen → Tinjauan migrasi: jadikan tersedia atau VOID dengan alasan). Salinan DB sebelum migrasi dibuat otomatis (`pre-migration-v6.db`).
- **Backup**: Backup Lengkap menyertakan seluruh data penomoran. Backup Template/Arsip (JSON) **tidak** memuat register — gunakan Backup Lengkap sebelum migrasi/pindah komputer, atau ekspor register ke Excel.

## 4. Backup & restore
- **Backup Lengkap**: salinan konsisten seluruh database (`VACUUM`/`backup` SQLite) + `manifest.json` dalam satu `.zip`.
- **Backup Template** / **Backup Arsip Dokumen**: ekspor JSON dalam `.zip` (dapat digabungkan ke instalasi lain).
- Folder backup dipilih di Pengaturan (bawaan: `%APPDATA%\NASKAHDINAS AI\backups`). Berkas `.zip` dapat dipindahkan ke komputer Windows lain.
- **Restore**: pilih `.zip` → konfirmasi (menampilkan tanggal & isi backup) → aplikasi membuat backup otomatis kondisi saat ini (`pre-restore`) →
  backup lengkap **mengganti** seluruh data (diverifikasi `integrity_check` dulu); backup parsial **menggabungkan** tanpa menimpa data yang sudah ada.
- Sebelum migrasi skema database, berkas DB disalin otomatis ke folder `backups` (`pre-migration-v*.db`).
- Lokasi data: `%APPDATA%\NASKAHDINAS AI\data\naskahdinas.db`; log: `%APPDATA%\NASKAHDINAS AI\logs\app.log`.

## 5. Keamanan
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; preload hanya mengekspos `invoke` dengan **daftar putih channel**;
setiap handler IPC memverifikasi asal frame dan memvalidasi payload dengan **zod**; renderer tidak pernah memberi path tulis
(penyimpanan hanya lewat dialog sistem); CSP ketat pada build produksi; navigasi & jendela baru diblokir; izin web ditolak;
gambar dokumen hanya `data:` URL; jendela PDF/cetak ber-sandbox dengan CSP `default-src 'none'`.
Kunci API AI dienkripsi dengan `safeStorage` (DPAPI di Windows, Keychain di macOS) dan tidak pernah dikirim ke renderer.

## 6. Asisten AI (opsional, nonaktif secara bawaan)
Endpoint kompatibel OpenAI yang dikonfigurasi pengguna (HTTPS; HTTP hanya untuk localhost). Setiap pengiriman teks meminta persetujuan eksplisit.
Prompt sistem melarang AI mengarang nomor surat, dasar hukum, peraturan, nama/jabatan pejabat, tanggal, anggaran, informasi kontraktual;
hasil diperiksa heuristik (placeholder hilang, angka/tanggal baru, rujukan peraturan baru) dan ditampilkan sebagai peringatan sebelum dipakai.
### Smart Template Importer (menu "SMART TEMPLATE IMPORTER")
Cara yang **direkomendasikan** untuk memakai dokumen Word yang sudah ada: format asli (kop, logo, font, tabel, header/footer, nomor halaman, penomoran) **dipertahankan**, karena berkas DOCX asli menjadi dasar dokumen hasil.

Alur: **Upload Template** → analisis otomatis (deterministik, tanpa AI/internet) → **Review Mapping** → **Simpan sebagai Template** → pakai di **Buat Dokumen**.
- Sumber asli disimpan utuh di database (SHA-256, trigger SQL melarang pengubahan). Template = *salinan* sumber yang teks dinamisnya diganti `{{KEY}}`; dokumen hasil = salinan template yang diisi. Berkas sumber di komputer tidak pernah disentuh.
- Penggantian dilakukan langsung pada XML (`<w:t>`) tanpa mengurai-ulang dokumen; teks yang terpecah di beberapa *run* diganti tanpa meratakan format; entri zip yang tidak berubah (gambar, style, font, header, footer…) disalin byte-per-byte.
- Hasil analisis diberi skor keyakinan: **Terdeteksi otomatis** (≥ 75%), **Perlu konfirmasi** (paragraf panjang, tanggal/jam di dalam kalimat, nomor rujukan, tabel data), **Tidak terdeteksi/ditolak**. Semua dapat diedit; teks apa pun dapat dijadikan isian dengan memblok teksnya di panel kiri.
- Tipe isian: teks, teks panjang, tanggal, angka, dropdown, rich text; opsional (`{{?KEY}}` — paragraf dihapus bila kosong); nilai awal; nama sama = nilai dipakai bersama; **baris tabel berulang** (`{{GRUP.KOLOM}}`, `{{GRUP.NO}}` nomor otomatis).
- **Bandingkan**: Original ↔ Adapted ↔ Generated, bukti struktur XML identik (hanya teks yang berubah), jumlah paragraf/tabel/baris/gambar, serta peringatan (tracked changes, kotak teks, field Word, dll).
- **Import History**: Re-analyze, Edit mapping, Preview, Restore sumber, unduh sumber asli, hapus.
- Dokumen hasil disimpan sebagai BLOB DOCX + pratinjau teks. **Export DOCX asli** memakai berkas Word hasil pengisian. Bila Anda menyunting di editor, status menjadi *disunting* dan berkas Word asli tidak memuat perubahan itu — gunakan **Perbarui dari Formulir** atau Export DOCX biasa dari editor.
- **PDF yang setia** dibuat lewat LibreOffice bila terpasang (opsional); tanpa itu, ekspor DOCX lalu "Simpan sebagai PDF" dari Word.
- Tidak didukung: `.doc` (simpan ulang sebagai `.docx`), PDF sebagai sumber template (hanya referensi; OCR belum ada), dokumen terenkripsi/bermakro. Perubahan terlacak sebaiknya diterima/ditolak dulu di Word.
- Bila nilai isian memuat format campuran (mis. sebagian tebal) pada teks sumber yang terpecah, nilai pengganti memakai format *run pertama* dari teks yang diganti.
- **Area terlindungi/editable:** hanya teks yang dipetakan yang bisa berubah. Header/footer tidak pernah dipetakan otomatis dan pemetaan manual di sana ditolak; paragraf body dapat dikunci (ikon gembok) agar tidak bisa dijadikan isian.
- **Blok dinamis:** `{{BLOCK:DAFTAR_PESERTA}}`, `{{ISI_UTAMA}}` dst. dikenali sebagai isian teks panjang (satu paragraf per baris); tabel data → baris berulang.
- **Versi template:** setiap Simpan sebagai Template membuat versi baru (pemetaan + berkas adaptasi + hash); versi lama dapat dipulihkan dari panel kanan Review (menjadi versi baru, riwayat tidak dihapus).
- **Validasi sebelum ekspor:** 11 pemeriksaan (integritas paket, SHA-256 semua komponen non-isi, header/footer, relasi, logo/gambar, section/margin, tabel, paragraf terlindungi, field/nomor halaman, kelengkapan placeholder, XML). Gagal → dokumen tidak dibuat/diekspor dan komponen yang berubah disebutkan; "Perbarui dari Formulir" mengulang dari template asli. Ekspor juga memeriksa SHA-256 berkas tersimpan terhadap hasil validasi. XML yang tak berubah **tidak** dianggap bukti tampilan identik.
- **Perbandingan visual (butuh LibreOffice):** tombol "Validasi & Bandingkan" di dokumen: render sumber asli vs hasil, halaman berdampingan + % piksel berbeda, serta temuan: halaman tambahan, gambar hilang, header/footer bergeser, overflow, tata letak tabel bergeser. Word tetap acuan akhir.
- **AI hanya untuk area isi:** panel "Susun isi dengan AI" (opsional, perlu diaktifkan di Pengaturan) hanya mengisi kolom teks panjang; kunci lain dibuang; hanya teks instruksi/referensi yang dikirim (bukan DOCX); angka, tanggal, atau peraturan baru diberi peringatan; informasi kurang ditandai `[ISI_...]`.
- **Varian template (anti-duplikasi):** bila satu DOCX berisi dua halaman atau lebih yang strukturnya sama dan hanya berbeda di wilayah tertentu (mis. kolom paraf A/B), aplikasi mendaftarkannya sebagai SATU template induk dengan beberapa varian — bukan kategori/template baru. Analisis memakai struktur OOXML (blok paragraf/tabel, lebar kolom, format, teks), bukan teks saja. Konfigurasi isian dibuat sekali pada master dan diwarisi varian lewat penyejajaran paragraf; perbedaan nilai contoh (nomor/tanggal) dikenali sebagai isian bersama, sedangkan perbedaan struktur (mis. tabel paraf) menjadi wilayah khusus varian yang dipertahankan apa adanya. Kelompok yang kurang pasti meminta konfirmasi; menolak = seluruh dokumen tetap satu template (halaman tidak digabung atau dibuang). Saat Generate, pengguna memilih varian; hanya SALINAN KERJA yang memuat halaman varian terpilih, master dan sumber asli tidak diubah, dan validasi menambah pemeriksaan "Pemilihan varian halaman". Batasan: "halaman" = bagian di antara pemisah halaman eksplisit (page break / page-break-before); halaman yang hanya mengalir otomatis atau dipisah section break tidak dapat dipilih otomatis (hanya dilaporkan).
- 15 contoh DOCX uji (termasuk lanskap multi-section dan kotak teks/gambar mengambang) ada di `tests/fixtures/` (dibuat ulang dengan `python tests/fixtures/make_fixtures.py`).

Seluruh fitur inti berjalan tanpa AI dan tanpa internet.

## 7. Struktur repository
```
electron/main      proses utama: window, database, repo SQL, migrasi, seed, backup, docx-export, pdf, importer-service
electron/main/numbering  penomoran & register: format, penghitung harian (DDSS), reservasi/terbit/batal, impor/ekspor XLSX, integrasi dokumen, pengguna & audit
electron/main/ooxml  mesin OOXML: zip, scan paragraf/run, fill token, analyze (heuristik), adapt, inspect/compare
electron/ipc       handler IPC (zod) · electron/preload  jembatan aman
shared/            logika murni dipakai bersama: placeholder engine, render HTML, nama file, AI guard, tipe
src/               React: pages, features (editor, generator, documents), components/ui (shadcn-style), hooks, services
tests/             vitest · scripts/ dev & build · docs/ SRS, checklist uji
```
Catatan teknis: Prisma diganti `better-sqlite3` + migrasi SQL manual karena engine native Prisma bermasalah saat dikemas untuk Electron offline.

## 8. Batasan yang diketahui
- Kesetaraan DOCX dengan Microsoft Word **belum diuji**; konverter mendukung paragraf, heading, format teks, rata teks, indentasi, daftar bertingkat, tabel (colspan/rowspan/lebar kolom/tanpa garis), gambar PNG/JPEG/GIF/BMP, page break, kop, header/footer, nomor halaman.
- Pagination di editor bersifat perkiraan (garis batas halaman); pemisahan halaman final ditentukan Word/Chromium saat export.
- Gambar WebP/SVG tidak didukung pada export DOCX.
- Warna teks, blockquote, dan blok kode sengaja tidak didukung.
