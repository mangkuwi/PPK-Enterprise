# Kirim undangan via WhatsApp

## Mode bawaan: WhatsApp Desktop / Web
1. Simpan surat, lalu tekan **Kirim via WhatsApp**. PDF dibuat di `<data aplikasi>/kirim-whatsapp/` (dihapus otomatis setelah 30 hari).
2. Isi penerima (nomor `08…`, `62…`, atau `+62…`), tekan **Simpan daftar penerima**.
3. **Buka WhatsApp** membuka chat dengan pesan terisi. Lampirkan PDF sendiri (tombol *Tampilkan di folder*), lalu tekan Kirim di WhatsApp.

Aplikasi hanya mencatat "WhatsApp dibuka". Aplikasi tidak bisa tahu pesan benar-benar terkirim.

## Mode WhatsApp Business API (opsional)
Aktifkan hanya bila akun WhatsApp Business, nomor bisnis, token, dan persetujuan administrator sudah ada.
1. Di Meta for Developers: buat aplikasi Business, tambahkan produk WhatsApp, daftarkan nomor bisnis, buat token akses permanen (System User) dengan izin `whatsapp_business_messaging`.
2. Di aplikasi: *Pengaturan → WhatsApp Business API* (administrator ber-PIN). Isi Phone Number ID dan token, lalu aktifkan.
3. Token disimpan terenkripsi (DPAPI/Keychain), tidak pernah dikirim ke tampilan dan tidak ditulis ke log.

Batas yang diketahui:
- WhatsApp hanya mengizinkan pesan bebas dalam 24 jam setelah penerima terakhir mengirim pesan. Di luar itu perlu template pesan yang disetujui Meta; belum didukung.
- Status terkirim/sampai/dibaca butuh webhook publik. Penerima webhook belum dibuat, jadi status berhenti di "Diserahkan ke WhatsApp".
