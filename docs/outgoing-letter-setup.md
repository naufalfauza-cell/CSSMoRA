# Menyiapkan pembuatan surat keluar

Fitur memakai salinan native Google Docs. Kop, margin, isi tetap, dan ruang tanda tangan diambil dari master. Aktifkan migrasi `secretariat_outgoing_letter_drafts` dan rilis Edge Function `drive-integration` bersama tampilan admin.

Simpan ID master terbaru dari Drive CSSMoRA sebagai secret Edge Function.

| Secret | Master |
| --- | --- |
| `LETTER_MASTER_PINJAM` | Peminjaman Sarana dan Prasarana |
| `LETTER_MASTER_IZIN` | Permohonan Izin |
| `LETTER_MASTER_WISUDA` | Permohonan Sertifikat Wisuda |
| `LETTER_MASTER_UNDANGAN_INSTANSI` | Undangan Instansi dan Pengelola |
| `LETTER_MASTER_UNDANGAN_UMUM` | Undangan Kegiatan Umum |
| `LETTER_MASTER_PENGANTAR_LPJ` | Pengantar LPJ |
| `LETTER_MASTER_PENGANTAR_PROPOSAL` | Pengantar Proposal dan Dukungan |
| `LETTER_MASTER_TUGAS` | Surat Tugas |

Akun Drive CSSMoRA harus bisa menyalin kedelapan master melalui klien OAuth yang digunakan Edge Function. Integrasi memakai `drive.file`. Berikan akses per berkas melalui Google Picker yang memakai project OAuth yang sama, atau gunakan salinan native yang dibuat oleh klien itu. Kepemilikan file oleh akun Google yang tersambung saja belum memberi akses per berkas. Uji satu salinan setiap jenis surat sebelum fitur dipakai.

Pertahankan penanda dalam kurung kurawal ganda saat mengedit master. Draf memakai tanggal surat dari formulir. Nomor diterbitkan di buku agenda dan disalin ke draf yang sama. Untuk meneruskan surat, tombol **Siapkan tanda tangan** mengambil PDF dari revisi Google Docs saat itu. Sekretaris memilih penandatangan dan mengirim lewat formulir yang sudah ada. Tabel lampiran kosong perlu dilengkapi di Google Docs.
