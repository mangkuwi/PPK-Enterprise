# Hasil uji kompatibilitas

Uji jalan otomatis (`scripts/smoke-e2e.cjs`) di mesin asli GitHub Actions, workflow **Lintas platform**, run [45757558779](https://github.com/mangkuwi/PPK-Enterprise/actions/runs/45757558779), commit `bcf96ed`, 26 November 2026. Electron 33.4.11.

Setiap uji: database dibuat di folder data OS, 18 halaman dibuka tanpa galat konsol, dokumen disimpan, ekspor DOCX dan PDF ke nama berkas Unicode (`Surat Undangan – Rapat Ñ ä ẞ`), ekspor XLSX lalu dibaca kembali, backup penuh lalu restore. Folder data uji juga berisi huruf beraksen.

| Platform | Sistem | Test unit + DB (294) | Uji jalan (build pengembangan) | Installer/DMG dipasang lalu diuji |
| --- | --- | --- | --- | --- |
| Windows x64 | Windows Server 2025 (10.0.26100) | Lulus | Lulus | Lulus: NSIS `/S` per pengguna, shortcut desktop dibuat, aplikasi terpasang lulus semua uji |
| Windows ARM64 | Windows 11 ARM (10.0.26200) | Lulus | Lulus | Installer ARM64 dibuat; belum dipasang di CI |
| macOS Apple Silicon | macOS 15.8 (arm64) | Lulus | Lulus | Lulus: DMG di-mount, .app disalin ke Applications, `codesign --verify --deep --strict` lulus (ad-hoc), aplikasi terpasang lulus semua uji |
| macOS Intel | macOS 15.7 (x64) | Lulus | Lulus | Lulus: sama seperti Apple Silicon |

**Backup lintas OS:** backup buatan Windows dipulihkan di Mac Apple Silicon, dan backup buatan Mac dipulihkan di Windows. Keduanya lulus dan dokumen bernama Unicode utuh.

**Font PDF:** di Linux (tanpa Calibri) PDF dokumen berfont Calibri tersemat Carlito; font sematan juga dimuat dengan CSP pratinjau (`font-src data:`). Di Mac tanpa Office, Calibri dan Cambria memakai pengganti yang sama.

## Belum diuji
| Konfigurasi | Alasan | Cara menguji |
| --- | --- | --- |
| Windows 10 | Tidak ada runner Windows 10 | Manual: `docs/TEST-CHECKLIST.md` |
| Windows 11 x64 desktop | Runner memakai Windows Server 2025 (inti sama) | Manual |
| macOS 13 Ventura, macOS 14 | Runner hanya macOS 15 | Manual; target minimum di build: 13.0 |
| Peringatan Gatekeeper/SmartScreen saat unduh pertama | Butuh unduhan lewat browser oleh manusia | Manual |
| Keyboard ⌘, trackpad, Retina, Keychain, layar penuh | Butuh manusia | Manual |
| Tanda tangan Developer ID + notarisasi | Belum ada akun Apple Developer | Otomatis setelah secret diisi (`docs/RELEASE.md`) |
| PostgreSQL dan multiuser LAN | Belum dibangun (Tahap 6) | Setelah Tahap 6 |
| Pembaruan aplikasi (pasang versi baru di atas versi lama) | Baru satu versi | Rilis berikutnya |
