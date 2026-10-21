const corsHeaders = {
  "Access-Control-Allow-Origin": "https://cssmora.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const todayJakarta = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const normalizeValue = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
async function hmacBytes(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
async function rotatingCode(secret: string, eventId: string, thirtySecondWindow: number) {
  const bytes = await hmacBytes(secret, "cssmora-attendance:" + eventId + ":" + thirtySecondWindow);
  const randomValue = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return String(randomValue % 10000).padStart(4, "0");
}
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};
async function recordAttempt(supabaseUrl: string, headers: Record<string, string>, eventId: string, limiterKey: string, windowStart: string) {
  const response = await fetch(supabaseUrl + "/rest/v1/rpc/increment_secretariat_attendance_code_attempt", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_event_id: eventId, p_limiter_key: limiterKey, p_attempt_window: windowStart }),
  });
  if (!response.ok) throw new Error("Rate limit tidak dapat diperiksa.");
  return Number(await response.json());
}
function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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
  if (!email) return json({ error: "Akun pengurus tidak memiliki email." }, 403);
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
  const windowIndex = Math.floor(now / 30000);
  return json({
    active: true,
    code: await rotatingCode(serviceKey, event.id, windowIndex),
    seconds_remaining: Math.ceil((30000 - (now % 30000)) / 1000),
  });
}
async function getActiveEvents(supabaseUrl: string, headers: Record<string, string>) {
  const query = new URLSearchParams({
    select: "id,title,event_date,session_name,public_token",
    status: "eq.open",
    event_date: "eq." + todayJakarta(),
    order: "created_at.asc",
  });
  const response = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?" + query.toString(), { headers });
  if (!response.ok) return json({ error: "Kegiatan aktif belum dapat dimuat." }, 500);
  return json({ events: await response.json() });
}
async function getRosterMembers(supabaseUrl: string, headers: Record<string, string>, eventId: string) {
  const recordQuery = new URLSearchParams({
    select: "member_id",
    event_id: "eq." + eventId,
    status: "eq.belum",
  });
  const recordResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + recordQuery.toString(), { headers });
  if (!recordResponse.ok) throw new Error("Daftar anggota belum dapat dimuat.");
  const recordRows = await recordResponse.json();
  const memberIds = [...new Set(recordRows.map((row: { member_id: string }) => row.member_id).filter(isUuid))];
  if (!memberIds.length) return [];
  const memberQuery = new URLSearchParams({
    select: "id,full_name,cohort,study_program",
    id: "in.(" + memberIds.join(",") + ")",
  });
  const memberResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_members?" + memberQuery.toString(), { headers });
  if (!memberResponse.ok) throw new Error("Data anggota belum dapat dimuat.");
  return await memberResponse.json();
}
async function rosterOptions(request: Request, url: URL, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, event: Record<string, unknown>) {
  if (event.event_date !== todayJakarta()) return json({ error: "Absensi hanya tersedia pada tanggal kegiatan." }, 403);
  const windowStart = new Date(Math.floor(Date.now() / 30000) * 30000).toISOString();
  const ipHash = toHex(await hmacBytes(serviceKey, "cssmora-ip:" + requestIp(request)));
  let attempts: number;
  try {
    attempts = await recordAttempt(supabaseUrl, headers, String(event.id), "lookup:" + ipHash, windowStart);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }
  if (attempts > 500) return json({ error: "Terlalu banyak permintaan. Tunggu 30 detik lalu coba lagi." }, 429);
  let members: Array<{ id: string; full_name: string; cohort: string | number; study_program: string }>;
  try {
    members = await getRosterMembers(supabaseUrl, headers, String(event.id));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Daftar anggota belum dapat dimuat." }, 500);
  }
  const level = url.searchParams.get("level");
  const cohort = (url.searchParams.get("cohort") ?? "").trim();
  const studyProgram = (url.searchParams.get("study_program") ?? "").trim();
  const cohortOf = (member: { cohort: string | number }) => String(member.cohort ?? "").trim();
  const programOf = (member: { study_program: string }) => String(member.study_program ?? "").trim();
  if (level === "cohorts") {
    const items = [...new Set(members.map(cohortOf).filter(Boolean))].sort((a, b) => Number(b) - Number(a) || b.localeCompare(a, "id"));
    return json({ items });
  }
  if (level === "programs" && cohort) {
    const items = [...new Set(members.filter(member => cohortOf(member) === cohort).map(programOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
    return json({ items });
  }
  if (level === "members" && cohort && studyProgram) {
    const items = members
      .filter(member => cohortOf(member) === cohort && programOf(member) === studyProgram)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "id"))
      .map(member => ({ id: member.id, full_name: member.full_name }));
    return json({ items });
  }
  return json({ error: "Pilihan angkatan, prodi, atau nama belum lengkap." }, 400);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Layanan absensi belum siap." }, 500);
  const url = new URL(request.url);
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  if (request.method === "GET" && url.searchParams.get("mode") === "code") {
    return adminCode(request, url, supabaseUrl, serviceKey, headers);
  }
  if (request.method === "GET" && url.searchParams.get("mode") === "active") {
    return getActiveEvents(supabaseUrl, headers);
  }

  let input: Record<string, unknown> = {};
  if (request.method === "POST") input = await request.clone().json().catch(() => ({}));
  const token = url.searchParams.get("token") ?? String(input.token ?? "");
  if (!isUuid(token)) return json({ error: "Tautan absensi tidak valid." }, 400);
  const eventUrl = supabaseUrl + "/rest/v1/secretariat_attendance_events?select=id,title,event_date,session_name,status&public_token=eq." + encodeURIComponent(token) + "&limit=1";
  const eventResponse = await fetch(eventUrl, { headers });
  if (!eventResponse.ok) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  const event = (await eventResponse.json())[0];
  if (!event) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  if (event.status !== "open") return json({ error: "Absensi kegiatan ini sudah ditutup." }, 410);

  if (request.method === "GET") {
    if (url.searchParams.get("mode") === "options") {
      return rosterOptions(request, url, supabaseUrl, serviceKey, headers, event);
    }
    return json({ title: event.title, event_date: event.event_date, session_name: event.session_name });
  }
  if (event.event_date !== todayJakarta()) return json({ error: "Tautan absensi hanya aktif pada tanggal kegiatan." }, 403);
  const memberId = String(input.member_id ?? "").trim();
  const cohort = String(input.cohort ?? "").trim();
  const studyProgram = String(input.study_program ?? "").trim();
  const suppliedCode = String(input.checkin_code ?? "").trim();
  if (!isUuid(memberId) || !cohort || !studyProgram) {
    return json({ error: "Pilih angkatan, prodi, dan nama anggota." }, 400);
  }
  if (!/^\d{4}$/.test(suppliedCode)) return json({ error: "Masukkan kode check-in 4 digit." }, 400);

  const windowStart = new Date(Math.floor(Date.now() / 30000) * 30000).toISOString();
  const ipHash = toHex(await hmacBytes(serviceKey, "cssmora-ip:" + requestIp(request)));
  let ipAttempts: number;
  try {
    ipAttempts = await recordAttempt(supabaseUrl, headers, event.id, "ip:" + ipHash, windowStart);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }
  if (ipAttempts > 500) return json({ error: "Terlalu banyak percobaan dari jaringan ini. Tunggu 30 detik lalu coba lagi." }, 429);

  const memberQuery = new URLSearchParams({
    select: "id,full_name,cohort,study_program",
    id: "eq." + memberId,
    limit: "1",
  });
  const memberResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_members?" + memberQuery.toString(), { headers });
  if (!memberResponse.ok) return json({ error: "Data anggota belum dapat diperiksa." }, 500);
  const member = (await memberResponse.json())[0];
  if (!member || String(member.cohort ?? "").trim() !== cohort || String(member.study_program ?? "").trim() !== studyProgram) {
    return json({ error: "Data anggota tidak cocok dengan pilihan angkatan dan prodi." }, 400);
  }

  const recordQuery = new URLSearchParams({
    select: "status",
    event_id: "eq." + event.id,
    member_id: "eq." + member.id,
    limit: "1",
  });
  const recordResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + recordQuery.toString(), { headers });
  if (!recordResponse.ok) return json({ error: "Data absensi belum dapat diperiksa." }, 500);
  const record = (await recordResponse.json())[0];
  if (!record) return json({ error: "Nama ini belum tercatat pada roster kegiatan. Hubungi sekretaris." }, 403);
  if (record.status !== "belum") return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);

  let memberAttempts: number;
  try {
    memberAttempts = await recordAttempt(supabaseUrl, headers, event.id, "member:" + member.id, windowStart);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }
  if (memberAttempts > 3) return json({ error: "Percobaan kode untuk anggota ini mencapai batas. Tunggu 30 detik." }, 429);

  const now = Date.now();
  const windowIndex = Math.floor(now / 30000);
  const currentCode = await rotatingCode(serviceKey, event.id, windowIndex);
  let codeValid = safeEqual(suppliedCode, currentCode);
  if (now % 30000 < 5000) {
    const previousCode = await rotatingCode(serviceKey, event.id, windowIndex - 1);
    codeValid = safeEqual(suppliedCode, previousCode) || codeValid;
  }
  if (!codeValid) return json({ error: "Kode salah atau sudah berganti. Minta kode terbaru di lokasi." }, 403);

  const updateQuery = new URLSearchParams({
    event_id: "eq." + event.id,
    member_id: "eq." + member.id,
    status: "eq.belum",
  });
  const saveResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + updateQuery.toString(), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "hadir", updated_at: new Date().toISOString() }),
  });
  if (!saveResponse.ok) return json({ error: "Absensi belum tersimpan. Silakan coba lagi." }, 500);
  const updatedRows = await saveResponse.json().catch(() => []);
  if (!updatedRows.length) return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);
  return json({ success: true, message: "Absensi berhasil dicatat." });
});
