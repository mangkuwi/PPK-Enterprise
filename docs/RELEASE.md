# Rilis dan penandatanganan

## Membuat rilis
1. Naikkan `version` di `package.json` (semver, satu nomor untuk semua OS) dan tulis bagian `## <versi> — <tanggal>` di `CHANGELOG.md`.
2. `git tag v<versi> && git push origin v<versi>`.
3. Workflow **Lintas platform** menjalankan: typecheck, lint, semua test, uji jalan aplikasi (Windows x64, Windows ARM64 bila runner tersedia, macOS Apple Silicon, macOS Intel), pemulihan backup silang Windows ⇄ Mac, build installer, pasang installer lalu jalankan aplikasi terpasang, kemudian membuat **draft** GitHub Release berisi installer, `SHA256SUMS.txt`, dan catatan rilis dengan tabel hasil uji.
4. Periksa draft, lalu terbitkan.

Uji tanpa rilis: tab Actions → **Lintas platform** → **Run workflow**, atau beri label `uji-lintas-os` pada PR.

## Status tanda tangan
| Platform | Tanpa kredensial (sekarang) | Dengan kredensial |
| --- | --- | --- |
| macOS | Tanda tangan ad-hoc, tanpa Hardened Runtime. Gatekeeper menahan pembukaan pertama: klik kanan → Open, atau System Settings → Privacy & Security → Open Anyway. | Developer ID Application + Hardened Runtime + notarisasi Apple + tiket di-staple. Dibuka tanpa peringatan. |
| Windows | Tidak ditandatangani. SmartScreen: More info → Run anyway. | Ditandatangani; peringatan SmartScreen hilang (EV langsung, OV setelah reputasi terbentuk). |

Rilis hanya disebut "dinotarisasi" bila langkah `xcrun stapler validate` dan `spctl -a` di CI lulus. Jangan pernah menyuruh pengguna mematikan Gatekeeper atau menjalankan perintah Terminal.

## Menyiapkan tanda tangan macOS (sekali)
1. Daftar [Apple Developer Program](https://developer.apple.com/programs/) (USD 99/tahun) atas nama pribadi atau instansi.
2. Di Xcode atau developer.apple.com → Certificates: buat **Developer ID Application**. Ekspor dari Keychain Access sebagai `.p12` dengan kata sandi.
3. App Store Connect → Users and Access → Integrations → **App Store Connect API**: buat key (peran Developer). Catat Issuer ID dan Key ID, unduh `AuthKey_XXXX.p8`.
4. GitHub → Settings → Secrets and variables → Actions, tambahkan:

| Secret | Isi |
| --- | --- |
| `MAC_CSC_LINK` | isi `.p12` dalam base64 (`base64 -i cert.p12`) |
| `MAC_CSC_KEY_PASSWORD` | kata sandi `.p12` |
| `APPLE_API_KEY_B64` | isi `AuthKey_XXXX.p8` dalam base64 |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

Jangan kirim berkas atau kata sandi ini lewat chat atau commit. Begitu kelima secret ada, workflow memakai Hardened Runtime (`hardenedRuntime: true`, entitlement di `build/entitlements.mac.plist`: hanya `allow-jit` dan `allow-unsigned-executable-memory` yang dibutuhkan Electron), mengirim ke notarisasi Apple, dan men-staple tiket.

## Menyiapkan tanda tangan Windows (opsional)
Sertifikat code signing OV/EV dari CA (mis. Sectigo, DigiCert) dalam `.pfx`, atau Azure Trusted Signing. Untuk `.pfx`: secret `WIN_CSC_LINK` (base64) dan `WIN_CSC_KEY_PASSWORD`.

## Keamanan
- Windows: installer per pengguna (`perMachine: false`), tidak meminta hak administrator. Data di `%APPDATA%\NASKAHDINAS AI`, hanya dapat diakses akun Windows pengguna.
- macOS: tidak ada entitlement kamera, mikrofon, lokasi, atau jaringan tambahan. Data di `~/Library/Application Support/NASKAHDINAS AI` (izin 700 bawaan folder pengguna). Kunci API di Keychain lewat `safeStorage`.
- Database tidak pernah disimpan di folder instalasi (`.app` atau `Program Files`).
