const corsHeaders = (origin: string) => ({
  ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const allowedOrigin = (origin: string) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      (url.hostname === "cssmora.vercel.app" ||
       (url.hostname.startsWith("cssmora-") && url.hostname.endsWith(".vercel.app")));
  } catch {
    return false;
  }
};
const storageObjectUrl = (base: string, path: string) =>
  base + "/storage/v1/object/cssmora-prestasi-proofs/" + path.split("/").map(encodeURIComponent).join("/");
const bytesStartWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

async function readFormBounded(request: Request): Promise<FormData> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error("Ukuran pengajuan maksimal 5 MB.");
  if (!request.body) throw new Error("Data pengajuan kosong.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("Ukuran pengajuan maksimal 5 MB.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const bounded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  });
  return await bounded.formData();
}

async function ipDigest(serviceKey: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serviceKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return toHex(new Uint8Array(signature));
}

async function consumeIpLimit(base: string, serviceKey: string, ip: string): Promise<boolean> {
  const digest = await ipDigest(serviceKey, ip);
  const response = await fetch(base + "/rest/v1/rpc/consume_cssmora_achievement_ip_limit", {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_ip_hash: digest }),
  });
  if (!response.ok) throw new Error("Batas pengajuan tidak dapat diperiksa.");
  return await response.json() === true;
}

async function removeUploadedProof(base: string, serviceKey: string, path: string) {
  await fetch(storageObjectUrl(base, path), {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  }).catch(() => undefined);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Asal permintaan tidak diizinkan." }, 403, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Metode permintaan tidak didukung." }, 405, origin);

  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base || !serviceKey) return json({ error: "Layanan pengajuan belum siap." }, 503, origin);

  let path = "";
  let uploaded = false;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      return json({ error: "Format data pengajuan tidak valid." }, 415, origin);
    }
    const form = await readFormBounded(request);
    const payloadText = form.get("payload");
    const proof = form.get("proof");
    if (typeof payloadText !== "string" || !(proof instanceof File)) {
      return json({ error: "Lengkapi data dan lampirkan bukti pendaftaran." }, 400, origin);
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payloadText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Data pengajuan tidak dapat dibaca." }, 400, origin);
    }

    const id = String(payload.p_id ?? "");
    if (!isUuid(id)) return json({ error: "Identitas pengajuan tidak valid." }, 400, origin);
    if (proof.size < 1 || proof.size > MAX_FILE_BYTES) {
      return json({ error: "Ukuran bukti maksimal 5 MB." }, 413, origin);
    }
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "application/pdf": "pdf",
    };
    const extension = extensions[proof.type];
    if (!extension) return json({ error: "Format bukti harus JPG, PNG, atau PDF." }, 415, origin);

    const proofBytes = new Uint8Array(await proof.arrayBuffer());
    const validSignature =
      (proof.type === "image/jpeg" && bytesStartWith(proofBytes, [0xff, 0xd8, 0xff])) ||
      (proof.type === "image/png" && bytesStartWith(proofBytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      (proof.type === "application/pdf" && new TextDecoder().decode(proofBytes.slice(0, 5)) === "%PDF-");
    if (!validSignature) return json({ error: "Isi file tidak sesuai dengan format bukti." }, 415, origin);

    const forwarded = request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    if (forwarded === "unknown") {
      return json({ error: "Jaringan tidak dapat diverifikasi. Coba lagi dari koneksi normal." }, 503, origin);
    }
    if (!await consumeIpLimit(base, serviceKey, forwarded)) {
      return json({ error: "Terlalu banyak pengajuan dari jaringan ini. Coba lagi dalam satu jam." }, 429, origin);
    }

    path = "applications/" + id + "/proof." + extension;
    const upload = await fetch(storageObjectUrl(base, path), {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": proof.type,
        "x-upsert": "false",
      },
      body: proofBytes,
    });
    if (!upload.ok) {
      const detail = await upload.json().catch(() => ({}));
      throw new Error(String(detail.message ?? "Bukti pendaftaran gagal diunggah."));
    }
    uploaded = true;

    const safePayload = { ...payload, p_proof_path: path };
    const submission = await fetch(base + "/rest/v1/rpc/submit_cssmora_achievement_application", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(safePayload),
    });
    const result = await submission.json().catch(() => ({}));
    if (!submission.ok) {
      const message = String(result.message ?? "Pengajuan belum berhasil disimpan.");
      await removeUploadedProof(base, serviceKey, path);
      uploaded = false;
      const status = submission.status === 429 ? 429 :
        (submission.status >= 500 || submission.status === 401 || submission.status === 403 ? 503 : 400);
      return json({ error: status === 400 ? message : "Layanan pengajuan belum siap. Coba lagi beberapa saat." }, status, origin);
    }
    return json(result, 201, origin);
  } catch (error) {
    if (uploaded && path) await removeUploadedProof(base, serviceKey, path);
    console.error("submit-achievement failed:", error);
    const message = error instanceof Error ? error.message : "Pengajuan belum berhasil disimpan.";
    const status = /maksimal 5 MB/i.test(message) ? 413 : /tidak dapat diperiksa/i.test(message) ? 503 : 400;
    return json({ error: message }, status, origin);
  }
});
