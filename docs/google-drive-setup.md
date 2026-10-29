# Mengaktifkan Google Drive CSSMoRA

Integrasi membuat folder privat CSSMoRA App di Google Drive akun organisasi. File aplikasi disalin dari Supabase ke Drive, sedangkan Supabase tetap menjadi sumber utama. Tabel bisnis dibackup setiap hari pukul 02.00 WIB dalam berkas JSON gzip terenkripsi.

## 1. Siapkan proyek Google Cloud

1. Gunakan proyek Google Cloud milik organisasi CSSMoRA dan aktifkan Google Drive API.
2. Atur OAuth consent screen untuk pengguna organisasi CSSMoRA. Buat OAuth client bertipe Web application.
3. Tambahkan Authorized redirect URI berikut secara persis:

   https://xciouilzpxxfqvxsuyqg.supabase.co/functions/v1/drive-integration?action=callback

4. Integrasi memakai scope drive.file, email, dan openid. Scope Drive ini membatasi aplikasi ke file yang dibuat atau dipakai aplikasi; aplikasi tidak meminta akses menyeluruh ke Drive.
5. Akun yang diterima dibatasi ke unair@cssmora.org. Parameter domain Google hanya membantu memilih akun; server tetap memeriksa alamat email yang diverifikasi.

## 2. Simpan kredensial di Supabase

Di Supabase Dashboard → Edge Functions → Secrets, tambahkan:

- GOOGLE_DRIVE_CLIENT_ID: Client ID OAuth Google.
- GOOGLE_DRIVE_CLIENT_SECRET: Client secret OAuth Google.
- GOOGLE_DRIVE_ENCRYPTION_KEY: kunci acak 32 byte dalam Base64. Buat, misalnya, dengan openssl rand -base64 32.
- GOOGLE_DRIVE_ALLOWED_EMAIL: unair@cssmora.org (opsional; ini nilai bawaan).
- CSSMORA_APP_URL: https://cssmora.vercel.app/admin.html (opsional; ini nilai bawaan).

Jangan kirim client secret atau kunci enkripsi lewat chat, commit, frontend, atau log. Simpan kunci enkripsi terpisah di password manager organisasi agar backup lama tetap bisa dibuka.

## 3. Deploy dan aktifkan

1. Deploy supabase/functions/drive-integration/index.ts dengan verify_jwt=false. Fungsi memvalidasi sesi Supabase dan peran pengurus sendiri; callback OAuth dan jadwal juga memiliki pemeriksaan khusus.
2. Terapkan migrasi Google Drive. Migrasi membuat tabel privat, antrean file, job harian backup, dan token jadwal acak di Supabase Vault.
3. Masuk ke Panel Admin → Akses pengurus → Google Drive CSSMoRA.
4. Pilih Hubungkan Drive CSSMoRA UNAIR dan setujui akses sebagai unair@cssmora.org.
5. Muat status. Folder privat, jumlah antrean, dan waktu backup terakhir akan tampil di panel.

Jangan menaruh token Supabase service-role ke browser. Migrasi menggunakan token jadwal acak di Vault, terpisah dari kredensial OAuth.

## Perilaku setelah aktif

- File baru dan file yang sudah ada di tujuh bucket disalin ke Drive. Proses antrean berjalan tiap menit dan mencoba ulang unggahan yang gagal.
- File berada di folder Berkas Aplikasi; backup terenkripsi berada di Backup Data. Keduanya berada di bawah CSSMoRA App.
- Penghapusan file dari Supabase diteruskan ke salinan Drive. Foto absensi yang kedaluwarsa karena retensi lima hari juga dihapus dari salinan.
- Backup berjalan setiap hari pukul 02.00 WIB. Backup baru ditambahkan sebagai file terpisah; tidak ada penghapusan backup otomatis.
- Backup memuat tabel bisnis operasional yang ditentukan migrasi, termasuk agenda, anggota, absensi, persuratan, alur program, lomba/prestasi, dan keuangan. Tabel autentikasi, kredensial, serta tabel pembatasan percobaan tidak disertakan.
- File backup memakai format CSSMORA-DRIVE-BACKUP-V1, diikuti nonce AES-GCM dan ciphertext dari JSON gzip. Pemulihan perlu kunci enkripsi yang sama dan proses impor data yang ditinjau; migrasi tidak mengubah atau menghapus data sumber.

## Status penerapan

Kode ini disiapkan untuk ditinjau. Integrasi belum aktif di production sampai perubahan disetujui, Edge Function dideploy, rahasia OAuth dikonfigurasi, dan migrasi diterapkan.
