# Catatan perubahan

Format: satu bagian per versi (`## <versi> — <tanggal>`). Bagian ini disalin ke catatan rilis GitHub.

## 1.0.0 — belum dirilis
- Modul PPK: anggaran, penyedia, kontrak, tagihan, pembayaran, impor Excel, laporan dan prognosis, RPD, rekonsiliasi SP2D.
- Backup otomatis harian yang diverifikasi.
- Server PPK bersama di LAN (PostgreSQL 13+): pindahkan data lokal ke server dengan cek jumlah baris dan total rupiah, masuk server dengan PIN, pengguna server, backup server harian.
- Kirim surat undangan via WhatsApp (Desktop/Web, pesan terisi, PDF siap dilampirkan) dengan daftar penerima, konfirmasi, peringatan kirim ganda, dan riwayat pengiriman. Adapter WhatsApp Business API (nonaktif secara bawaan).
- Agenda PPK dari surat undangan: penanggung jawab utama dan staf pendukung, tampil di dashboard; ikut ke server PPK.
- Beranda Agenda PPK: kartu ringkasan dari database, kalender bulan/minggu/hari dengan daftar agenda, agenda hari ini, 7 hari ke depan, ringkasan Kotak Masuk WhatsApp, tindakan tertunda. Tabel Agenda Center (migrasi v14: undangan, file asli, hasil ekstraksi, nomor WA staf, notifikasi).
- Beranda bergaya jadwal: kalender kecil, saringan jenis agenda, pengingat, banner Kotak Masuk WhatsApp, grid jam Harian/Mingguan/Bulanan dengan kartu agenda, peserta, dan tombol gabung rapat daring.
- Gateway WhatsApp (`gateway/`): layanan VPS (Docker Compose, PostgreSQL, Nginx HTTPS) yang menerima webhook Meta dengan cek tanda tangan, mencatat semua webhook, menolak pesan ganda, mengunduh lampiran lewat antrean satu worker, dan menyediakan API tarik berkunci. Aplikasi desktop menarik pesan tiap 60 detik ke Kotak Masuk; alamat dan kunci API diatur admin PPK (kunci terenkripsi).
- Manajemen agenda: halaman detail dengan riwayat, cari dan filter (tanggal, program, staf, penyelenggara, status), peringatan jadwal bentrok, arsip, unggah surat undangan (PDF/DOC/DOCX/JPG/PNG, cek isi file, tanda duplikat) dan buka file asli, tombol Gabung Zoom/Teams/Meet.
- Dukungan macOS (Apple Silicon dan Intel) dan Windows ARM64; font pengganti Calibri/Cambria untuk PDF di komputer tanpa Office.
