# Tanda tangan surat PDF

Alur: terbitkan nomor surat seperti biasa → pilih surat dan penandatangan → unggah PDF → Ketua/Wakil yang dipilih meninjau dan membubuhkan tanda tangan → sekretaris mengunduh PDF hasil. Stempel PNG/JPG bersifat opsional. Jika pengajuan ditolak atau dibatalkan, nomor surat tidak berubah. Tautan arsip Drive lama tetap dikelola terpisah.

Migrasi `20261029090000_letter_pdf_signature_workflow.sql` membuat tabel pengajuan, RPC transisi status, bucket PDF privat, dan bucket aset tanda tangan privat. Terapkan migrasi sebelum mengaktifkan fitur di lingkungan yang dituju. Preview yang masih memakai basis data production tanpa migrasi akan menampilkan kesalahan hanya pada bagian tanda tangan; penomoran dan arsip surat tetap berfungsi.

Hak akses: sekretaris/leadership dapat mengajukan dan melihat PDF surat. Hanya akun Ketua/Wakil yang ditunjuk pada pengajuan itu yang dapat mengunggah hasil dan mengubah status menjadi tertandatangani. Aset gambar mentah hanya dapat dibaca/ditimpa oleh akun pemiliknya; PDF hasil dapat diunduh sekretariat. Semua berkas dibatasi 10 MB untuk PDF dan 2 MB untuk gambar. Dokumen sumber dan hasil tidak dapat ditimpa melalui kebijakan Storage.

Uji setelah migrasi di lingkungan nonproduction dengan empat akun berbeda: sekretaris, Ketua yang ditunjuk, Wakil yang tidak ditunjuk, dan BPH. Periksa bahwa sekretaris dapat mengajukan/mengunduh hasil tetapi tidak menandatangani; Ketua yang ditunjuk dapat melihat sumber dan menyetujui atau menolak; Wakil lain tidak dapat menyelesaikan pengajuan; BPH tidak dapat membaca data atau berkas. Uji PDF banyak halaman termasuk rotasi 90° serta satu pengajuan yang gagal unggah lalu dilanjutkan. Periksa bahwa status tidak dapat diubah melalui PATCH biasa.

Tanda tangan yang dihasilkan adalah gambar visual pada PDF dan catatan persetujuan akun, **bukan tanda tangan elektronik tersertifikasi atau e-meterai**. Word/Google Docs perlu diekspor ke PDF sebelum diajukan; konversi otomatis dan koneksi Google Docs belum tersedia. Jangan mengklaim integrasi Drive API hanya karena arsip memiliki tautan Drive.
