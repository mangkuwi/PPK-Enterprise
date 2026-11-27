# Gateway WhatsApp PPK Agenda Center

Layanan kecil di VPS yang menerima webhook WhatsApp Business Cloud API (Meta), mengunduh lampiran undangan, lalu menyimpannya sampai aplikasi desktop menariknya.

```
Staf ──WhatsApp──▶ Meta ──webhook HTTPS──▶ Nginx ─▶ Gateway ─▶ PostgreSQL (VPS)
                                                        ▲
Aplikasi desktop PPK ──tarik tiap 60 detik (kunci API)──┘
```

- Hanya menerima pesan. Gateway tidak mengirim pesan WhatsApp keluar.
- Setiap webhook dicatat mentah di `wa_webhook_log`. Pesan yang dikirim ulang oleh Meta diabaikan karena `wa_message_id` bersifat unik.
- Lampiran (PDF, DOCX, foto) diunduh oleh satu worker antrean di tabel `gw_jobs`. Unduhan dicoba sampai 3 kali dengan jeda.
- File disimpan utuh (BYTEA) dan hanya bisa diambil lewat API dengan kunci. Tidak ada URL file publik.
- Tidak ada AI atau OCR. Pesan berformat "AGENDA PPK" dibaca di aplikasi desktop dan hanya mengisi formulir agenda yang diperiksa staf.

## Kebutuhan

- VPS Ubuntu 24.04, minimal 1 vCPU, RAM 1 GB, disk 20 GB.
- Domain atau subdomain yang mengarah ke IP VPS, misalnya `gateway.kantor.go.id`.
- Docker Engine dan plugin Compose (`apt install docker.io docker-compose-v2`), dan `certbot`.
- Akun Meta for Developers, aplikasi jenis Business dengan produk WhatsApp, dan nomor WhatsApp Business.

## Pasang

1. Salin folder `gateway/` ke VPS, misalnya ke `/opt/ppk-gateway`.
2. Buat sertifikat HTTPS. Port 80 harus masih kosong, jadi lakukan sebelum Nginx jalan:
   ```
   sudo certbot certonly --standalone -d gateway.kantor.go.id
   ```
3. Buat file `.env` dari contoh, lalu isi semua nilainya:
   ```
   cp .env.example .env && nano .env
   openssl rand -hex 32   # untuk GATEWAY_API_KEY, juga untuk POSTGRES_PASSWORD dan WA_VERIFY_TOKEN
   chmod 600 .env
   ```
4. Jalankan dan periksa:
   ```
   docker compose up -d --build
   curl https://gateway.kantor.go.id/health     # {"ok":true}
   docker compose logs -f gateway
   ```
5. Atur perpanjangan sertifikat otomatis lewat webroot:
   ```
   sudo certbot reconfigure --cert-name gateway.kantor.go.id --webroot -w /opt/ppk-gateway/certbot-www \
     --deploy-hook "docker compose -f /opt/ppk-gateway/docker-compose.yml exec nginx nginx -s reload"
   ```

## Hubungkan ke Meta

1. Buka Meta for Developers, pilih aplikasi Anda, lalu **WhatsApp → Configuration → Webhook → Edit**.
2. Isi **Callback URL** dengan `https://gateway.kantor.go.id/webhook`.
3. Isi **Verify token** dengan nilai `WA_VERIFY_TOKEN` dari `.env`, lalu klik **Verify and save**.
4. Pada **Webhook fields**, langganan (subscribe) **messages**.
5. Untuk `WA_ACCESS_TOKEN`, buat System User di Business Settings dengan izin `whatsapp_business_messaging`, lalu buat token permanen. Token sementara 24 jam akan membuat unduhan lampiran gagal keesokan harinya.
6. Untuk `WA_APP_SECRET`, salin dari **App settings → Basic → App secret**.

Uji dengan mengirim pesan dan sebuah PDF ke nomor WhatsApp Business, lalu cek `docker compose logs gateway`. Integrasi baru dianggap berjalan setelah uji ini berhasil.

## Hubungkan aplikasi desktop

Login sebagai administrator PPK, buka **Kotak Masuk WhatsApp**, lalu klik **Atur Gateway**. Isi alamat `https://gateway.kantor.go.id` dan kunci `GATEWAY_API_KEY`, lalu klik **Uji dan simpan**.

Kunci tersimpan terenkripsi di komputer tersebut. Setelah itu pesan ditarik otomatis setiap 60 detik selama aplikasi terbuka, atau bisa ditarik langsung dengan **Tarik sekarang**.

Kalau beberapa komputer memakai server PPK yang sama, cukup satu komputer yang diatur. Kalau lebih dari satu yang diatur, pesan tetap tidak akan masuk dua kali.

## Perawatan

- Backup: `docker compose exec postgres pg_dump -U gateway gateway | gzip > gateway-$(date +%F).sql.gz`
- Pembaruan: salin kode baru, lalu jalankan `docker compose up -d --build`. Skema database hanya ditambah, tidak pernah dihapus.
- Lampiran yang gagal diunduh tetap masuk ke Kotak Masuk dengan status **Gagal diproses** beserta alasannya. Minta pengirim mengirim ulang file tersebut.
