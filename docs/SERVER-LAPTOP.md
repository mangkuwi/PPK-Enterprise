# Menjalankan PPK Management sebagai web app (laptop sebagai server uji coba)

Mode server menjalankan PPK Management **tanpa jendela aplikasi**. Semua orang, termasuk Anda di laptop server,
memakainya lewat browser. Ini bentuk yang sama yang nanti dipasang di VPS; bedanya sekarang servernya laptop
dan hanya bisa dibuka dari jaringan kantor.

## Pertama kali

Buka PowerShell di folder aplikasi:

```
git pull
npm install
npm run build
```

Kalau di laptop ini **belum pernah** dibuat kata sandi administrator, jalankan dulu `npm start`, buat kata sandi
administrator, lalu tutup jendelanya. Server menolak menyala tanpa kata sandi administrator.

## Menyalakan server

```
npm run server
```

Terminal menampilkan alamatnya, misalnya:

```
PPK Management (mode server) berjalan. Data: C:\Users\...\AppData\Roaming\naskahdinas-ai
Buka di browser:
  http://localhost:8080
  http://192.168.1.25:8080
```

- Di laptop server sendiri: buka `http://localhost:8080`.
- Rekan kerja di Wi-Fi/LAN kantor yang sama: buka alamat `http://192.168...:8080`.
- Pertama kali, **Windows Firewall** bertanya. Centang **Private networks**, klik **Allow access**. Jangan centang *Public*.
  Jaringan kantor harus berprofil *Private* (lihat `docs/AKSES-WEB.md`, langkah A.2).
- Port lain: `npm run server -- --port=8090`.
- Berhenti: tekan **Ctrl+C** di terminal, atau tutup jendela terminal.
- Biarkan laptop tetap menyala dan tidak tidur (A.4 di `docs/AKSES-WEB.md`).

Data yang dipakai **sama** dengan aplikasi desktop di laptop ini. Karena itu aplikasi desktop dan server tidak bisa
jalan bersamaan: bila Anda membuka aplikasi desktop saat server menyala, yang terbuka adalah browser ke `http://localhost:8080`.
Untuk memakai aplikasi desktop lagi, matikan server dulu (Ctrl+C).

### Menyala otomatis saat laptop dihidupkan (opsional)

Buat berkas `ppk-server.bat` berisi (ganti foldernya):

```
cd /d C:\folder\PPK-Enterprise
npm run server
```

Tekan Win+R, ketik `shell:startup`, Enter, lalu taruh shortcut ke `ppk-server.bat` di folder itu.

## Yang bisa dilakukan dari browser

- Semua halaman dan modul, sesuai peran akun staf masing-masing.
- **Unggah**: impor Excel PPK dan register nomor, undangan dan laporan rapat (PDF/Word/foto), template Word.
- **Ekspor**: Excel, PDF, dan Word langsung **diunduh** oleh browser (folder Unduhan di HP/laptop).
- **Buka lampiran** undangan atau laporan: berkasnya diunduh.
- **WhatsApp**: tombol kirim membuka WhatsApp di perangkat yang dipakai.

Belum bisa dari browser (lakukan di aplikasi desktop dengan server dimatikan):

- Cetak langsung. Gantinya: ekspor PDF lalu cetak PDF-nya.
- Backup/restore manual, pengaturan umum, pengaturan server PostgreSQL dan gateway WhatsApp.

## Backup

Server membuat **backup otomatis setiap hari** (yang pertama 1 menit setelah server menyala) ke folder
`backups\otomatis` di folder data, atau ke folder backup yang diatur di Pengaturan. 14 backup terakhir disimpan.
Bila data PPK memakai server PostgreSQL, backup server PPK juga dibuat setiap hari. Salin folder backup ke
penyimpanan lain secara berkala (flashdisk atau Drive kantor) sampai salinan otomatis ke luar tersedia.

## Keamanan

- Sambungan masih **HTTP** tanpa gembok. Aman untuk jaringan kantor yang tertutup. **Jangan** pasang port forwarding
  di router untuk membukanya ke internet; untuk internet, aplikasi dipasang di VPS dengan HTTPS.
- Setiap orang masuk dengan akunnya sendiri. Salah kata sandi 5 kali mengunci akun itu 5 menit, dan 20 kali gagal dari
  satu perangkat/jaringan mengunci percobaan dari sana 15 menit. Semua percobaan masuk tercatat di log aplikasi
  bersama alamat IP-nya.
- Permintaan dari situs lain ditolak, halaman tidak bisa disematkan di situs lain, dan tautan unduhan hanya berlaku
  sekali selama 10 menit untuk sesi yang membuatnya.
- Sesi berakhir bila tidak dipakai 12 jam, saat keluar, atau saat server dimatikan.

## Uji otomatis

`node scripts/smoke-web.cjs` (Linux tanpa layar: `xvfb-run -a node scripts/smoke-web.cjs`) menyalakan server di port 18080
dengan data baru, lalu menguji login, semua halaman, unggah, unduh, dan pengaman di atas lewat browser sungguhan.
