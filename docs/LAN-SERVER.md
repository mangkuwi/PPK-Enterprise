# Server PPK di jaringan kantor (PostgreSQL)

Mode server membuat beberapa komputer memakai **satu** database PPK (anggaran, kontrak, tagihan, pembayaran, penyedia, laporan).
Dokumen, template, dan penomoran surat tetap di komputer masing-masing. Tanpa server, aplikasi tetap bekerja seperti biasa dengan data lokal.

## 1. Pasang PostgreSQL di satu komputer (komputer server)
Pilih komputer yang selalu menyala selama jam kerja dan beralamat IP tetap (minta IP tetap ke admin jaringan, mis. `192.168.1.10`).

- **Windows:** unduh installer PostgreSQL 16 dari postgresql.org/download/windows (EDB). Saat instalasi catat kata sandi pengguna `postgres` dan biarkan port `5432`.
- **macOS:** Postgres.app (postgresapp.com) atau installer EDB.

Versi yang diuji: PostgreSQL 13 dan 16 (CI) serta 16 (lokal). Versi lebih lama tidak didukung.

## 2. Buat database dan pengguna khusus aplikasi
Buka **SQL Shell (psql)** atau pgAdmin sebagai `postgres`, lalu jalankan (ganti kata sandinya):

```sql
CREATE ROLE ppk_app LOGIN PASSWORD 'ganti-dengan-kata-sandi-panjang';
CREATE DATABASE ppk OWNER ppk_app ENCODING 'UTF8';
```

Aplikasi tidak memakai pengguna `postgres`; `ppk_app` hanya pemilik database `ppk`.

## 3. Izinkan komputer kantor tersambung
1. `postgresql.conf` (folder data PostgreSQL): `listen_addresses = '*'`
2. `pg_hba.conf`, tambahkan satu baris untuk jaringan kantor saja (sesuaikan alamatnya):
   ```
   host  ppk  ppk_app  192.168.1.0/24  scram-sha-256
   ```
3. Mulai ulang layanan PostgreSQL (Windows: Services → postgresql-x64-16 → Restart).
4. Firewall Windows di komputer server: izinkan port TCP 5432 **hanya** untuk profil jaringan *Private/Domain*, bukan *Public*.
   Jangan membuka port 5432 ke internet.

## 4. Sambungkan aplikasi
Di komputer yang datanya akan dipakai bersama (biasanya komputer PPK utama):
1. Masuk sebagai administrator aplikasi yang sudah ber-PIN.
2. **PPK Management → Server PPK**: isi alamat server, port `5432`, database `ppk`, pengguna `ppk_app`, kata sandi → **Uji koneksi** → **Simpan**.
3. Pilih salah satu:
   - **Pindahkan data PPK komputer ini ke server**: semua data PPK, pengguna (beserta PIN), dan log audit PPK disalin dalam satu transaksi.
     Sesudah salin, jumlah baris dan total rupiah setiap tabel dicocokkan; bila ada yang beda, semuanya dibatalkan. Berkas lokal tidak dihapus.
   - **Server baru tanpa data**: server kosong dengan administrator = pengguna ini dan PIN baru.
   - **Pulihkan backup server**: isi server kosong dari berkas `ppk-server-*.json.gz`.

Di komputer lain: isi alamat yang sama → **Simpan** → **Gunakan server ini**. Setiap orang lalu masuk dengan pengguna server dan PIN-nya.
Pengguna server dibuat Admin PPK di halaman Server PPK; perannya diatur di **Pengaturan PPK → Peran Pengguna**. Semua pengguna server wajib ber-PIN.

## Keamanan dan aturan data
- Kata sandi database disimpan terenkripsi oleh sistem operasi (DPAPI di Windows, Keychain di macOS) dan tidak pernah dikirim ke tampilan.
- Aturan riwayat sama dengan versi lokal dan dijaga trigger di server: tagihan terverifikasi tidak dapat diubah, pembayaran/SP2D/addendum hanya dapat dibatalkan dengan alasan, penyedia/kontrak/baris anggaran tidak dapat dihapus, log audit tidak dapat diubah.
- Dua orang yang menyimpan bersamaan tidak bisa sama-sama melewati sisa kontrak: transaksi berjalan *serializable*, yang kalah diulang otomatis lalu ditolak dengan pesan biasa.
- Semua komputer harus memakai **versi aplikasi yang sama**; aplikasi menolak masuk bila versi data server berbeda.
- Lalu lintas ke server belum dienkripsi TLS. Pakai hanya di LAN kantor yang tepercaya (bukan Wi-Fi tamu, bukan lewat internet).

## Backup
- Dengan **Backup otomatis** aktif (Pengaturan), setiap komputer yang membuka aplikasi menyimpan salinan server sekali sehari ke `<folder backup>/otomatis/ppk-server-*.json.gz` (dibaca ulang dan dicocokkan sebelum dianggap jadi; disimpan N terbaru).
- Admin PPK dapat menekan **Backup server sekarang** di halaman Server PPK.
- Disarankan juga backup dari sisi server, mis. Task Scheduler harian:
  `"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U ppk_app -Fc -f D:\Backup\ppk-%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.dump ppk`
- Backup aplikasi lokal (`naskahdinas-*.zip`) tetap berisi dokumen dan penomoran; di mode server data PPK terbarunya ada di backup server, bukan di zip lokal.

## Kembali ke data lokal
**Server PPK → Kembali ke data lokal** membuka lagi data PPK lokal yang lama. Perubahan yang dicatat di server tidak ikut kembali.
