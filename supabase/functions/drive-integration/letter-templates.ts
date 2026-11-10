const invitationFields = "nama_kegiatan instansi_penerima hari_tanggal_kegiatan waktu_kegiatan tempat_kegiatan sapaan_penerima nama_ketua_pelaksana identitas_ketua_pelaksana nama_sekretaris_pelaksana identitas_sekretaris_pelaksana";

export const letterTemplates = [
  { key: "pinjam", code: "SO", title: "Permohonan Peminjaman Sarana dan Prasarana",
    fields: "jabatan_penerima instansi_penerima nama_kegiatan hari_tanggal_kegiatan waktu_kegiatan nama_ruang nama_cp nomor_hp_cp" },
  { key: "izin", code: "SO", title: "Permohonan Izin",
    fields: "jabatan_penerima fakultas_penerima nama_kegiatan hari_tanggal_kegiatan waktu_kegiatan tempat_kegiatan nama_peserta program_studi identitas_peserta angkatan nama_cp nomor_hp_cp" },
  { key: "wisuda", code: "SO", title: "Permohonan Sertifikat Wisuda", appendix: "Daftar Nama Wisudawan",
    fields: "jabatan_penerima periode_wisuda hari_tanggal_wisuda waktu_wisuda tempat_wisuda" },
  { key: "undangan-instansi", code: "SU", title: "Undangan Instansi dan Pengelola", appendix: "Susunan Acara",
    fields: "jabatan_penerima gelar_dan_nama_penerima " + invitationFields },
  { key: "undangan-umum", code: "SU", title: "Undangan Kegiatan Umum", appendix: "Rundown Acara",
    fields: "nama_penerima " + invitationFields },
  { key: "pengantar-lpj", code: "SP", title: "Pengantar LPJ",
    fields: "nama_penerima instansi_penerima nama_kegiatan hari_kegiatan tanggal_kegiatan tempat_kegiatan nama_ketua_pelaksana identitas_ketua_pelaksana nama_pembina NIP_pembina" },
  { key: "pengantar-proposal", code: "SP", title: "Pengantar Proposal dan Dukungan",
    fields: "nama_penerima instansi_penerima nama_kegiatan tanggal_kegiatan tempat_kegiatan nama_ketua_pelaksana identitas_ketua_pelaksana" },
  { key: "tugas", code: "ST", title: "Surat Tugas",
    fields: "nama_penerima_tugas_1 identitas_penerima_tugas_1 nama_penerima_tugas_2 identitas_penerima_tugas_2 uraian_tugas nama_kegiatan hari_tanggal_kegiatan tempat_kegiatan" },
].map(template => ({
  ...template,
  minimumAttachments: template.appendix ? 1 : 0,
  identityFields: template.fields.split(" ").filter(field => field.startsWith("identitas_")),
  fields: template.fields.split(" "),
}));

export function normalizeLetterIdentity(value: string, kind: "NIM" | "NIA") {
  const prefix = value.match(/^(NIM|NIA)(?=[\s.:0-9]|$)[\s.:]*/i);
  if (prefix && prefix[1].toUpperCase() !== kind) return null;
  return value.slice(prefix?.[0].length ?? 0).trim();
}

export function letterIdentityToken(code: string, key: string) {
  const token = "{{" + key + "}}";
  if (code === "SU") return "NIA. " + token;
  if (code === "SP") return "NIM/NIA. " + token;
  if (key === "identitas_peserta") return "NIM/NIA : " + token;
  return token;
}

type LetterParagraph = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
};

export function letterLayoutRequests(content: LetterParagraph[]) {
  const requests: Record<string, unknown>[] = [];
  const paragraphs = content.map(item => ({
    start: item.startIndex ?? 0,
    end: item.endIndex ?? 0,
    text: item.paragraph?.elements?.map(element => element.textRun?.content ?? "").join("") ?? "",
  }));
  // Apply edits from the bottom up so earlier ranges keep their original indexes.
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const { start, end, text } = paragraphs[i];
    if (!start || !text) continue;
    if (/^Lampiran surat nomor:\s*\{\{nomor_surat\}\}\s*$/i.test(text)) {
      // Keep the paragraph because it carries the appendix page break.
      requests.push({ deleteContentRange: { range: { startIndex: start, endIndex: end - 1 } } });
    }
    if (/^di-\s*$/i.test(text) && /^Tempat\s*$/i.test(paragraphs[i + 1]?.text ?? "")) {
      requests.push({ deleteContentRange: { range: { startIndex: start + 2, endIndex: end } } });
      requests.push({ insertText: { location: { index: start + 2 }, text: " " } });
    }
    const recipient = text.match(/^(?:Yth\. )?((?:Fakultas )?\{\{(?:nama_penerima|gelar_dan_nama_penerima|jabatan_penerima|instansi_penerima|fakultas_penerima)\}\})\n$/);
    if (recipient) {
      requests.push({ updateTextStyle: {
        range: { startIndex: end - 1 - recipient[1].length, endIndex: end - 1 },
        textStyle: { bold: true }, fields: "bold",
      } });
    }
  }
  return requests;
}


export function chairIdentityReplacements(kind: "NIM" | "NIA", chair: { nim: string; nia: string }, templateKey: string) {
  const number = kind === "NIM" ? chair.nim : chair.nia;
  const signatureLabel = templateKey.startsWith("undangan-") || templateKey === "pengantar-lpj" ? "NIA. " : "NIM/NIA. ";
  const replacements = [[signatureLabel + chair.nia, kind + ". " + number]];
  if (templateKey === "tugas") replacements.push(["NIA/NIM : " + chair.nia, kind + " : " + number]);
  return replacements;
}
