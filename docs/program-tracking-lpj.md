# Monitoring proker dan LPJ

## Alur

- Setiap baris monitoring adalah satu proker untuk satu periode kepengurusan.
- BPH/departemen mengisi rentang periode, tahapan beserta tenggat, tenggat LPJ, ringkasan pelaksanaan, luaran, evaluasi, dan tautan AkunPro.
- Agenda terbit yang terkait dengan proker dan selesai dalam rentang tanggal ditarik otomatis sebagai bahan LPJ.
- Rekap kehadiran hanya mengembalikan jumlah peserta terdata dan jumlah hadir per agenda. Nama, nomor anggota, alasan izin, dan lokasi bukti foto tidak dibuka melalui rekap ini.
- LPJ diekspor sebagai berkas HTML yang dapat dibuka dan dicetak menjadi PDF.
- Setelah diajukan, isian dan checkpoint terkunci sampai Ketua/Wakil menyetujui atau meminta revisi. Riwayat status disimpan tanpa izin edit/hapus langsung.
- Pengingat tenggat ditampilkan di panel Progres & LPJ untuk tenggat yang jatuh tempo atau akan tiba dalam tujuh hari.

## Batas integrasi

- Catatan transaksi, saldo, dan laporan tetap berada di AkunPro. CSSMoRA hanya menyimpan tautan rujukan AkunPro.
- Berkas LPJ belum diunggah ke Supabase atau Drive. Ekspor saat ini dibuat di browser. Integrasi penyimpanan Drive tetap tahap berikutnya setelah adapter dan skema lampiran diuji.
- Perubahan database berada di migrasi tambahan `20261023190000_cssmora_program_tracking_lpj.sql`. Migrasi ini tidak diterapkan otomatis ke database production oleh perubahan kode.
