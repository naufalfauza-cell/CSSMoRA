import { createStorageProvider } from "../_shared/storage-provider.mjs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const corsHeaders = (origin: string) => ({
  ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const json = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const u = new URL(origin), h = u.hostname;
    return u.protocol === "https:" && (
      h === "cssmora.vercel.app" || h === "cssmora.netlify.app" ||
      (h.startsWith("cssmora-") && h.endsWith("-naufalalmaroqi-2669s-projects.vercel.app")) ||
      h.endsWith("--cssmora.netlify.app")
    ) || u.origin === "http://localhost:4173";
  } catch { return false; }
};
const begins = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);
const serviceKey = () => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const values = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return values.default ?? Object.values(values)[0] ?? "";
};
async function readForm(request: Request): Promise<FormData> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new Error("Ukuran sertifikat maksimal 5 MB.");
  if (!request.body) throw new Error("Data laporan kosong.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Ukuran sertifikat maksimal 5 MB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
}
async function ipHash(secret: string, ip: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(signed), value => value.toString(16).padStart(2, "0")).join("");
}
async function consumeLimit(base: string, key: string, ip: string) {
  const response = await fetch(base + "/rest/v1/rpc/consume_cssmora_achievement_record_ip_limit", {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_ip_hash: await ipHash(key, ip) }),
  });
  if (!response.ok) throw new Error("Batas laporan belum dapat diperiksa.");
  return await response.json() === true;
}
async function removeFile(storage: { remove(bucket: string, path: string): Promise<{ ok: boolean }> }, path: string) {
  await storage.remove("cssmora-achievement-certificates", path).catch(() => undefined);
}
Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Asal permintaan tidak diizinkan." }, 403, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Metode permintaan tidak didukung." }, 405, origin);
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, ""), key = serviceKey();
  if (!base || !key) return json({ error: "Layanan laporan prestasi belum siap." }, 503, origin);
  const storage = createStorageProvider({ baseUrl: base, apiKey: key });
  let path = "", uploaded = false;
  try {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data;")) return json({ error: "Format laporan tidak valid." }, 415, origin);
    const form = await readForm(request), payloadText = form.get("payload"), certificate = form.get("certificate");
    if (typeof payloadText !== "string" || !(certificate instanceof File)) return json({ error: "Lengkapi data capaian dan sertifikat." }, 400, origin);
    let payload: Record<string, unknown>;
    try { const parsed = JSON.parse(payloadText); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); payload = parsed; }
    catch { return json({ error: "Data laporan tidak dapat dibaca." }, 400, origin); }
    const id = String(payload.id ?? "");
    const memberIds = Array.isArray(payload.member_ids) ? payload.member_ids.map(String) : [];
    if (!isUuid(id) || memberIds.length < 1 || memberIds.length > 20 || memberIds.some(value => !isUuid(value)) || new Set(memberIds).size !== memberIds.length) {
      return json({ error: "Daftar peserta tidak valid." }, 400, origin);
    }
    if (certificate.size < 1 || certificate.size > MAX_FILE_BYTES) return json({ error: "Sertifikat maksimal 5 MB." }, 413, origin);
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
    const extension = extensions[certificate.type];
    if (!extension) return json({ error: "Sertifikat harus JPG, PNG, WebP, atau PDF." }, 415, origin);
    const bytes = new Uint8Array(await certificate.arrayBuffer());
    const valid =
      (certificate.type === "image/jpeg" && begins(bytes, [0xff, 0xd8, 0xff])) ||
      (certificate.type === "image/png" && begins(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      (certificate.type === "image/webp" && begins(bytes, [0x52, 0x49, 0x46, 0x46]) && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") ||
      (certificate.type === "application/pdf" && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-");
    if (!valid) return json({ error: "Isi file tidak sesuai dengan format sertifikat." }, 415, origin);
    const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    if (forwarded === "unknown") return json({ error: "Jaringan tidak dapat diverifikasi. Coba lagi dari koneksi normal." }, 503, origin);
    if (!await consumeLimit(base, key, forwarded)) return json({ error: "Terlalu banyak laporan dari jaringan ini. Coba lagi satu jam lagi." }, 429, origin);
    path = `records/${id}/certificate.${extension}`;
    const upload = await storage.upload("cssmora-achievement-certificates", path, bytes, { contentType: certificate.type });
    if (!upload.ok) throw new Error("Sertifikat gagal disimpan. Coba kirim ulang.");
    uploaded = true;
    const rpcPayload = {
      p_id: id,
      p_competition_name: String(payload.competition_name ?? ""),
      p_competition_level: String(payload.competition_level ?? ""),
      p_competition_category: String(payload.competition_category ?? ""),
      p_participation_type: String(payload.participation_type ?? ""),
      p_award_title: String(payload.award_title ?? ""),
      p_event_date: String(payload.event_date ?? ""),
      p_contact_email: payload.contact_email == null ? null : String(payload.contact_email),
      p_certificate_path: path,
      p_member_ids: memberIds,
    };
    const response = await fetch(base + "/rest/v1/rpc/submit_cssmora_achievement_record", {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(rpcPayload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await removeFile(storage, path); uploaded = false;
      const status = response.status >= 500 ? 503 : 400;
      return json({ error: status === 400 ? String(result.message ?? "Data laporan belum valid.") : "Layanan laporan prestasi belum siap. Coba lagi." }, status, origin);
    }
    return json(result, 201, origin);
  } catch (error) {
    if (uploaded && path) await removeFile(storage, path);
    console.error("submit-achievement-record failed", error instanceof Error ? error.message : "unknown error");
    const message = error instanceof Error ? error.message : "Laporan capaian belum berhasil dikirim.";
    const status = /maksimal 5 MB/i.test(message) ? 413 : /belum dapat diperiksa|gagal disimpan|layanan laporan/i.test(message) ? 503 : 400;
    return json({ error: message }, status, origin);
  }
});
