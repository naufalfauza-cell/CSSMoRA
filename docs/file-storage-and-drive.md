# Penyimpanan berkas CSSMoRA

## Kondisi dan batas perubahan ini

- Supabase tetap menjadi sumber data utama untuk agenda, anggota, absensi, persuratan, proker, dan prestasi.
- Berkas masih disimpan di bucket Supabase yang sudah dipakai aplikasi. Adapter bersama pada `supabase/functions/_shared/storage-provider.mjs` sekarang membungkus upload, pemeriksaan metadata, tautan unggah bertanda tangan, tautan baca sementara, dan penghapusan untuk Edge Function.
- Pengajuan absensi, bantuan lomba, dan pelaporan prestasi tetap memakai bucket serta aturan akses yang sudah berlaku. Foto absensi tetap privat dan masa simpannya tetap lima hari.
- Foto proker dan poster yang diunggah dari panel admin masih memakai endpoint Storage Supabase langsung. Alih provider penuh belum boleh dilakukan sebelum alur panel admin itu dipindahkan ke layanan bersama.
- Integrasi Google Drive belum aktif. Adapter saat ini hanya menerima provider `supabase`; pemanggilan `google-drive` akan ditolak dengan jelas.

## Kontrak berkas ke depan

Modul bisnis sebaiknya menerima referensi berkas logis, bukan membangun URL provider sendiri:

```js
{ provider: 'supabase', bucket: 'attendance-proofs', path: 'agenda-id/anggota-id/proof.jpg' }
```

Saat Google Drive ditambahkan, referensi perlu diperluas dengan ID file Drive dan metadata arsip. URL unduh tidak disimpan sebagai identitas utama karena URL bertanda tangan dapat kedaluwarsa. Catatan bisnis tetap berada di Supabase; Drive hanya menjadi penyimpanan dokumen/media.

## Syarat sebelum mengaktifkan Drive

1. Tambahkan skema lampiran yang menyimpan provider, ID/path objek, tipe MIME, ukuran, privasi, masa retensi, dan relasi ke catatan bisnis. Buat migrasi baru; jangan mengubah migrasi yang sudah diterapkan.
2. Pindahkan seluruh unggah, baca, dan hapus berkas dari panel admin ke adapter server-side. Rahasia OAuth dan token refresh hanya boleh berada di sisi server.
3. Pertahankan bucket privat dan tautan baca sementara untuk bukti absensi, bukti pengajuan, serta sertifikat. Berkas publik seperti poster perlu kebijakan publik yang disengaja.
4. Salin berkas lama tanpa menghapus sumber. Cocokkan jumlah, ukuran, tipe, dan checksum; uji akses per peran; baru ganti referensi aktif.
5. Terapkan retensi lima hari untuk foto absensi di provider baru dan verifikasi proses penghapusan sebelum membersihkan berkas lama.

Integrasi Drive dan migrasi berkas lama adalah pekerjaan terpisah dan belum dijalankan oleh perubahan ini.
