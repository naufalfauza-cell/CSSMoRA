const invitationFields = "nama_kegiatan instansi_penerima hari_tanggal_kegiatan waktu_kegiatan tempat_kegiatan sapaan_penerima nama_ketua_pelaksana identitas_ketua_pelaksana nama_sekretaris_pelaksana identitas_sekretaris_pelaksana";

export const letterTemplates = [
  { key: "pinjam", code: "SO", title: "Permohonan Peminjaman Sarana dan Prasarana",
    fields: "jabatan_penerima instansi_penerima nama_kegiatan hari_tanggal_kegiatan waktu_kegiatan nama_ruang nama_cp nomor_hp_cp" },
  { key: "izin", code: "SO", title: "Permohonan Izin",
    fields: "jabatan_penerima fakultas_penerima nama_kegiatan hari_tanggal_kegiatan waktu_kegiatan tempat_kegiatan nama_peserta program_studi identitas_peserta angkatan nama_cp nomor_hp_cp" },
  { key: "wisuda", code: "SO", title: "Permohonan Sertifikat Wisuda",
    fields: "jabatan_penerima periode_wisuda hari_tanggal_wisuda waktu_wisuda tempat_wisuda" },
  { key: "undangan-instansi", code: "SU", title: "Undangan Instansi dan Pengelola",
    fields: "jabatan_penerima gelar_dan_nama_penerima " + invitationFields },
  { key: "undangan-umum", code: "SU", title: "Undangan Kegiatan Umum",
    fields: "nama_penerima " + invitationFields },
  { key: "pengantar-lpj", code: "SP", title: "Pengantar LPJ",
    fields: "nama_penerima instansi_penerima nama_kegiatan hari_kegiatan tanggal_kegiatan tempat_kegiatan nama_ketua_pelaksana identitas_ketua_pelaksana nama_pembina NIP_pembina" },
  { key: "pengantar-proposal", code: "SP", title: "Pengantar Proposal dan Dukungan",
    fields: "nama_penerima instansi_penerima nama_kegiatan tanggal_kegiatan tempat_kegiatan nama_ketua_pelaksana identitas_ketua_pelaksana" },
  { key: "tugas", code: "ST", title: "Surat Tugas",
    fields: "nama_penerima_tugas_1 identitas_penerima_tugas_1 nama_penerima_tugas_2 identitas_penerima_tugas_2 uraian_tugas nama_kegiatan hari_tanggal_kegiatan tempat_kegiatan" },
].map(template => ({ ...template, fields: template.fields.split(" ") }));
