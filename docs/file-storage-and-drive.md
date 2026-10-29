# Penyimpanan berkas dan Google Drive CSSMoRA

## Sumber data dan penyimpanan

- Supabase tetap menjadi sumber data utama aplikasi.
- File asli tetap disimpan di bucket Supabase dan disalin ke folder privat CSSMoRA di Google Drive.
- Salinan Drive diproses oleh antrean server-side. Unggahan baru dan objek yang sudah ada saat integrasi diaktifkan masuk antrean; file sumber Supabase tidak dihapus.
- Bucket yang disalin: attendance-proofs, cssmora-achievement-certificates, cssmora-agenda-programs, cssmora-letter-pdfs, cssmora-prestasi-proofs, cssmora-signer-assets, dan posters.
- Penghapusan dari Supabase ikut mengantrekan penghapusan salinan Drive. Foto absensi tetap mengikuti retensi lima hari.
- Bukti absensi, bukti pengajuan, PDF surat, serta aset tanda tangan tetap berada di folder Drive privat. Aplikasi tidak membagikan folder itu ke publik.
- Data backup aplikasi dibuat sekali sehari, dikompres dan dienkripsi dengan AES-256-GCM sebelum diunggah. Berkas backup tidak otomatis dihapus.

## Batasan

- Koneksi belum aktif sampai OAuth Google dikonfigurasi, fungsi Edge Function dideploy, dan migrasi diterapkan. Lihat [langkah aktivasi](google-drive-setup.md).
- Unggahan lama juga disalin sebagai salinan; aplikasi tetap membaca file dari Supabase, jadi Drive bukan sumber utama.
- Backup mencakup tabel bisnis yang disebutkan di migrasi. Tabel autentikasi Supabase, password, token OAuth, serta tabel percobaan/rate-limit tidak diekspor.
- Backup adalah snapshot logis JSON terkompresi dan terenkripsi; backup ini bukan dump skema PostgreSQL atau pemulihan point-in-time.
- Simpan salinan aman dari nilai GOOGLE_DRIVE_ENCRYPTION_KEY di password manager organisasi. Tanpa kunci yang sama, berkas backup tidak dapat didekripsi.

