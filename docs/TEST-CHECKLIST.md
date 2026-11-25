# Checklist Uji Penerimaan (jalankan di Windows 10/11)

Centang hanya setelah benar-benar diuji. Catat versi Windows/Word.

## Otomatis
- [ ] `npm install` sukses (better-sqlite3 ter-rebuild untuk Electron)
- [ ] `npm run typecheck` tanpa error
- [ ] `npm run lint` tanpa error
- [ ] `npm test` hijau
- [ ] `npm run test:db` hijau
- [ ] `npm run dist` menghasilkan `release/*.exe` (installer + portable)

## Kriteria penerimaan
1. [ ] Template dapat dibuat dan disimpan (Template → Tambah, ketik `[NAMA]`, simpan)
2. [ ] Template dapat dipakai berkali-kali (Generate 2× dari template yang sama; template tidak berubah)
3. [ ] Placeholder terdeteksi otomatis di panel "Isian terdeteksi" dan di formulir
4. [ ] Dokumen dihasilkan dan dapat diedit (semua tombol toolbar: font, ukuran, B/I/U/S, rata, daftar, indent, tabel + operasi tabel, gambar, page break, cari-ganti, undo/redo)
5. [ ] Template asli tidak berubah saat dokumen diedit; edit/hapus template tidak mengubah/menghapus dokumen lama
6. [ ] Dokumen tersimpan di arsip; cari/filter/urut/status/duplikat/hapus/export ulang bekerja
7. [ ] DOCX terbuka di Microsoft Word: periksa kop+logo, tabel info tanpa garis, tabel bergaris, daftar bernomor, gambar, page break, header/footer, nomor halaman, font, margin, spasi
8. [ ] PDF terbuka & dapat dicetak; kop pada halaman pertama; header/footer/nomor halaman
9. [ ] Backup lengkap → hapus data → restore → data kembali; backup template/arsip digabung; konfirmasi restore tampil
10. [ ] Aplikasi berjalan tanpa internet (putuskan jaringan, jalankan semua fitur inti)
11. [ ] Installer berjalan di Windows 10 dan 11 (instal, shortcut, uninstall; data tidak terhapus saat uninstall); portable menyimpan data di `NaskahDinasAI-Data`
12. [ ] Tidak ada error kritis di `%APPDATA%\NASKAHDINAS AI\logs\app.log`

## Smart Template Importer (uji manual di Windows + Microsoft Word)
- [ ] Unggah 9 contoh di `tests/fixtures/` dan dokumen resmi asli Anda: hasil Review wajar; paragraf panjang berstatus "perlu konfirmasi"
- [ ] Simpan sebagai Template → Buat Dokumen dengan nilai baru → **Export DOCX asli** terbuka di Word tanpa pesan perbaikan
- [ ] Bandingkan hasil dengan sumber di Word: kop/logo, font, margin, tabel, header/footer, nomor halaman, penomoran identik
- [ ] Tabel baris berulang: tambah/hapus baris, nomor otomatis
- [ ] Isian opsional kosong menghapus paragraf (tidak meninggalkan baris kosong); isian multi-baris
- [ ] Sunting di editor → bilah menampilkan "disunting"; "Perbarui dari Formulir" memulihkan
- [ ] Re-analyze, Edit mapping, Restore sumber, Hapus impor (dokumen di arsip tetap ada)
- [ ] Berkas sumber di folder asal tidak berubah (cek tanggal modifikasi/hash)
- [ ] PDF setia dengan LibreOffice terpasang; pesan jelas bila tidak terpasang
- [ ] Backup lengkap + restore menyertakan template Word & dokumen DOCX
- [ ] "Validasi & Bandingkan": laporan 11 pemeriksaan hijau; perbandingan visual menampilkan halaman Original/Generated (pdfjs di renderer — belum diuji di Electron)
- [ ] Ubah manual komponen di dalam .docx tersimpan (mis. via DB) → ekspor ditolak
- [ ] Template dengan header/footer/logo/kotak teks/orientasi landscape/multi-section dari instansi Anda: validasi lolos dan Word membuka tanpa pesan perbaikan
- [ ] Riwayat versi: simpan ulang, pulihkan versi lama
- [ ] Panel AI (bila diaktifkan): hanya kolom teks panjang terisi; peringatan angka/peraturan muncul

## Keamanan
- [ ] DevTools tidak terbuka pada build produksi; `window.require`/`process` tidak tersedia di konsol renderer
- [ ] Placeholder berisi `<script>` pada nilai formulir tampil sebagai teks (tidak dieksekusi)
- [ ] Kunci API AI tersimpan terenkripsi (kolom `settings.ai_api_key_enc` bukan teks polos)

## Varian template (Smart Template Deduplication)
- [ ] Unggah DOCX 2 halaman Nota Dinas dengan kolom paraf A dan B (mis. `tests/fixtures/12_varian_paraf.docx`): panel "Varian template" menampilkan 1 master, 2 varian, status "Terdeteksi otomatis"; Template Manager hanya mencatat 1 template dan 1 kategori
- [ ] Bandingkan varian: perbedaan tabel paraf bertanda "khusus varian"; nomor/tanggal contoh berbeda bertanda "isian bersama"
- [ ] Pratinjau teks dan (dengan LibreOffice) tampilan halaman tiap varian
- [ ] Generate: pilih Varian A lalu B — dokumen 1 halaman, tanpa halaman kosong, kolom paraf sesuai pilihan; laporan validasi memuat "Pemilihan varian halaman" lulus
- [ ] Buka hasil di Microsoft Word: tidak ada pesan perbaikan, tata letak sama dengan halaman asli
- [ ] DOCX dengan halaman kedua berbeda isi (lampiran) TIDAK dikenali sebagai varian
- [ ] Kelompok "Perlu konfirmasi" (`15_varian_ragu.docx`): Simpan sebagai Template ditolak sampai dikonfirmasi/ditolak; tolak → kedua halaman tetap ada dalam satu template
- [ ] Ganti nama varian lalu simpan: pilihan di formulir ikut berubah; dokumen lama yang memakai nama lama perlu "Perbarui dari Formulir" dengan pilihan baru

## Penomoran & Register (uji manual di Windows)
- [ ] Setelah update, aplikasi dibuka tanpa kehilangan template/dokumen lama; salinan `pre-migration-v4.db` terbentuk di folder backups; menu "Penomoran & Register" muncul
- [ ] Pengaturan Nomor → Format: ubah format Berita Acara sesuai pola instansi; pratinjau benar; riwayat konfigurasi tercatat; nomor lama tidak berubah
- [ ] Impor Excel Berita Acara (kolom TGL | BULAN | NOMOR | NOMOR BA | PIHAK | PERIHAL | KETERANGAN | PEMBUAT): pemetaan otomatis; laporan menampilkan duplikat/celah; nomor historis tampil persis seperti di Excel; tetapkan nomor urut berikutnya; impor berkas yang sama lagi ditolak (duplikat)
- [ ] Hasil DOCX: nomor dan tanggal terisi di posisi placeholder, format/kop/tabel/paraf tidak berubah; buka di Word tanpa pesan perbaikan
- [ ] Finalkan dokumen (status Final) → di register nomor berstatus Terbit, tombol "Buka dokumen" berfungsi
- [ ] Template BA dengan kolom NOMOR_KONTRAK: pilih nomor kontrak yang sudah terbit → muncul di dokumen; register Kontrak tidak bertambah; nomor kontrak menampilkan dokumen perujuk
- [ ] Penomoran harian: dokumen pertama tanggal 24 Nov → 2401, kedua → 2402; tanggal 25 Nov → 2501; dokumen 24 Nov berikutnya (tanggal mundur) → 2403, bukan 2502
- [ ] BA dan Surat Keluar pada tanggal yang sama memiliki urutan sendiri (2401 masing-masing)
- [ ] Batas harian: setelah 99 nomor pada satu kategori+tanggal, permintaan ke-100 menampilkan peringatan jelas, tidak ada nomor dibuat; tanggal/kategori lain tetap normal
- [ ] Update dari versi sebelumnya: nomor lama (format tahunan) tetap persis sama di register; pemesanan baru mulai 01 pada tanggalnya; riwayat konfigurasi mencatat perubahan format oleh "Migrasi v6"
- [ ] Impor Excel bernomor DDSS dengan baris tidak berurutan: urutan berikutnya mengikuti nomor tertinggi per tanggal; laporan menampilkan celah per tanggal dan duplikat
- [ ] Menu "BANK NOMOR DOKUMEN" tampil; 4 tab kategori; kartu Available/Assigned/Issued/Void
- [ ] Buat nomor: Berita Acara, 25 Nov 2026, jumlah 10 → Pratinjau menampilkan 2501–2510 (belum tersimpan) → Konfirmasi → 10 nomor AVAILABLE
- [ ] Buka halaman Buat Dokumen (template BA): TIDAK ada nomor baru dibuat; isian nomor kosong "belum dipilih"; membuat dokumen tanpa memilih nomor ditolak dengan pesan jelas
- [ ] Pilih nomor 2503 dari pemilih (hanya AVAILABLE tampil; "semua status" baca-saja) → ASSIGNED, tanggal dokumen mengikuti 25 Nov, DOCX terisi di placeholder dengan layout utuh
- [ ] Ganti ke 2504 → 2503 kembali AVAILABLE, 2504 ASSIGNED, tidak ada nomor baru; tombol Lepas mengembalikan nomor ke AVAILABLE
- [ ] Tutup formulir / batalkan draf / hapus draf → nomor kembali AVAILABLE (riwayat "pernah dilepas" bertambah), bukan VOID; pilih 2503 lagi berhasil
- [ ] Dua jendela/pengguna memilih nomor yang sama bersamaan → hanya satu berhasil, yang lain mendapat pesan "sudah dipakai"
- [ ] Finalkan dokumen → nomor ISSUED, "Buka dokumen" di Bank Nomor berfungsi; nomor tidak bisa dipilih ulang/dilepas otomatis
- [ ] Admin VOID nomor AVAILABLE: dialog konfirmasi + alasan wajib; status VOID, pelaku/alasan/waktu tercatat di detail & riwayat; nomor tidak muncul di pemilih dan tidak dipakai ulang; operator tidak melihat tombol Void
- [ ] Update dari versi lama: Bank Nomor → "Tinjauan migrasi" (admin) menampilkan pemetaan (Terbit/Void/Dipakai draf/Menunggu tinjauan); nomor "dipesan tanpa dokumen" tidak muncul di pemilih sampai admin menetapkan tersedia/void
- [ ] Operator tidak dapat: mengubah konfigurasi, mengimpor, menetapkan nomor awal, void, tinjauan migrasi, melepas nomor yang dipilih pengguna lain
- [ ] Filter Bank Nomor (kategori, tanggal, tahun, status, pembuat, cari) dan tabel Tanggal | Nomor | Kategori | Status | Dokumen terkait | Pembuat berfungsi
- [ ] Ekspor register ke Excel dan PDF (PDF memakai Chromium bawaan Electron); Excel dapat diimpor ulang ke register kosong
- [ ] Backup Lengkap → restore di komputer lain: register, nomor, riwayat, dan pengguna kembali utuh
- [ ] Pengguna dengan PIN: aplikasi meminta pilih pengguna/PIN saat dibuka; PIN salah ditolak dan tercatat
