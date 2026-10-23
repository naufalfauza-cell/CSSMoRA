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
const headers = (origin: string) => ({
  ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const serviceKey = () => {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const values = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return values.default ?? Object.values(values)[0] ?? "";
};
const publishableKey = () => {
  const direct = Deno.env.get("SUPABASE_ANON_KEY");
  if (direct) return direct;
  const values = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  return values.default ?? values.anon ?? Object.values(values)[0] ?? "";
};
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
async function sign(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`))));
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16_384) throw new Error("Permintaan terlalu besar.");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Format permintaan tidak valid.");
  return value as Record<string, unknown>;
}
async function authorizedUser(request: Request, base: string, anonKey: string, key: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !anonKey) return null;
  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  const email = String(user?.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const rolesResponse = await fetch(`${base}/rest/v1/cssmora_user_roles?select=role&email=eq.${encodeURIComponent(email)}&is_active=eq.true`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!rolesResponse.ok) return null;
  const roles = await rolesResponse.json().catch(() => []);
  const permitted = Array.isArray(roles) && roles.some((row: { role?: string }) => ["ketua", "wakil", "bendahara"].includes(row.role ?? ""));
  return permitted ? { email } : null;
}
async function callAkunPro(action: Record<string, unknown>, secret: string) {
  const endpoint = Deno.env.get("AKUNPRO_BRIDGE_URL") ?? "";
  const key = Deno.env.get("AKUNPRO_PUBLISHABLE_KEY") ?? "";
  if (!endpoint || !key || !secret) throw new Error("Integrasi AkunPro belum dikonfigurasi.");
  const body = JSON.stringify(action);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await sign(secret, timestamp, body);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json", "X-CSSMoRA-Timestamp": timestamp, "X-CSSMoRA-Signature": signature },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error ?? "AkunPro belum menerima permintaan."));
  return result;
}
async function claimFinanceTransaction(base: string, key: string, id: string) {
  const response = await fetch(`${base}/rest/v1/rpc/claim_cssmora_finance_transaction`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id }),
  });
  if (!response.ok) throw new Error("Transaksi keuangan tidak dapat dikunci untuk sinkronisasi.");
  return await response.json();
}
async function patchFinanceTransaction(base: string, key: string, id: string, payload: Record<string, unknown>) {
  const response = await fetch(`${base}/rest/v1/cssmora_finance_transactions?id=eq.${encodeURIComponent(id)}&sync_status=eq.syncing`, {
    method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Status sinkronisasi lokal belum dapat diperbarui.");
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Status sinkronisasi lokal berubah. Cek status transaksi sebelum mengirim ulang.");
}
async function releaseFinanceTransaction(base: string, key: string, id: string, reason: string) {
  await fetch(`${base}/rest/v1/rpc/release_cssmora_finance_transaction`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_error: reason.slice(0, 600) }),
  });
}
Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return json({ error: "Asal permintaan tidak diizinkan." }, 403, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== "POST") return json({ error: "Metode permintaan tidak didukung." }, 405, origin);
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = serviceKey(), anonKey = publishableKey();
  if (!base || !key) return json({ error: "Layanan keuangan belum siap." }, 503, origin);
  try {
    const user = await authorizedUser(request, base, anonKey, key);
    if (!user) return json({ error: "Akses Bendahara atau pimpinan diperlukan." }, 403, origin);
    const body = await readBody(request);
    const secret = Deno.env.get("AKUNPRO_BRIDGE_SECRET") ?? "";
    if (body.action === "accounts") {
      const result = await callAkunPro({ action: "accounts" }, secret);
      return json({ accounts: Array.isArray(result.accounts) ? result.accounts : [] }, 200, origin);
    }
    if (body.action !== "sync" || !uuid(body.transaction_id)) return json({ error: "Permintaan sinkronisasi tidak valid." }, 400, origin);
    const claim = await claimFinanceTransaction(base, key, String(body.transaction_id));
    if (claim.state === "missing") return json({ error: "Transaksi tidak ditemukan." }, 404, origin);
    if (claim.state === "synced") return json({ duplicate: true, transaction_id: claim.transaction_id }, 200, origin);
    if (claim.state === "busy") return json({ busy: true }, 202, origin);
    if (claim.state !== "claimed" || !claim.transaction) return json({ error: "Transaksi belum dapat disinkronkan." }, 409, origin);
    const transaction = claim.transaction;
    try {
      const result = await callAkunPro({
        action: "post",
        external_id: transaction.id,
        transaction_date: transaction.transaction_date,
        reference: transaction.reference,
        description: transaction.description,
        direction: transaction.direction,
        amount: Number(transaction.amount),
        cash_account_code: transaction.cash_account_code,
        category_account_code: transaction.category_account_code,
        actor_email: user.email,
      }, secret);
      await patchFinanceTransaction(base, key, transaction.id, {
        sync_status: "synced",
        akunpro_transaction_id: String(result.transaction_id ?? `CSSMORA:${transaction.id}`),
        akunpro_synced_at: new Date().toISOString(),
        sync_started_at: null,
        last_sync_error: null,
      });
      return json({ transaction_id: result.transaction_id, duplicate: result.duplicate === true }, 200, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sinkronisasi AkunPro gagal.";
      await releaseFinanceTransaction(base, key, transaction.id, message).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sinkronisasi AkunPro gagal.";
    console.error("akunpro-integration request failed", message);
    return json({ error: message }, /belum dikonfigurasi/i.test(message) ? 503 : 502, origin);
  }
});
