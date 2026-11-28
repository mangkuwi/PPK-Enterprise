# Membuka PPK Management dari HP dan laptop lain (jaringan kantor)

Satu laptop/komputer menjadi **server**. Rekan kerja yang tersambung ke **Wi-Fi/LAN kantor yang sama** membuka alamat seperti
`http://192.168.1.25:8080` di browser HP atau laptop, lalu masuk dengan akun staf masing-masing. Data tetap di laptop server.
Tidak perlu memasang apa pun di HP.

> Cocok untuk uji coba dan pemakaian di kantor. Alamat ini **tidak** bisa dibuka dari luar kantor (internet), dan memang sengaja begitu.

## A. Siapkan laptop server (sekali saja)

1. **Ambil versi terbaru dan build tampilannya.** Buka Command Prompt / PowerShell di folder aplikasi:
   ```
   git pull
   npm install
   npm run build
   npm start
   ```
   Jendela PPK Management terbuka. Masuk sebagai **Administrator**.
   (Bila memakai aplikasi hasil instalasi `.exe`, cukup buka aplikasinya; langkah ini tidak perlu.)

2. **Jadikan jaringan kantor "Private".** Windows 11: *Settings → Network & internet → Wi-Fi* (atau *Ethernet*) → klik nama jaringan →
   *Network profile type* → pilih **Private network**. Di jaringan "Public", Windows menolak sambungan dari HP.

3. **Buat akun untuk rekan kerja.** *Pengaturan → PPK → Akun Staf → Tambah akun*. Setiap orang memakai nama dan kata sandinya sendiri
   (minimal 8 karakter). Peran menentukan apa yang boleh dilihat dan diubah, sama seperti di aplikasi desktop.

4. **Jangan biarkan laptop tidur.** *Settings → System → Power & battery → Screen and sleep*: saat dicolok listrik, **Make my device sleep after → Never**.
   Sambungkan laptop ke charger selama dipakai sebagai server.

## B. Nyalakan akses web

1. Di laptop server buka **Pengaturan → Server PPK**.
2. Pada kotak **Akses lewat browser (HP & laptop lain)** biarkan port `8080`, lalu klik **Nyalakan akses web**.
3. **Windows Firewall** akan bertanya pertama kali. Centang **Private networks** lalu klik **Allow access / Izinkan akses**.
   Jangan centang *Public networks*.
4. Alamat web muncul di kotak biru, misalnya `http://192.168.1.25:8080`. Bagikan alamat ini ke rekan kerja.

Akses web menyala lagi otomatis setiap kali aplikasi dibuka, sampai Anda klik **Matikan**.

## C. Rekan kerja membuka dari HP / laptop

1. Sambungkan HP ke **Wi-Fi kantor yang sama** dengan laptop server (bukan data seluler, bukan Wi-Fi tamu).
2. Buka Chrome / Safari, ketik alamatnya persis, termasuk `http://` dan `:8080`.
3. Pilih nama, isi kata sandi, klik **Masuk**.
4. Menu ada di tombol **☰** kiri atas. Tabel yang lebar bisa digeser ke samping dengan jari.
5. Agar mudah dibuka lagi: Chrome → ⋮ → **Add to Home screen**; Safari → Bagikan → **Add to Home Screen**.

## Yang perlu diketahui

- Laptop server harus **menyala dan aplikasi terbuka**. Bila aplikasi ditutup, HP menampilkan "Tidak terhubung ke komputer server PPK".
- Dari browser **tidak bisa**: memilih/mengunggah berkas, menyimpan ekspor Excel/PDF, mencetak, backup/restore, dan mengubah pengaturan
  komputer server. Semua itu tetap dilakukan di laptop server.
- Setiap browser punya sesi sendiri. Sesi berakhir bila tidak dipakai 12 jam, saat keluar, atau saat aplikasi di laptop server ditutup.
- Salah kata sandi 5 kali mengunci akun itu 5 menit (sama seperti desktop). Semua login tercatat di log audit.
- Sambungan memakai **HTTP biasa** (tanpa gembok). Aman untuk jaringan kantor yang tertutup, jangan dibuka ke internet
  (jangan pasang port forwarding di router).

## Jika tidak bisa dibuka

| Gejala | Coba |
|---|---|
| HP: "This site can't be reached" / lama lalu gagal | Pastikan HP di Wi-Fi yang sama. Jaringan laptop harus *Private*. Cek firewall (di bawah). Banyak Wi-Fi **tamu** memblokir sambungan antar perangkat; pakai Wi-Fi internal kantor. |
| Kotak Akses web menulis "Port 8080 sedang dipakai program lain" | Ganti port, misalnya `8090`, klik **Nyalakan akses web**, lalu pakai alamat yang baru. |
| Tidak ada alamat di kotak biru | Laptop belum tersambung ke jaringan. Sambungkan Wi-Fi/LAN lalu klik **Mulai ulang**. |
| Alamat berubah setiap hari | Alamat IP laptop diberikan otomatis oleh router. Minta admin jaringan memberi IP tetap untuk laptop ini. |
| Muncul "Tampilan aplikasi belum di-build" | Jalankan `npm run build` di laptop server, lalu buka ulang aplikasinya. |

**Firewall terlewat atau salah klik?** Buka PowerShell **sebagai Administrator** di laptop server lalu jalankan (sesuaikan port):
```
New-NetFirewallRule -DisplayName "PPK Management Web" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private,Domain
```
Untuk menutupnya lagi: `Remove-NetFirewallRule -DisplayName "PPK Management Web"`.
