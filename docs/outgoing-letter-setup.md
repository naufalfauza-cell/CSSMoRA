# Menyiapkan pembuatan surat keluar

Rilis migrasi draf dan registri master, kemudian Edge Function `drive-integration`, lalu tampilan admin. Registri `public.secretariat_outgoing_letter_masters` hanya dapat dibaca oleh layanan. Masukkan pasangan jenis surat dan ID Docs yang bisa disalin oleh klien OAuth CSSMoRA. Sebagai cadangan konfigurasi, Edge Function menerima secret `LETTER_MASTER_<KUNCI>` dengan huruf kapital dan garis bawah.

| Kunci | Master |
| --- | --- |
| `pinjam` | Peminjaman Sarana dan Prasarana |
| `izin` | Permohonan Izin |
| `wisuda` | Permohonan Sertifikat Wisuda |
| `undangan-instansi` | Undangan Instansi dan Pengelola |
| `undangan-umum` | Undangan Kegiatan Umum |
| `pengantar-lpj` | Pengantar LPJ |
| `pengantar-proposal` | Pengantar Proposal dan Dukungan |
| `tugas` | Surat Tugas |

Integrasi memakai izin `drive.file`. Agar akses tetap terbatas, gunakan Google Picker di project OAuth yang sama atau salinan native yang dibuat oleh klien aplikasi. Untuk produksi CSSMoRA, kedelapan master aplikasi dibuat dari ekspor DOCX master terbaru dan disimpan privat di Drive CSSMoRA. PDF master asli dan salinan dibandingkan per halaman sebelum aktivasi. Perubahan pada master asli perlu dipindahkan ke salinan aplikasi atau diimpor kembali.

Pertahankan penanda dalam kurung kurawal ganda. Uji salin, isi semua penanda, dan ekspor PDF untuk setiap jenis sebelum mengubah registri. Tabel lampiran kosong perlu dilengkapi di Google Docs. Nomor diterbitkan di buku agenda, masuk ke draf yang sama, dan percobaan ulang memakai nomor yang sudah terbit.
