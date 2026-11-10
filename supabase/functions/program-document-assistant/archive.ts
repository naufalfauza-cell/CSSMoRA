export const archiveBucket = "cssmora-proposal-references";
export const archivePath = "avaraksa-2025-2026.json";
export const archiveFields = ["background", "goals", "name_section", "theme_section", "description", "target", "schedule_section", "closing"] as const;
type ArchiveField = typeof archiveFields[number];
type ArchiveEntry = { id: string; label: string; proposal: string; lpj: string; fields: Partial<Record<ArchiveField, string>> };

function validLink(value: unknown): value is string {
  return typeof value === "string" &&
    /^https:\/\/(?:docs\.google\.com\/document|drive\.google\.com\/file)\/d\/[a-zA-Z0-9_-]+\/(?:edit|view)$/.test(value);
}

export function validateProposalArchive(value: unknown): ArchiveEntry[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Daftar referensi tidak valid.");
  const ids = new Set<string>();
  return value.map(entry => {
    if (!entry || typeof entry.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(entry.id) || ids.has(entry.id) ||
      typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 180 ||
      !validLink(entry.lpj) || !validLink(entry.proposal) ||
      !entry.fields || typeof entry.fields !== "object" || Array.isArray(entry.fields)) {
      throw new Error("Entri referensi tidak valid atau duplikat.");
    }
    ids.add(entry.id);
    const fields: ArchiveEntry["fields"] = {};
    for (const key of archiveFields) {
      const section = entry.fields[key];
      if (section === undefined) continue;
      if (typeof section !== "string" || section.length > 12000) throw new Error("Teks bagian referensi tidak valid.");
      fields[key] = section;
    }
    if (!fields.background?.trim() || !fields.goals?.trim() || !fields.closing?.trim()) {
      throw new Error("Latar belakang, tujuan, dan penutup sumber wajib tersedia.");
    }
    return { id: entry.id, label: entry.label, proposal: entry.proposal, lpj: entry.lpj, fields };
  });
}

export function archivedProposalSections(form: Record<string, unknown>) {
  if (typeof form.archive_reference !== "string" || !form.archive_reference) return null;
  return Object.fromEntries(archiveFields.map(key => [
    key, typeof form[key] === "string" ? form[key].slice(0, 12000) : "",
  ]));
}
