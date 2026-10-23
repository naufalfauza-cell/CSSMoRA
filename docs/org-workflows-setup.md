# Setup fitur proker, keuangan, dan rekap prestasi

Fitur ini dikirim sebagai perubahan aplikasi dan migrasi baru. Fitur belum aktif pada production sebelum migration dan Edge Functions diterapkan serta koneksi AkunPro disiapkan.

## 1. Database proker

Jalankan `supabase/migrations/20261023140000_cssmora_admin_workflows.sql` pada project CSSMoRA. Rincian siklus, periode, tujuan, sasaran, jadwal, PIC, dan anggaran disimpan di `cssmora_program_details`, terpisah dari pustaka agenda/foto yang sudah dipakai agenda. Ketua, Wakil, dan BPH/Departemen dapat mengelola rincian proker.

## 2. Bendahara dan koneksi AkunPro

Fitur keuangan mencatat RKAP, prognosa, realisasi, dan transaksi berpasangan. Pengiriman transaksi ke AkunPro memakai antrean dan ID eksternal yang idempoten. Data transaksi yang sudah dikirim tidak dapat diubah dari CSSMoRA.

Sebelum koneksi dapat dipakai:

1. Siapkan organisasi bertipe nonprofit dengan nama yang memuat `CSSMoRA` di AkunPro. Saat implementasi ini dibuat, belum ditemukan organisasi CSSMoRA pada data AkunPro yang terhubung.
2. Terapkan migration `20261023150000_cssmora_ingest.sql` dan Edge Function `cssmora-bridge` dari branch fitur AkunPro.
3. Set `CSSMORA_AKUNPRO_ORG_ID` ke ID organisasi tersebut dan `CSSMORA_BRIDGE_SECRET` sebagai secret Edge Function AkunPro.
4. Set secret Edge Function CSSMoRA: `AKUNPRO_BRIDGE_URL`, `AKUNPRO_PUBLISHABLE_KEY`, dan `AKUNPRO_BRIDGE_SECRET`. URL bridge berbentuk `https://<project-ref-akunpro>.supabase.co/functions/v1/cssmora-bridge`.
5. Gunakan secret acak kuat yang sama pada kedua project. Simpan lewat pengaturan secret Supabase; jangan taruh secret di source, browser, atau chat.
6. Pertahankan verifikasi JWT untuk `akunpro-integration`. `submit-achievement-record` perlu menerima kiriman publik, jadi deploy dengan verifikasi JWT dimatikan khusus untuk fungsi itu; validasi ukuran, tipe file, tanda tangan file, rate limit, dan storage privat tetap berjalan di fungsi.

Kode akun dipilih dari bagan akun AkunPro jika koneksi siap. Bridge menolak kode yang tidak sesuai jenis akun, periode yang sudah ditutup, jurnal tidak seimbang, dan kiriman ganda.

## 3. Form prestasi publik

Form tersedia di `rekap-prestasi.html` dan tertaut dari halaman bantuan lomba. Anggota memilih nama dari roster aktif, mengisi individu/tim, tingkat lomba, jenis, hasil, tanggal, dan dapat menyertakan email kontak. Sertifikat maksimal 5 MB disimpan privat. Ketua, Wakil, dan BPH/Departemen meninjau; hanya capaian yang disetujui muncul pada rekap publik.

## Pemeriksaan sebelum aktivasi

- Jalankan seluruh perintah regresi yang tercantum di `PROJECT_RULES.md`.
- Terapkan migration pada Supabase development/staging lebih dulu, lalu uji role Bendahara, Ketua, BPH, dan akses anonim.
- Uji alur kirim jurnal dengan organisasi AkunPro dan bagan akun yang valid. Jangan menguji transaksi contoh pada organisasi produksi.
- Jangan kirim secret melalui repository atau permintaan pull.
