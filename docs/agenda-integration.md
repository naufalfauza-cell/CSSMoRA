# Integrasi agenda publik — 21 Oktober 2026

Paket `files (8).zip` diintegrasikan di atas commit `ff1aeb7b112b48f39670809c9c56a282d1cbbf34`.

## Implementasi

- Homepage memuat konfigurasi Supabase dan `agenda.js`; placeholder diganti reader agenda publik.
- Maksimal tiga agenda yang sedang berlangsung atau akan datang; label lintas hari mencantumkan kedua tanggal dalam WIB.
- Agenda tanpa `ends_at` berlaku sampai akhir hari mulai dalam WIB. Ini perilaku paket integrasi, belum dukungan agenda seharian yang terpisah.
- Pergantian slide setiap tujuh detik; berhenti saat hover dan tidak dimulai untuk reduced motion.
- `dashboard.js` lama dihapus karena tidak dipakai homepage ini.
- Tabel `public.agenda` dibuat melalui migrasi `20261021042321_create_public_agenda.sql`, sesuai versi riwayat Supabase.
- SQL dari paket disesuaikan: hak tabel eksplisit; publik hanya SELECT baris published; admin memakai allowlist `competition_admins` yang sudah aktif. Tidak ada perubahan akses modul lomba.

## Verifikasi

Jalankan `node tests/agenda.test.cjs` untuk regresi waktu, filter, label, state, escaping, dan carousel.
Policy database diuji dengan transaksi rollback: publik hanya membaca published, nonadmin ditolak menulis, admin dapat CRUD termasuk draf. Data uji tidak disimpan.

## Cakupan berikutnya

Form pengelolaan agenda dalam admin dan kalender lengkap belum termasuk paket ini. Belum ada agenda produksi yang dibuat oleh integrasi. Jika tabel kosong, homepage menampilkan state kosong yang benar.
