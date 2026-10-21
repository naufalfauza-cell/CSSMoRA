const corsHeaders = {
  "Access-Control-Allow-Origin": "https://cssmora.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const normalizeName = (value: unknown) =>
  String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const todayJakarta = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function hmacBytes(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
async function rotatingCode(secret: string, eventId: string, minute: number) {
  const bytes = await hmacBytes(secret, "cssmora-attendance:" + eventId + ":" + minute);
  const randomValue = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return String(randomValue % 100000000).padStart(8, "0");
}
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};
async function recordAttempt(supabaseUrl: string, headers: Record<string, string>, eventId: string, limiterKey: string, minuteStart: string) {
  const response = await fetch(supabaseUrl + "/rest/v1/rpc/increment_secretariat_attendance_code_attempt", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_event_id: eventId, p_limiter_key: limiterKey, p_attempt_window: minuteStart }),
  });
  if (!response.ok) throw new Error("Rate limit tidak dapat diperiksa.");
  return Number(await response.json());
}
async function adminCode(request: Request, url: URL, supabaseUrl: string, serviceKey: string, headers: Record<string, string>) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Silakan login sebagai pengurus." }, 401);
  const userResponse = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sesi pengurus tidak valid. Silakan login kembali." }, 401);
  const user = await userResponse.json();
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "Akun pengurus tidak memiliki email terverifikasi." }, 403);
  const adminResponse = await fetch(supabaseUrl + "/rest/v1/competition_admins?select=email&email=eq." + encodeURIComponent(email) + "&limit=1", { headers });
  if (!adminResponse.ok) return json({ error: "Akses pengurus tidak dapat diperiksa." }, 500);
  if (!(await adminResponse.json()).length) return json({ error: "Akun ini tidak memiliki akses pengurus." }, 403);
  const eventId = url.searchParams.get("event_id") ?? "";
  if (!isUuid(eventId)) return json({ error: "Kegiatan absensi tidak valid." }, 400);
  const eventResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?select=id,event_date,status&id=eq." + encodeURIComponent(eventId) + "&limit=1", { headers });
  if (!eventResponse.ok) return json({ error: "Kegiatan tidak dapat dimuat." }, 500);
  const event = (await eventResponse.json())[0];
  if (!event) return json({ error: "Kegiatan tidak ditemukan." }, 404);
  if (event.status !== "open") return json({ active: false, message: "Absensi kegiatan ini sudah ditutup." });
  if (event.event_date !== todayJakarta()) return json({ active: false, message: "Kode tersedia pada tanggal kegiatan." });
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  return json({
    active: true,
    code: await rotatingCode(serviceKey, event.id, minute),
    seconds_remaining: Math.ceil((60000 - (now % 60000)) / 1000),
  });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Layanan absensi belum siap." }, 500);
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("mode") === "code") {
    return adminCode(request, url, supabaseUrl, serviceKey, { apikey: serviceKey, Authorization: "Bearer " + serviceKey });
  }

  let input: Record<string, unknown> = {};
  if (request.method === "POST") input = await request.clone().json().catch(() => ({}));
  const token = url.searchParams.get("token") ?? String(input.token ?? "");
  if (!isUuid(token)) return json({ error: "Tautan absensi tidak valid." }, 400);
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const eventUrl = supabaseUrl + "/rest/v1/secretariat_attendance_events?select=id,title,event_date,session_name,status&public_token=eq." + encodeURIComponent(token) + "&limit=1";
  const eventResponse = await fetch(eventUrl, { headers });
  if (!eventResponse.ok) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  const event = (await eventResponse.json())[0];
  if (!event) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  if (event.status !== "open") return json({ error: "Absensi kegiatan ini sudah ditutup." }, 410);

  if (request.method === "GET") return json({ title: event.title, event_date: event.event_date, session_name: event.session_name });
  const today = todayJakarta();
  if (event.event_date !== today) return json({ error: "Tautan absensi hanya aktif pada tanggal kegiatan." }, 403);
  const nia = String(input.nia ?? "").trim();
  const fullName = String(input.full_name ?? "").trim();
  const suppliedCode = String(input.checkin_code ?? "").trim();
  if (nia.length < 3 || nia.length > 40 || fullName.length < 2 || fullName.length > 140) {
    return json({ error: "Isi NIA dan nama lengkap dengan benar." }, 400);
  }
  if (!/^\d{8}$/.test(suppliedCode)) return json({ error: "Masukkan kode check-in 8 digit." }, 400);

  const minuteStart = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = toHex(await hmacBytes(serviceKey, "cssmora-ip:" + ip));
  let ipAttempts: number;
  try {
    ipAttempts = await recordAttempt(supabaseUrl, headers, event.id, "ip:" + ipHash, minuteStart);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }
  if (ipAttempts > 500) return json({ error: "Terlalu banyak percobaan dari jaringan ini. Tunggu satu menit lalu coba lagi." }, 429);

  const memberResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_members?select=id,full_name&nia=eq." + encodeURIComponent(nia) + "&limit=1", { headers });
  if (!memberResponse.ok) return json({ error: "Data anggota belum dapat diperiksa." }, 500);
  const member = (await memberResponse.json())[0];
  if (!member || normalizeName(member.full_name) !== normalizeName(fullName)) {
    return json({ error: "Data tidak cocok. Periksa NIA dan nama, lalu coba lagi." }, 400);
  }

  const recordResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?select=status&event_id=eq." + encodeURIComponent(event.id) + "&member_id=eq." + encodeURIComponent(member.id) + "&limit=1", { headers });
  if (!recordResponse.ok) return json({ error: "Data absensi belum dapat diperiksa." }, 500);
  const record = (await recordResponse.json())[0];
  if (!record) return json({ error: "Nama ini belum tercatat pada roster kegiatan. Hubungi sekretaris." }, 403);
  if (record.status !== "belum") return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);

  let memberAttempts: number;
  try {
    memberAttempts = await recordAttempt(supabaseUrl, headers, event.id, "member:" + member.id, minuteStart);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }
  if (memberAttempts > 6) return json({ error: "Percobaan kode untuk NIA ini sudah mencapai batas. Tunggu satu menit." }, 429);

  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const currentCode = await rotatingCode(serviceKey, event.id, minute);
  let codeValid = safeEqual(suppliedCode, currentCode);
  if (now % 60000 < 15000) {
    const previousCode = await rotatingCode(serviceKey, event.id, minute - 1);
    codeValid = safeEqual(suppliedCode, previousCode) || codeValid;
  }
  if (!codeValid) return json({ error: "Kode salah atau sudah berganti. Minta kode terbaru di lokasi." }, 403);

  const saveResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?event_id=eq." + encodeURIComponent(event.id) + "&member_id=eq." + encodeURIComponent(member.id) + "&status=eq.belum", {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "hadir", updated_at: new Date().toISOString() }),
  });
  if (!saveResponse.ok) return json({ error: "Absensi belum tersimpan. Silakan coba lagi." }, 500);
  const updatedRows = await saveResponse.json().catch(() => []);
  if (!updatedRows.length) return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);
  return json({ success: true, message: "Absensi berhasil dicatat." });
});
