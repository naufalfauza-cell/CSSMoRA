# Google Drive dan Google Sheets CSSMoRA

Integrasi memakai akun organisasi `unair@cssmora.org`. Supabase tetap menjadi sumber utama. Drive menyimpan salinan file aplikasi dan arsip backup terenkripsi; satu spreadsheet privat menjadi salinan data yang dapat dibaca.

## 1. Siapkan Google Cloud

1. Gunakan proyek organisasi CSSMoRA dan aktifkan Google Drive API serta Google Sheets API.
2. Atur Audience ke Internal bila tersedia untuk organisasi `cssmora.org`. Buat OAuth client tipe Web application.
3. Tambahkan Authorized redirect URI berikut secara persis:

   `https://xciouilzpxxfqvxsuyqg.supabase.co/functions/v1/drive-integration?action=callback`

4. Integrasi meminta scope `drive.file`, email, dan openid. Scope `drive.file` membatasi akses ke file yang dibuat atau dipakai aplikasi.
5. Server hanya menerima akun `unair@cssmora.org` dengan email terverifikasi.

## 2. Simpan kredensial di Supabase

Di Supabase Dashboard → Edge Functions → Secrets, gunakan nama persis berikut:

- `GOOGLE_DRIVE_CLIENT_ID`: Client ID OAuth Google.
- `GOOGLE_DRIVE_CLIENT_SECRET`: Client secret OAuth Google.
- `GOOGLE_DRIVE_ENCRYPTION_KEY`: kunci acak 32 byte dalam Base64.
- `GOOGLE_DRIVE_ALLOWED_EMAIL`: opsional, bawaan `unair@cssmora.org`.
- `CSSMORA_APP_URL`: opsional, bawaan `https://cssmora.vercel.app/admin.html`.

Jangan kirim client secret atau kunci enkripsi lewat chat, commit, frontend, atau log. Simpan kunci enkripsi di password manager organisasi agar arsip lama bisa dibuka.

## 3. Perilaku sinkronisasi dan backup

- File baru dan file yang sudah ada di tujuh bucket Supabase Storage disalin ke Drive. Antrean diproses tiap menit; kegagalan dicoba ulang. Penghapusan di Supabase diteruskan ke salinan Drive. Retensi foto absensi lima hari tetap berlaku.
- File aplikasi disimpan di folder `CSSMoRA App/Berkas Aplikasi`. Arsip backup tersimpan di `CSSMoRA App/Backup Data`.
- Setiap hari pukul 02.00 WIB, aplikasi membuat arsip `.json.gz.enc`: snapshot JSON dikompres gzip lalu dienkripsi AES-GCM. Arsip baru ditambahkan setiap hari dan tidak dihapus otomatis.
- Pada jadwal yang sama, aplikasi memperbarui satu spreadsheet bernama `CSSMoRA Data Backup`, dengan satu tab untuk setiap tabel bisnis yang diekspor. Tombol **Backup data sekarang** memperbarui arsip terenkripsi dan spreadsheet tersebut secara manual.
- Spreadsheet adalah salinan yang dapat dibaca dan mengikuti izin berbagi akun Drive. Jangan membagikannya ke luar pengurus yang berwenang. Arsip JSON terenkripsi tetap menjadi salinan pemulihan utama; spreadsheet selalu menampilkan snapshot terbaru, bukan riwayat harian.
- Data backup mencakup agenda, anggota, absensi, persuratan, alur program, lomba/prestasi, dan keuangan. Tabel autentikasi, kredensial, dan pembatasan percobaan tidak disertakan.
- Pemulihan arsip terenkripsi memerlukan kunci yang sama dan proses impor yang ditinjau. Backup tidak memulihkan database secara otomatis.

## 4. Arsip PDF persuratan

PDF di bucket `cssmora-letter-pdfs` otomatis disalin ke Drive. Salinan memiliki pemetaan internal pada aplikasi; kolom **Tautan arsip Drive** pada data surat belum diisi otomatis oleh proses penyalinan file.

## 5. Aktivasi

Di Panel Admin → Akses pengurus → Google Drive CSSMoRA, hubungkan akun `unair@cssmora.org`. Setelah tersambung, file antrean mulai diproses dan job backup berjalan sesuai jadwal.
