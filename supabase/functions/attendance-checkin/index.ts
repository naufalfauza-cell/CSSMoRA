import { createStorageProvider } from "../_shared/storage-provider.mjs";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-attendance-cleanup-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
type FileStorageProvider = {
  info(bucket: string, path: string): Promise<{ ok: boolean; status: number; sizeBytes: number; contentType: string; uploadedAt: string | null }>;
  createSignedUrl(bucket: string, path: string, expiresIn: number): Promise<{ ok: boolean; url: string }>;
  createSignedUploadUrl(bucket: string, path: string): Promise<{ ok: boolean; url: string }>;
  removeMany(bucket: string, paths: string[]): Promise<{ ok: boolean }>;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const todayJakarta = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const attendanceDeadlinePassed = (event: { auto_close_at?: unknown }) =>
  Boolean(event.auto_close_at) && Date.parse(String(event.auto_close_at)) <= Date.now();
const normalizeValue = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
async function hmacBytes(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
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
async function adminProofUrl(request: Request, url: URL, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, storage: FileStorageProvider) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Silakan login sebagai pengurus." }, 401);
  const userResponse = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sesi pengurus tidak valid. Silakan login kembali." }, 401);
  const user = await userResponse.json();
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "Akun pengurus tidak memiliki email." }, 403);
  const adminResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_admins?select=email&email=eq." + encodeURIComponent(email) + "&limit=1", { headers });
  if (!adminResponse.ok) return json({ error: "Akses sekretariat tidak dapat diperiksa." }, 500);
  if (!(await adminResponse.json()).length) return json({ error: "Akun ini tidak memiliki akses sekretariat." }, 403);
  const eventId = url.searchParams.get("event_id") ?? "";
  const memberId = url.searchParams.get("member_id") ?? "";
  if (!isUuid(eventId) || !isUuid(memberId)) return json({ error: "Data foto bukti tidak valid." }, 400);
  const query = new URLSearchParams({
    select: "proof_path,proof_deleted_at",
    event_id: "eq." + eventId,
    member_id: "eq." + memberId,
    limit: "1",
  });
  const recordResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + query, { headers });
  if (!recordResponse.ok) return json({ error: "Rekap absensi belum dapat dimuat." }, 500);
  const record = (await recordResponse.json())[0];
  if (!record) return json({ error: "Rekap absensi tidak ditemukan." }, 404);
  if (record.proof_deleted_at) return json({ error: "Foto bukti sudah dihapus otomatis setelah 5 hari." }, 410);
  if (!record.proof_path) return json({ error: "Foto bukti tidak tersedia." }, 404);
  const signResponse = await storage.createSignedUrl("attendance-proofs", String(record.proof_path), 300);
  if (!signResponse.ok) return json({ error: "Foto bukti sudah tidak tersedia." }, 404);
  if (!signResponse.url) return json({ error: "Tautan foto tidak dapat dibuat." }, 500);
  return json({ signed_url: signResponse.url });
}
async function cleanExpiredAttendancePhotos(request: Request, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, storage: FileStorageProvider) {
  const candidate = request.headers.get("x-attendance-cleanup-secret") ?? "";
  if (candidate.length < 32) return json({ error: "Akses pembersihan ditolak." }, 401);
  const verifyResponse = await fetch(supabaseUrl + "/rest/v1/rpc/verify_attendance_photo_cleanup_secret", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_candidate: candidate }),
  });
  if (!verifyResponse.ok) return json({ error: "Pemeriksaan pembersihan gagal." }, 500);
  if (await verifyResponse.json() !== true) return json({ error: "Akses pembersihan ditolak." }, 401);

  const query = new URLSearchParams({
    select: "event_id,member_id,proof_path,proof_uploaded_at,proof_expires_at",
    proof_path: "not.is.null",
    proof_expires_at: "lt." + new Date().toISOString(),
    order: "proof_expires_at.asc",
    limit: "100",
  });
  const recordsResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + query, { headers });
  if (!recordsResponse.ok) return json({ error: "Daftar foto kedaluwarsa belum dapat dimuat." }, 500);
  const rows = await recordsResponse.json();
  if (!rows.length) return json({ success: true, deleted: 0, records_updated: 0 });

  const now = new Date().toISOString();
  const paths = rows
    .map((row: { proof_path: string }) => String(row.proof_path ?? ""))
    .filter((path: string) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/proof\.jpg$/i.test(path));
  if (!paths.length) return json({ success: true, deleted: 0, records_updated: 0 });

  const infoResults = await Promise.all(paths.map(async (path: string) => {
    const response = await storage.info("attendance-proofs", path);
    return { path, status: response.status, exists: response.ok };
  }));
  if (infoResults.some(item => !item.exists && item.status !== 404)) return json({ error: "Status foto lama belum dapat diperiksa." }, 500);
  const existingPaths = infoResults.filter(item => item.exists).map(item => item.path);
  const missingPaths = infoResults.filter(item => item.status === 404).map(item => item.path);
  if (existingPaths.length) {
    const removeResponse = await storage.removeMany("attendance-proofs", existingPaths);
    if (!removeResponse.ok) return json({ error: "Foto lama belum dapat dihapus dari Storage." }, 500);
  }

  const clearRecords = async (expiredPaths: string[], deletedAt?: string) => {
    if (!expiredPaths.length) return true;
    const clearQuery = new URLSearchParams({ proof_path: "in.(" + expiredPaths.join(",") + ")" });
    const body: Record<string, unknown> = { proof_path: null, proof_uploaded_at: null, proof_expires_at: null };
    if (deletedAt) body.proof_deleted_at = deletedAt;
    return (await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + clearQuery, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    })).ok;
  };
  const existingCleared = await clearRecords(existingPaths, now);
  const missingCleared = await clearRecords(missingPaths);
  if (!existingCleared || !missingCleared) return json({ error: "Foto sudah diproses, tetapi status penghapusan belum tercatat." }, 500);
  return json({ success: true, deleted: existingPaths.length, reservations_cleared: missingPaths.length });
}
async function validateAttendanceMember(supabaseUrl: string, headers: Record<string, string>, eventId: string, input: Record<string, unknown>): Promise<{ error?: string; status?: number; member?: any; record?: any; cohort?: string; studyProgram?: string }> {
  const memberId = String(input.member_id ?? "").trim();
  const cohort = String(input.cohort ?? "").trim();
  const studyProgram = String(input.study_program ?? "").trim();
  if (!isUuid(memberId) || !cohort || !studyProgram) return { error: "Pilih angkatan, prodi, dan nama anggota." };
  const memberQuery = new URLSearchParams({ select: "id,full_name,cohort,study_program", id: "eq." + memberId, limit: "1" });
  const memberResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_members?" + memberQuery, { headers });
  if (!memberResponse.ok) return { error: "Data anggota belum dapat diperiksa.", status: 500 };
  const member = (await memberResponse.json())[0];
  if (!member || String(member.cohort ?? "").trim() !== cohort || String(member.study_program ?? "").trim() !== studyProgram) {
    return { error: "Data anggota tidak cocok dengan pilihan angkatan dan prodi.", status: 400 };
  }
  const recordQuery = new URLSearchParams({
    select: "status,proof_path,proof_uploaded_at,proof_expires_at,proof_deleted_at",
    event_id: "eq." + eventId,
    member_id: "eq." + memberId,
    limit: "1",
  });
  const recordResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + recordQuery, { headers });
  if (!recordResponse.ok) return { error: "Data absensi belum dapat diperiksa.", status: 500 };
  const record = (await recordResponse.json())[0];
  if (!record) return { error: "Nama ini belum tercatat pada roster kegiatan. Hubungi sekretaris.", status: 403 };
  if (record.status !== "belum") return { error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi.", status: 409 };
  return { member, record, cohort, studyProgram };
}
async function preparePhotoUpload(request: Request, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, event: Record<string, unknown>, input: Record<string, unknown>, storage: FileStorageProvider) {
  if (event.event_date !== todayJakarta()) return json({ error: "Absensi hanya tersedia pada tanggal kegiatan." }, 403);
  const validated = await validateAttendanceMember(supabaseUrl, headers, String(event.id), input);
  if (validated.error) return json({ error: validated.error }, validated.status ?? 400);
  const member = validated.member as { id: string };
  const record = validated.record as { proof_path?: string | null; proof_expires_at?: string | null };
  const windowStart = new Date(Math.floor(Date.now() / 30000) * 30000).toISOString();
  const ipHash = toHex(await hmacBytes(serviceKey, "cssmora-ip:" + requestIp(request)));
  try {
    const attempts = await recordAttempt(supabaseUrl, headers, String(event.id), "photo-ip:" + ipHash, windowStart);
    if (attempts > 500) return json({ error: "Terlalu banyak permintaan dari jaringan ini. Tunggu sebentar lalu coba lagi." }, 429);
    const memberAttempts = await recordAttempt(supabaseUrl, headers, String(event.id), "photo-member:" + member.id, windowStart);
    if (memberAttempts > 3) return json({ error: "Percobaan unggah untuk anggota ini mencapai batas. Tunggu 30 detik." }, 429);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }

  const path = String(event.id) + "/" + member.id + "/proof.jpg";
  if (record.proof_path && record.proof_path !== path) return json({ error: "Foto bukti sudah disiapkan dengan jalur berbeda." }, 409);
  if (record.proof_path === path && record.proof_expires_at && Date.parse(record.proof_expires_at) > Date.now()) {
    const existing = await storage.info("attendance-proofs", path);
    if (existing.ok) return json({ path, already_uploaded: true });
  }

  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const reserveQuery = new URLSearchParams({ event_id: "eq." + event.id, member_id: "eq." + member.id, status: "eq.belum" });
  const reserveResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + reserveQuery, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ proof_path: path, proof_expires_at: expiresAt, proof_deleted_at: null }),
  });
  if (!reserveResponse.ok) return json({ error: "Slot foto belum dapat disiapkan." }, 500);
  if (!(await reserveResponse.json()).length) return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);

  const signResponse = await storage.createSignedUploadUrl("attendance-proofs", path);
  if (!signResponse.ok) {
    const existing = await storage.info("attendance-proofs", path);
    if (existing.ok) return json({ path, already_uploaded: true });
    return json({ error: "Tautan unggah foto belum dapat dibuat." }, 500);
  }
  if (!signResponse.url) return json({ error: "Tautan unggah foto tidak valid." }, 500);
  return json({ path, signed_upload_url: signResponse.url, expires_in_seconds: 7200 });
}
async function finalizeAttendance(request: Request, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, event: Record<string, unknown>, input: Record<string, unknown>, storage: FileStorageProvider) {
  if (event.event_date !== todayJakarta()) return json({ error: "Absensi hanya tersedia pada tanggal kegiatan." }, 403);
  const validated = await validateAttendanceMember(supabaseUrl, headers, String(event.id), input);
  if (validated.error) return json({ error: validated.error }, validated.status ?? 400);
  const member = validated.member as { id: string };
  const record = validated.record as { proof_path?: string | null };
  const expectedPath = String(event.id) + "/" + member.id + "/proof.jpg";
  const photoPath = String(input.photo_path ?? "");
  if (photoPath !== expectedPath || record.proof_path !== expectedPath) return json({ error: "Foto bukti belum berhasil diunggah." }, 400);
  const infoResponse = await storage.info("attendance-proofs", photoPath);
  if (!infoResponse.ok) return json({ error: "Foto belum ditemukan di penyimpanan. Coba kirim ulang." }, 400);
  const size = infoResponse.sizeBytes;
  const contentType = infoResponse.contentType;
  if (!size || size > 512000 || contentType !== "image/jpeg") return json({ error: "Foto harus berupa JPG dengan ukuran maksimal 500 KB." }, 400);
  const uploadedAt = new Date(infoResponse.uploadedAt ?? Date.now()).toISOString();
  const expiresAt = new Date(Date.parse(uploadedAt) + 5 * 24 * 60 * 60 * 1000).toISOString();

  const windowStart = new Date(Math.floor(Date.now() / 30000) * 30000).toISOString();
  const ipHash = toHex(await hmacBytes(serviceKey, "cssmora-ip:" + requestIp(request)));
  try {
    const attempts = await recordAttempt(supabaseUrl, headers, String(event.id), "checkin-ip:" + ipHash, windowStart);
    if (attempts > 500) return json({ error: "Terlalu banyak percobaan dari jaringan ini. Tunggu sebentar lalu coba lagi." }, 429);
    const memberAttempts = await recordAttempt(supabaseUrl, headers, String(event.id), "checkin-member:" + member.id, windowStart);
    if (memberAttempts > 3) return json({ error: "Percobaan check-in untuk anggota ini mencapai batas. Tunggu 30 detik." }, 429);
  } catch {
    return json({ error: "Pemeriksaan keamanan belum tersedia. Coba lagi sebentar." }, 503);
  }

  if (attendanceDeadlinePassed(event)) return json({ error: "Batas waktu absensi sudah lewat." }, 410);
  const updateQuery = new URLSearchParams({ event_id: "eq." + event.id, member_id: "eq." + member.id, status: "eq.belum" });
  const saveResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + updateQuery, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status: "hadir",
      proof_path: expectedPath,
      proof_uploaded_at: uploadedAt,
      proof_expires_at: expiresAt,
      proof_deleted_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!saveResponse.ok) return json({ error: "Absensi belum tersimpan. Silakan coba lagi." }, 500);
  const updatedRows = await saveResponse.json().catch(() => []);
  if (!updatedRows.length) return json({ error: "Absensi sudah tercatat. Hubungi sekretaris bila perlu koreksi." }, 409);
  return json({ success: true, message: "Absensi dan foto bukti berhasil dicatat." });
}
async function getActiveEvents(supabaseUrl: string, headers: Record<string, string>) {
  const query = new URLSearchParams({
    select: "id,title,event_date,session_name,public_token,agenda_id,auto_close_at,agenda!inner(id)",
    status: "eq.open",
    event_date: "eq." + todayJakarta(),
    "agenda.status": "eq.published",
    order: "created_at.asc",
  });
  try {
    const response = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?" + query.toString(), {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return json({ error: "Kegiatan aktif belum dapat dimuat. Coba lagi sebentar." }, 502);
    const events = await response.json();
    const now = Date.now();
    return json({ events: events
      .filter((event: { auto_close_at?: string | null }) => !event.auto_close_at || Date.parse(event.auto_close_at) > now)
      .map(({ agenda: _agenda, ...event }: Record<string, unknown>) => event)
    });
  } catch {
    return json({ error: "Layanan absensi terlalu lama merespons. Coba lagi sebentar." }, 503);
  }
}

async function deleteAttendanceEvent(request: Request, url: URL, supabaseUrl: string, serviceKey: string, headers: Record<string, string>, storage: FileStorageProvider) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Silakan login sebagai pengurus." }, 401);
  const userResponse = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Sesi pengurus tidak valid. Silakan login kembali." }, 401);
  const user = await userResponse.json();
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "Akun pengurus tidak memiliki email." }, 403);
  const adminResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_admins?select=email&email=eq." + encodeURIComponent(email) + "&limit=1", { headers });
  if (!adminResponse.ok) return json({ error: "Akses sekretariat tidak dapat diperiksa." }, 500);
  if (!(await adminResponse.json()).length) return json({ error: "Akun ini tidak memiliki akses sekretariat." }, 403);

  const eventId = url.searchParams.get("event_id") ?? "";
  if (!isUuid(eventId)) return json({ error: "Agenda absensi tidak valid." }, 400);
  const eventQuery = new URLSearchParams({ select: "id,agenda_id", id: "eq." + eventId, limit: "1" });
  const eventResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?" + eventQuery, { headers });
  if (!eventResponse.ok) return json({ error: "Data agenda absensi belum dapat dimuat." }, 500);
  const attendanceEvent = (await eventResponse.json())[0];
  if (!attendanceEvent) return json({ error: "Agenda absensi tidak ditemukan." }, 404);
  if (attendanceEvent.agenda_id) {
    const agendaQuery = new URLSearchParams({ select: "status", id: "eq." + attendanceEvent.agenda_id, limit: "1" });
    const agendaResponse = await fetch(supabaseUrl + "/rest/v1/agenda?" + agendaQuery, { headers });
    if (!agendaResponse.ok) return json({ error: "Status agenda kalender belum dapat diperiksa." }, 500);
    if ((await agendaResponse.json()).some((agenda: { status: string }) => agenda.status === "published")) {
      return json({ error: "Tarik agenda dari kalender sebelum menghapus data absensinya." }, 409);
    }
  }

  const recordsQuery = new URLSearchParams({
    select: "proof_path",
    event_id: "eq." + eventId,
    proof_path: "not.is.null",
  });
  const recordsResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_records?" + recordsQuery, { headers });
  if (!recordsResponse.ok) return json({ error: "Bukti foto absensi belum dapat diperiksa." }, 500);
  const proofPaths = (await recordsResponse.json())
    .map((record: { proof_path?: string | null }) => String(record.proof_path ?? ""))
    .filter(Boolean);
  if (proofPaths.some((path: string) => !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/proof\.jpg$/i.test(path))) {
    return json({ error: "Jalur foto bukti tidak valid. Data absensi tetap tersimpan." }, 409);
  }
  const paths = [...new Set(proofPaths)];
  if (paths.length) {
    const storageResponse = await storage.removeMany("attendance-proofs", paths);
    if (!storageResponse.ok) return json({ error: "Foto bukti belum dapat dihapus. Data absensi tetap tersimpan." }, 500);
  }

  const deleteQuery = new URLSearchParams({ id: "eq." + eventId });
  const deleteResponse = await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?" + deleteQuery, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
  });
  if (!deleteResponse.ok) {
    const detail = await deleteResponse.json().catch(() => ({}));
    if (detail.code === "P0001") return json({ error: "Agenda masih terbit. Tarik agenda dari kalender sebelum menghapus data absensinya." }, 409);
    return json({ error: "Data absensi belum dapat dihapus." }, 500);
  }
  if (!(await deleteResponse.json().catch(() => [])).length) return json({ error: "Agenda absensi sudah berubah. Muat ulang lalu coba lagi." }, 409);
  return json({ success: true });
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

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Layanan absensi belum siap." }, 500);
  const url = new URL(request.url);
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const storage = createStorageProvider({ baseUrl: supabaseUrl, apiKey: serviceKey });
  const mode = url.searchParams.get("mode") ?? "";
  if (request.method === "GET" && mode === "active") return getActiveEvents(supabaseUrl, headers);
  if (request.method === "GET" && mode === "proof-url") return adminProofUrl(request, url, supabaseUrl, serviceKey, headers, storage);
  if (request.method === "POST" && mode === "cleanup") return cleanExpiredAttendancePhotos(request, supabaseUrl, serviceKey, headers, storage);
  if (request.method === "POST" && mode === "delete-event") return deleteAttendanceEvent(request, url, supabaseUrl, serviceKey, headers, storage);

  let input: Record<string, unknown> = {};
  if (request.method === "POST") input = await request.clone().json().catch(() => ({}));
  const action = String(input.mode ?? "");
  const token = url.searchParams.get("token") ?? String(input.token ?? "");
  if (!isUuid(token)) return json({ error: "Tautan absensi tidak valid." }, 400);
  const eventUrl = supabaseUrl + "/rest/v1/secretariat_attendance_events?select=id,title,event_date,session_name,status,agenda_id,auto_close_at&public_token=eq." + encodeURIComponent(token) + "&limit=1";
  const eventResponse = await fetch(eventUrl, { headers });
  if (!eventResponse.ok) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  const event = (await eventResponse.json())[0];
  if (!event) return json({ error: "Kegiatan absensi tidak ditemukan." }, 404);
  if (event.status !== "open") return json({ error: "Absensi kegiatan ini sudah ditutup." }, 410);
  if (attendanceDeadlinePassed(event)) {
    const closeQuery = new URLSearchParams({
      id: "eq." + event.id,
      status: "eq.open",
      auto_close_at: "eq." + event.auto_close_at,
    });
    await fetch(supabaseUrl + "/rest/v1/secretariat_attendance_events?" + closeQuery.toString(), {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "closed" }),
    }).catch(() => undefined);
    return json({ error: "Batas waktu absensi sudah lewat." }, 410);
  }
  if (!event.agenda_id) return json({ error: "Agenda kalender belum diterbitkan." }, 410);
  const agendaQuery = new URLSearchParams({ select: "id", id: "eq." + event.agenda_id, status: "eq.published", limit: "1" });
  const agendaResponse = await fetch(supabaseUrl + "/rest/v1/agenda?" + agendaQuery.toString(), { headers });
  if (!agendaResponse.ok) return json({ error: "Status agenda kalender belum dapat diperiksa." }, 500);
  if (!(await agendaResponse.json()).length) return json({ error: "Agenda kegiatan tidak lagi diterbitkan." }, 410);

  if (request.method === "GET") {
    if (mode === "options") return rosterOptions(request, url, supabaseUrl, serviceKey, headers, event);
    return json({ title: event.title, event_date: event.event_date, session_name: event.session_name });
  }
  if (action === "prepare_upload") return preparePhotoUpload(request, supabaseUrl, serviceKey, headers, event, input, storage);
  if (action === "finalize") return finalizeAttendance(request, supabaseUrl, serviceKey, headers, event, input, storage);
  return json({ error: "Unggah foto bukti diperlukan untuk mencatat kehadiran." }, 400);
}
const allowedOrigin = (origin: string | null) => {
  if(!origin)return true;
  try{
    const u=new URL(origin),h=u.hostname;
    return (u.protocol==="https:" && (
      h==="cssmora.vercel.app" || h==="cssmora.netlify.app" ||
      (h.startsWith("cssmora-") && h.endsWith("-naufalalmaroqi-2669s-projects.vercel.app")) ||
      h.endsWith("--cssmora.netlify.app")
    )) || u.origin==="http://localhost:4173";
  }catch{return false;}
};
Deno.serve(async (request: Request)=>{
  const origin=request.headers.get("Origin");
  if(!allowedOrigin(origin))return new Response(JSON.stringify({error:"Asal permintaan tidak diizinkan."}),{status:403,headers:{"Content-Type":"application/json"}});
  const response=await handleRequest(request);
  const headers=new Headers(response.headers);
  if(origin)headers.set("Access-Control-Allow-Origin",origin);
  headers.set("Vary","Origin");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
});
