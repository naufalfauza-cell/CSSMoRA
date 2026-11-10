type Form = Record<string, unknown>;
type Section = { instruction: string; sources: Record<string, string>; fallback: string };

const inputText = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 3500) : "";

function section(instruction: string, inputs: Form, missing = ""): Section {
  const sources = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, inputText(value)]).filter(([, value]) => value),
  );
  return { instruction, sources, fallback: Object.values(sources).join("\n\n") || missing };
}

export function programNarrativePlan(type: string, form: Form, detail: Form = {}) {
  if (type === "proposal") {
    const description = inputText(form.description) || inputText(detail.description);
    return {
      background: section("Susun latar belakang dari konteks yang relevan, lalu kaitkan dengan alasan CSSMoRA UNAIR merencanakan kegiatan. Jika sumber hanya memuat satu gagasan, tulis satu paragraf singkat. Hindari pembuka generik, masalah yang tidak tercatat, dan pengulangan deskripsi teknis.", {
        latar_belakang: inputText(form.background) || description,
      }),
      approach: section("Mulai dengan bentuk kegiatan yang akan diselenggarakan, lalu jelaskan mekanisme yang tercatat. Gunakan kalimat rencana dan istilah kegiatan dari sumber. Jangan mengulang latar belakang, menambah sesi atau metode, maupun memasukkan rincian jadwal dan anggaran.", {
        deskripsi: description,
      }),
      closing: section("Gunakan sudut pandang panitia dengan kata kami. Susun penutup resmi yang ringkas. Nyatakan harapan atau permohonan dukungan hanya jika dicatat pengurus dan jangan menyatakan kegiatan sudah disetujui atau terlaksana.", {
        penutup: form.closing,
      }, "Demikian proposal ini disusun sebagai acuan pelaksanaan kegiatan."),
    };
  }
  return {
    opening: section("Jelaskan konteks pelaporan berdasarkan catatan aktual. Jangan menulis ulang rincian pelaksanaan.", {
      pendahuluan: form.opening,
    }, "Laporan ini mendokumentasikan pelaksanaan kegiatan berdasarkan catatan yang tersedia."),
    implementation: section("Uraikan apa yang benar-benar terlaksana. Jangan mengambil fakta dari rencana kegiatan atau mengasumsikan seluruh agenda terlaksana.", {
      ringkasan_pelaksanaan: form.realization_summary,
    }, "Realisasi kegiatan belum tercatat."),
    outcome: section("Laporkan hanya luaran dan capaian yang dicatat. Jangan menyimpulkan keberhasilan atau dampak tambahan.", {
      luaran_tercatat: form.outcome_summary,
    }, "Luaran dan capaian belum tercatat."),
    evaluation: section("Sampaikan penilaian yang dicatat. Jangan menambahkan kendala, solusi, atau kesimpulan.", {
      evaluasi: form.evaluation,
    }, "Evaluasi belum tercatat."),
    recommendations: section("Rapikan rekomendasi yang dicatat. Jangan mengusulkan tindakan baru.", {
      rekomendasi: form.recommendations,
    }),
    closing: section("Rapikan penutup yang ditulis pengurus tanpa menambahkan klaim keberhasilan.", {
      penutup: form.closing,
    }, "Demikian laporan pertanggungjawaban ini disusun berdasarkan catatan pelaksanaan kegiatan."),
  };
}

export function narrativePromptData(plan: Record<string, Section>) {
  return Object.fromEntries(Object.entries(plan)
    .filter(([, entry]) => Object.keys(entry.sources).length)
    .map(([key, { instruction, sources }]) => [key, { instruction, sources }]));
}

const numericDetails = (text: string) => text.match(/\d+(?:[.,:/–-]\d+)*/g) || [];

export function resolveProgramNarrative(plan: Record<string, Section>, response: unknown) {
  const output = response && typeof response === "object" && !Array.isArray(response)
    ? response as Record<string, unknown> : {};
  const drafted = Object.entries(plan).map(([key, entry]) => {
    if (!Object.keys(entry.sources).length) return [key, entry.fallback] as const;
    const value = typeof output[key] === "string" ? output[key].trim() : "";
    const sourceNumbers = new Set(numericDetails(entry.fallback));
    const outputNumbers = new Set(numericDetails(value));
    const invalid = !value || value.length > 3500 || /(?:https?:\/\/|www\.|^\s*(?:#|\`\`\`|\*\*))/im.test(value) ||
      outputNumbers.size !== sourceNumbers.size || [...outputNumbers].some(number => !sourceNumbers.has(number));
    return [key, invalid ? entry.fallback : value] as const;
  });
  return Object.fromEntries(drafted);
}
