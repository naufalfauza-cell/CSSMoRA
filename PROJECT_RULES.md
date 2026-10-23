# Aturan proyek CSSMoRA — baseline terkunci

**Status:** keputusan produk dan perilaku di bawah ini dikunci per 23 Oktober 2026.  
**Baseline kode:** `22b89aa08c14e2d8a3f0edeb4bd7586037bfcaf0` (sebelum aturan ini ditambahkan).

Dokumen ini adalah sumber utama untuk semua agen, kontributor, dan alat AI. `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, dan `.github/copilot-instructions.md` wajib merujuk ke dokumen ini.

## Aturan perubahan yang wajib

1. Jangan menghapus, mengganti makna, melemahkan, atau mengakali keputusan terkunci di bawah ini.
2. Perubahan fitur harus bersifat tambahan dan mempertahankan alur lama. Jika kebutuhan baru bertentangan dengan aturan terkunci, jangan memilih salah satunya sendiri: kerjakan bagian yang tidak bertentangan lalu minta arahan pemilik proyek untuk konflik tersebut.
3. Aturan ini, instruksi agen, `CODEOWNERS`, workflow CI, pengujian regresi, dan riwayat migrasi Supabase adalah berkas terlindungi. Agen tidak boleh mengubah atau menghapusnya tanpa permintaan eksplisit pemilik proyek yang menyebut aturan/berkas yang hendak diubah.
4. Dilarang menghapus atau mengendurkan tes agar perubahan terlihat lulus. Tambahkan tes regresi untuk perilaku baru atau perbaikan bug.
5. Migrasi yang telah diterapkan ke Supabase bersifat append-only. Buat migrasi baru; jangan mengedit migrasi lama, mereset data, menghapus tabel/kolom, atau mengubah kebijakan RLS aktif tanpa instruksi eksplisit.
6. Jangan menaruh service-role key, token, kata sandi, atau rahasia lain di frontend, dokumentasi publik, commit, atau log.
7. Jangan deploy ke production kecuali pengguna secara jelas meminta deployment.

## Keputusan produk dan perilaku yang terkunci

### Akses dan sesi

- Situs publik tetap dapat dibuka tanpa login. Panel pengurus menggunakan login Supabase yang terpisah.
- Ketua dan Wakil Ketua memiliki akses lintas bidang, termasuk Sekretariat, Bendahara, dan peninjauan bantuan lomba.
- Sekretaris mengelola data anggota, absensi, dan persuratan. Bendahara mengelola pekerjaan keuangan dan tahap peninjauan bantuan lomba sesuai perannya.
- BPH/departemen dapat memakai fitur organisasi umum, tetapi tidak memperoleh akses ke data/aksi vital Sekretariat, Bendahara, atau pengajuan uang.
- Akun Ketua yang ditetapkan pemilik proyek boleh memiliki akses penuh untuk simulasi. Jangan mengubah pengecualian ini menjadi hak semua akun atau alamat email publik.
- Saat reload, panel memulihkan tab pengurus terakhir. Gangguan jaringan sementara tidak menghapus sesi yang masih valid; sesi dibersihkan hanya setelah kegagalan autentikasi yang benar-benar menandakan sesi tidak sah.

### Lomba publik

- Poster yang diunggah adalah visual utama kartu dan detail lomba; jangan menggantinya dengan URL poster atau placeholder bila poster tersedia.
- Status buka/tutup pendaftaran, tenggat, biaya, penyelenggara, dan tautan pendaftaran harus tetap konsisten antara daftar dan rincian.
- Draf yang tidak dipublikasikan tidak boleh tampil sebagai agenda/lomba publik.

### Agenda dan videotron

- Agenda memakai waktu WIB dan tanggal mulai/selesai. Agenda lintas hari menampilkan kedua tanggal.
- Videotron menampilkan paling banyak enam agenda dan berpindah otomatis setiap tiga detik; kontrol pause tidak ditambahkan.
- Agenda yang ditarik atau belum diterbitkan tidak boleh muncul dari cache lama. Bila sumber gagal dimuat, tampilkan status gagal/memuat yang jelas, bukan data draf usang.
- Kalender tetap dapat dipilih per tanggal dan menampilkan agenda pada tanggal terkait. Bar merek atas tetap tersedia saat halaman digulir.

### Absensi

- Anggota tidak perlu login. Absensi hanya tersedia saat pengurus membuka kegiatan; jika tidak ada kegiatan terbuka, peserta tidak dapat mengirim absensi.
- Form memilih angkatan terlebih dahulu, lalu anggota yang cocok; prodi dan nama harus berasal dari data roster, bukan teks bebas.
- Tidak memakai kode bergilir atau QR. Validasi kehadiran tetap dilakukan oleh sistem dan pengurus.
- Bukti foto dikompres otomatis di aplikasi hingga batas penyimpanan yang ditetapkan; file absensi dihapus otomatis setelah lima hari.
- Pembaruan roster dan penyimpanan harus menjaga bukti foto yang sudah ada serta menolak penyimpanan usang yang menimpa perubahan terbaru.

### Pengajuan bantuan prestasi/lomba

- Form meminta email resmi, identitas lomba, jenis individu/tim, peserta dari roster CSSMoRA, biaya, tautan informasi, dan rekening pencairan.
- Aturan subsidi progresif untuk pengajuan baru: 100% dari Rp15.000 biaya pertama; 75% dari bagian Rp15.001–Rp25.000; 50% dari bagian Rp25.001–Rp40.000; dan 25% dari bagian Rp40.001–Rp80.000. Total subsidi tim mencapai plafon Rp40.000 pada biaya Rp80.000 dan tidak turun saat biaya bertambah; biaya di atasnya tetap dibatasi Rp40.000. Individu menerima 50% dari nominal subsidi tim pada biaya yang sama (maksimal Rp20.000). Persentase berlaku pada bagian biaya di rentang masing-masing, bukan seluruh biaya. Pengajuan lama mempertahankan versi aturan saat diajukan. Nilai pengajuan dihitung otomatis; perubahan rumus berikutnya memerlukan instruksi eksplisit pemilik.
- Persetujuan berjalan berurutan melalui Bendahara lalu Ketua, dengan jejak peninjauan dan catatan status.
- Bukti pendaftaran disimpan untuk peninjauan. Bukti transfer dibagikan manual oleh Bendahara melalui WhatsApp; jangan mewajibkan unggah bukti transfer ke aplikasi. Peserta menyetujui pengembalian 5% hadiah ke kas CSSMoRA.
- Setelah disetujui, daftar tetap berbentuk tabel; rincian dan status dibuka saat baris dipilih.

### Absensi media dan unggahan

- Kompresi gambar berlangsung di aplikasi, tanpa layanan kompresi eksternal. Foto dokumentasi program kerja dikecualikan dari kompresi.
- Pertahankan bucket privat, RLS, batas ukuran/jenis file, dan jadwal pembersihan. Jangan membuat bukti absensi atau bukti pengajuan dapat diakses publik.

### Persuratan

- Nomor surat dibuat dari pilihan jenis surat, cakupan, divisi, tanggal, dan urutan periode; pengguna tidak mengetik kode klasifikasi secara manual.
- Periode baru 2026/2027 mulai dari nomor 1. Nomor yang sudah terbit tidak boleh dihitung ulang, diganti, atau dihapus karena koreksi UI.
- Arsip Drive dan status arsip ditautkan ke catatan surat. Jangan mengklaim integrasi Google Drive API telah aktif kecuali benar-benar sudah dibangun dan diuji.

### Tampilan

- Pertahankan tema hijau CSSMoRA, font modern Outfit dan Plus Jakarta Sans, skala ringkas panel pengurus, dan hierarki sidebar.
- Komposisi dashboard, video latar, tata letak empat agenda per baris, dan batas enam item videotron tidak diubah saat memoles bagian lain.
- Tampilan tabel, poster, formulir, dan tombol boleh dipoles selama alur, ukuran ringkas, kontras, akses keyboard, dan perilaku mobile tetap terjaga.

## Pemeriksaan sebelum perubahan dianggap selesai

Jalankan seluruh tes regresi:

```sh
node --test tests/agenda.test.cjs tests/known-audit-regressions.cjs tests/rescreen-regressions.cjs tests/project-guardrails.test.cjs tests/subsidy-policy.test.cjs
```

Perubahan SQL/RLS harus ditinjau terhadap hak akses per peran dan tidak boleh diuji dengan mengubah data production. Untuk setiap bug yang diperbaiki, tambahkan regresi yang akan gagal bila bug yang sama kembali.

## Proteksi GitHub yang direkomendasikan

Agar aturan ini benar-benar menjadi gate, branch `main` perlu aturan GitHub yang mewajibkan pull request, persetujuan Code Owner untuk berkas terlindungi, status check **Project guardrails / regression**, serta melarang force-push dan penghapusan branch. Jangan tambahkan bypass untuk agen. Jika pengaturan tersebut belum aktif, jangan menyatakan aturan sudah dipaksa GitHub; isi dokumen dan workflow tetap merupakan instruksi serta tes, bukan batas keamanan yang tak dapat ditembus.
