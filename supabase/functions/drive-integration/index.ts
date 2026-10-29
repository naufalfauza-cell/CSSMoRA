import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const DEFAULT_DRIVE_EMAIL = "unair@cssmora.org";
const DRIVE_SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const MAX_SYNC_BATCH = 10;
const MAX_SYNC_ATTEMPTS = 8;
const BACKUP_PREFIX = new TextEncoder().encode("CSSMORA-DRIVE-BACKUP-V1\n");

class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function appUrl() {
  const raw = Deno.env.get("CSSMORA_APP_URL") || "https://cssmora.vercel.app/admin.html";
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new AppError(500, "URL aplikasi CSSMoRA belum dikonfigurasi dengan aman.");
  }
  return parsed;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  });
  const allowed =
    origin === appUrl().origin ||
    origin === "http://localhost:8000" ||
    /^https:\/\/([a-z0-9-]+\.)?cssmora\.org$/i.test(origin);
  if (allowed) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(request: Request, status: number, value: unknown) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function fromBase64(value: string) {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  normalized += "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomHex(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string | Uint8Array) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function serviceRequest(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new AppError(500, "Konfigurasi layanan server belum tersedia.");
  const headers = new Headers(options.headers || {});
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", "Bearer " + SERVICE_ROLE_KEY);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string" || options.body instanceof Uint8Array) {
      body = options.body as BodyInit;
    } else {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    }
  }
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers,
    body,
  });
  const raw = await response.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }
  if (!response.ok) {
    throw new AppError(502, "Permintaan ke data CSSMoRA gagal.");
  }
  return { data, response };
}

async function requireUser(request: Request) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new AppError(500, "Konfigurasi autentikasi belum tersedia.");
  }
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError(401, "Login pengurus diperlukan.");
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: ANON_KEY, Authorization: "Bearer " + match[1] },
  });
  if (!response.ok) throw new AppError(401, "Sesi pengurus tidak valid. Silakan login kembali.");
  const user = await response.json().catch(() => null);
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) throw new AppError(401, "Akun tidak memiliki alamat email.");
  const query = new URLSearchParams({
    select: "role",
    email: "eq." + email,
    is_active: "eq.true",
  });
  const roleRows = (await serviceRequest("cssmora_user_roles?" + query.toString())).data;
  const roles = Array.isArray(roleRows) ? roleRows.map((row: any) => String(row.role)) : [];
  if (!roles.length) throw new AppError(403, "Akun ini tidak memiliki akses pengelolaan CSSMoRA.");
  return { user, email, roles };
}

function requireLeadership(roles: string[]) {
  if (!roles.includes("ketua") && !roles.includes("wakil")) {
    throw new AppError(403, "Fitur ini hanya dapat dikelola Ketua atau Wakil Ketua.");
  }
}

function googleClientConfig() {
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") || "";
  const encryptionKey = (Deno.env.get("GOOGLE_DRIVE_ENCRYPTION_KEY") || "").trim();
  if (!clientId || !clientSecret || !encryptionKey) {
    throw new AppError(503, "Kredensial Google Drive belum dikonfigurasi di Supabase.");
  }
  return { clientId, clientSecret, encryptionKey };
}

function redirectUri() {
  if (!SUPABASE_URL) throw new AppError(500, "URL Supabase belum tersedia.");
  return SUPABASE_URL + "/functions/v1/drive-integration?action=callback";
}

async function encryptToken(value: string) {
  const { encryptionKey } = googleClientConfig();
  const rawKey = fromBase64(encryptionKey);
  if (rawKey.length !== 32) throw new AppError(500, "Kunci enkripsi Drive harus berukuran 32 byte.");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  ));
  return "v1." + base64(iv) + "." + base64(encrypted);
}

async function decryptToken(value: string) {
  const { encryptionKey } = googleClientConfig();
  const parts = String(value || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new AppError(500, "Token Drive terenkripsi tidak valid.");
  const rawKey = fromBase64(encryptionKey);
  if (rawKey.length !== 32) throw new AppError(500, "Kunci enkripsi Drive harus berukuran 32 byte.");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parts[1]) },
    key,
    fromBase64(parts[2]),
  );
  return new TextDecoder().decode(clear);
}

async function currentConnection() {
  const rows = (await serviceRequest(
    "cssmora_drive_connections?select=account_email,drive_root_folder_id,drive_uploads_folder_id,drive_backups_folder_id,refresh_token_ciphertext&singleton=eq.true&limit=1",
  )).data;
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function driveAccessToken(connection: any) {
  const { clientId, clientSecret } = googleClientConfig();
  if (!connection?.refresh_token_ciphertext) throw new AppError(409, "Google Drive belum tersambung.");
  const refreshToken = await decryptToken(connection.refresh_token_ciphertext);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new AppError(502, "Izin Google Drive kedaluwarsa atau dicabut. Hubungkan Drive kembali.");
  return String(data.access_token);
}

async function googleJson(accessToken: string, url: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + accessToken);
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!response.ok) throw new AppError(response.status, "Permintaan ke Google Drive gagal.");
  return { data, response };
}

async function createDriveFolder(accessToken: string, name: string, parentId?: string) {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];
  const result = await googleJson(
    accessToken,
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    { method: "POST", body: metadata },
  );
  const id = String(result.data?.id || "");
  if (!id) throw new AppError(502, "Folder privat Google Drive tidak berhasil dibuat.");
  return id;
}

async function startOAuth(request: Request) {
  const actor = await requireUser(request);
  requireLeadership(actor.roles);
  const { clientId } = googleClientConfig();
  const state = randomHex(32);
  const stateHash = await sha256Hex(state);
  await serviceRequest("cssmora_drive_oauth_states", {
    method: "POST",
    body: {
      state_hash: stateHash,
      requested_by_email: actor.email,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  });
  const allowedEmail = (Deno.env.get("GOOGLE_DRIVE_ALLOWED_EMAIL") || DEFAULT_DRIVE_EMAIL).trim().toLowerCase();
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", redirectUri());
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", DRIVE_SCOPE);
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("login_hint", allowedEmail);
  authorization.searchParams.set("hd", "cssmora.org");
  return { authorizationUrl: authorization.toString() };
}

async function consumeOAuthState(state: string) {
  const stateHash = await sha256Hex(state);
  const query = new URLSearchParams({
    select: "requested_by_email,expires_at",
    state_hash: "eq." + stateHash,
    expires_at: "gt." + new Date().toISOString(),
  });
  const result = await serviceRequest("cssmora_drive_oauth_states?" + query.toString(), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(result.data) && result.data.length ? result.data[0] : null;
}

async function hasLeadershipForEmail(email: string) {
  const query = new URLSearchParams({
    select: "role",
    email: "eq." + String(email).toLowerCase(),
    is_active: "eq.true",
  });
  const rows = (await serviceRequest("cssmora_user_roles?" + query.toString())).data;
  return Array.isArray(rows) && rows.some((row: any) => row.role === "ketua" || row.role === "wakil");
}

async function callbackRedirect(result: "connected" | "error") {
  const target = appUrl();
  target.searchParams.set("drive", result);
  return Response.redirect(target.toString(), 302);
}

async function oauthCallback(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (state) {
    try {
      const consumed = await consumeOAuthState(state);
      if (!consumed) return await callbackRedirect("error");
      if (url.searchParams.get("error")) return await callbackRedirect("error");
      if (!(await hasLeadershipForEmail(consumed.requested_by_email))) return await callbackRedirect("error");

      const code = url.searchParams.get("code") || "";
      if (!code) return await callbackRedirect("error");
      const { clientId, clientSecret } = googleClientConfig();
      const tokenForm = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      });
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenForm.toString(),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token) return await callbackRedirect("error");

      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: "Bearer " + String(tokenData.access_token) },
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const email = String(profile.email || "").trim().toLowerCase();
      const allowedEmail = (Deno.env.get("GOOGLE_DRIVE_ALLOWED_EMAIL") || DEFAULT_DRIVE_EMAIL).trim().toLowerCase();
      if (!profileResponse.ok || profile.email_verified !== true || email !== allowedEmail) {
        return await callbackRedirect("error");
      }

      const existing = await currentConnection();
      let encryptedRefreshToken = existing?.refresh_token_ciphertext || "";
      if (tokenData.refresh_token) encryptedRefreshToken = await encryptToken(String(tokenData.refresh_token));
      if (!encryptedRefreshToken) return await callbackRedirect("error");

      let rootFolderId = String(existing?.drive_root_folder_id || "");
      let uploadsFolderId = String(existing?.drive_uploads_folder_id || "");
      let backupsFolderId = String(existing?.drive_backups_folder_id || "");
      if (!rootFolderId) rootFolderId = await createDriveFolder(String(tokenData.access_token), "CSSMoRA App");
      if (!uploadsFolderId) uploadsFolderId = await createDriveFolder(String(tokenData.access_token), "Berkas Aplikasi", rootFolderId);
      if (!backupsFolderId) backupsFolderId = await createDriveFolder(String(tokenData.access_token), "Backup Data", rootFolderId);

      await serviceRequest("cssmora_drive_connections?on_conflict=singleton", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          singleton: true,
          account_email: email,
          drive_root_folder_id: rootFolderId,
          drive_uploads_folder_id: uploadsFolderId,
          drive_backups_folder_id: backupsFolderId,
          refresh_token_ciphertext: encryptedRefreshToken,
          connected_by_email: String(consumed.requested_by_email).toLowerCase(),
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return await callbackRedirect("connected");
    } catch {
      return await callbackRedirect("error");
    }
  }
  return await callbackRedirect("error");
}

async function countQueue(status: string) {
  const query = new URLSearchParams({ select: "id", status: "eq." + status });
  const result = await serviceRequest("cssmora_drive_sync_queue?" + query.toString(), {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  const contentRange = result.response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/").pop());
  return Number.isFinite(total) ? total : 0;
}

async function integrationStatus() {
  const [connection, pending, processing, failed, backupRows] = await Promise.all([
    currentConnection(),
    countQueue("pending"),
    countQueue("processing"),
    countQueue("failed"),
    serviceRequest("cssmora_drive_backup_runs?select=status,started_at,finished_at,encrypted_size_bytes&order=started_at.desc&limit=1"),
  ]);
  const latestBackup = Array.isArray(backupRows.data) && backupRows.data.length ? backupRows.data[0] : null;
  return {
    connected: Boolean(connection),
    accountEmail: connection?.account_email || null,
    folderUrl: connection?.drive_root_folder_id
      ? "https://drive.google.com/drive/folders/" + encodeURIComponent(connection.drive_root_folder_id)
      : null,
    pendingFiles: pending + processing,
    failedFiles: failed,
    lastBackup: latestBackup,
  };
}

function encodeStoragePath(path: string) {
  return String(path).split("/").map(segment => encodeURIComponent(segment)).join("/");
}

function queryPath(table: string, values: Record<string, string>) {
  return table + "?" + new URLSearchParams(values).toString();
}

async function lookupMirror(bucket: string, path: string) {
  const query = queryPath("cssmora_drive_mirrors", {
    select: "drive_file_id",
    bucket_id: "eq." + bucket,
    object_path: "eq." + path,
    limit: "1",
  });
  const rows = (await serviceRequest(query)).data;
  return Array.isArray(rows) && rows.length ? String(rows[0].drive_file_id) : null;
}

async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId),
    { method: "DELETE", headers: { Authorization: "Bearer " + accessToken } },
  );
  if (!response.ok && response.status !== 404) throw new AppError(response.status, "File Google Drive gagal dihapus.");
}

async function uploadDriveFile(
  accessToken: string,
  options: { fileId?: string | null; parentId: string; name: string; mimeType: string; bytes: Uint8Array; appProperties: Record<string, string> },
) {
  const isUpdate = Boolean(options.fileId);
  const endpoint = isUpdate
    ? "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(String(options.fileId)) + "?uploadType=resumable&fields=id,name,mimeType"
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType";
  const metadata: Record<string, unknown> = {
    name: options.name,
    appProperties: options.appProperties,
  };
  if (!isUpdate) {
    metadata.mimeType = options.mimeType;
    metadata.parents = [options.parentId];
  }
  const sessionResponse = await fetch(endpoint, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": options.mimeType,
      "X-Upload-Content-Length": String(options.bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!sessionResponse.ok) {
    throw new AppError(sessionResponse.status, "Google Drive tidak dapat memulai unggahan.");
  }
  const uploadUrl = sessionResponse.headers.get("Location");
  if (!uploadUrl) throw new AppError(502, "Google Drive tidak memberikan alamat unggah.");
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": options.mimeType },
    body: options.bytes,
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploaded.id) throw new AppError(uploadResponse.status || 502, "Unggahan Google Drive gagal.");
  return String(uploaded.id);
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function removeClaimedQueueJob(job: any) {
  await serviceRequest(queryPath("cssmora_drive_sync_queue", {
    id: "eq." + String(job.id),
    status: "eq.processing",
    generation: "eq." + String(job.generation),
  }), { method: "DELETE" });
}

async function processSyncJob(accessToken: string, connection: any, job: any) {
  const bucket = String(job.bucket_id);
  const objectPath = String(job.object_path);
  const filters = {
    bucket_id: "eq." + bucket,
    object_path: "eq." + objectPath,
  };
  if (job.operation === "delete") {
    const driveFileId = await lookupMirror(bucket, objectPath);
    if (driveFileId) {
      await deleteDriveFile(accessToken, driveFileId);
      await serviceRequest(queryPath("cssmora_drive_mirrors", filters), { method: "DELETE" });
    }
    await removeClaimedQueueJob(job);
    return;
  }

  const objectUrl = SUPABASE_URL + "/storage/v1/object/" + encodeURIComponent(bucket) + "/" + encodeStoragePath(objectPath);
  const objectResponse = await fetch(objectUrl, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: "Bearer " + SERVICE_ROLE_KEY },
  });
  if (!objectResponse.ok) throw new AppError(objectResponse.status, "Berkas sumber tidak dapat dibaca.");
  const bytes = new Uint8Array(await objectResponse.arrayBuffer());
  const mimeType = String(objectResponse.headers.get("content-type") || "application/octet-stream")
    .split(";")[0].trim().toLowerCase();
  const existingId = await lookupMirror(bucket, objectPath);
  const baseName = objectPath.split("/").pop() || "file";
  const name = (bucket + "__" + baseName).slice(0, 220);
  const pathHash = await sha256Hex(bucket + "\n" + objectPath);
  let driveFileId: string;
  if (existingId) {
    try {
      driveFileId = await uploadDriveFile(accessToken, {
        fileId: existingId,
        parentId: connection.drive_uploads_folder_id,
        name,
        mimeType,
        bytes,
        appProperties: { cssmoraBucket: bucket, cssmoraObjectPathHash: pathHash },
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 404) throw error;
      await serviceRequest(queryPath("cssmora_drive_mirrors", filters), { method: "DELETE" });
      driveFileId = await uploadDriveFile(accessToken, {
        parentId: connection.drive_uploads_folder_id,
        name,
        mimeType,
        bytes,
        appProperties: { cssmoraBucket: bucket, cssmoraObjectPathHash: pathHash },
      });
    }
  } else {
    driveFileId = await uploadDriveFile(accessToken, {
      parentId: connection.drive_uploads_folder_id,
      name,
      mimeType,
      bytes,
      appProperties: { cssmoraBucket: bucket, cssmoraObjectPathHash: pathHash },
    });
  }

  await serviceRequest("cssmora_drive_mirrors?on_conflict=bucket_id,object_path", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: {
      bucket_id: bucket,
      object_path: objectPath,
      drive_file_id: driveFileId,
      content_type: mimeType,
      size_bytes: bytes.byteLength,
      sha256_checksum: await sha256Bytes(bytes),
      synced_at: new Date().toISOString(),
    },
  });
  await removeClaimedQueueJob(job);
}

function safeSyncError(error: unknown) {
  if (error instanceof AppError) return "Sinkronisasi Drive gagal (HTTP " + error.status + ").";
  return "Koneksi sinkronisasi Drive gagal.";
}

async function runSync() {
  const connection = await currentConnection();
  if (!connection) return { processed: 0, succeeded: 0, failed: 0, skipped: "Drive belum tersambung." };
  const accessToken = await driveAccessToken(connection);
  const claimed = (await serviceRequest("rpc/claim_cssmora_drive_sync_jobs", {
    method: "POST",
    body: { p_limit: MAX_SYNC_BATCH },
  })).data;
  const jobs = Array.isArray(claimed) ? claimed : [];
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processSyncJob(accessToken, connection, job);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const attempts = Number(job.attempts || 0) + 1;
      const delayMinutes = attempts === 1 ? 1 : attempts <= 3 ? 5 : 60;
      const status = attempts >= MAX_SYNC_ATTEMPTS ? "failed" : "pending";
      await serviceRequest(queryPath("cssmora_drive_sync_queue", {
        id: "eq." + String(job.id),
        status: "eq.processing",
        generation: "eq." + String(job.generation),
      }), {
        method: "PATCH",
        body: {
          status,
          attempts,
          next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
          last_error: safeSyncError(error),
          updated_at: new Date().toISOString(),
        },
      }).catch(() => null);
    }
  }
  return { processed: jobs.length, succeeded, failed };
}

async function gzipBytes(bytes: Uint8Array) {
  const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function encryptBackup(bytes: Uint8Array) {
  const { encryptionKey } = googleClientConfig();
  const rawKey = fromBase64(encryptionKey);
  if (rawKey.length !== 32) throw new AppError(500, "Kunci enkripsi Drive harus berukuran 32 byte.");
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const compressed = await gzipBytes(bytes);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed));
  const output = new Uint8Array(BACKUP_PREFIX.length + iv.length + cipher.length);
  output.set(BACKUP_PREFIX, 0);
  output.set(iv, BACKUP_PREFIX.length);
  output.set(cipher, BACKUP_PREFIX.length + iv.length);
  return output;
}

async function runBackup() {
  const connection = await currentConnection();
  if (!connection) return { skipped: "Drive belum tersambung." };
  const accessToken = await driveAccessToken(connection);
  const startedAt = new Date().toISOString();
  const created = await serviceRequest("cssmora_drive_backup_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { status: "running", started_at: startedAt },
  });
  const run = Array.isArray(created.data) ? created.data[0] : created.data;
  const runId = String(run?.id || "");
  if (!runId) throw new AppError(500, "Catatan backup tidak berhasil dibuat.");

  try {
    const snapshot = (await serviceRequest("rpc/export_cssmora_drive_backup", { method: "POST", body: {} })).data;
    if (!snapshot || snapshot.format !== "cssmora-data-backup-v1" || typeof snapshot.tables !== "object") {
      throw new AppError(500, "Data backup tidak memiliki format yang dikenali.");
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const encrypted = await encryptBackup(jsonBytes);
    const counts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(snapshot.tables)) counts[table] = Array.isArray(rows) ? rows.length : 0;
    const fileName = "CSSMoRA-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json.gz.enc";
    const driveFileId = await uploadDriveFile(accessToken, {
      parentId: connection.drive_backups_folder_id,
      name: fileName,
      mimeType: "application/octet-stream",
      bytes: encrypted,
      appProperties: { cssmoraBackupVersion: "1", cssmoraBackupRunId: runId },
    });
    await serviceRequest("cssmora_drive_backup_runs?id=eq." + encodeURIComponent(runId), {
      method: "PATCH",
      body: {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        drive_file_id: driveFileId,
        encrypted_size_bytes: encrypted.byteLength,
        record_counts: counts,
        error_message: null,
      },
    });
    return { backupId: runId, encryptedBytes: encrypted.byteLength, recordCounts: counts };
  } catch (error) {
    await serviceRequest("cssmora_drive_backup_runs?id=eq." + encodeURIComponent(runId), {
      method: "PATCH",
      body: {
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error instanceof AppError ? "Backup gagal (HTTP " + error.status + ")." : "Backup gagal diproses.",
      },
    }).catch(() => null);
    throw new AppError(502, "Backup belum berhasil. Periksa konfigurasi dan status koneksi Drive.");
  }
}

async function verifyJobToken(candidate: string) {
  const result = await serviceRequest("rpc/verify_cssmora_drive_job_secret", {
    method: "POST",
    body: { p_candidate: candidate },
  });
  return result.data === true;
}

async function authorizeWorker(request: Request, action: string) {
  const jobToken = request.headers.get("x-cssmora-drive-job") || "";
  if (jobToken) {
    if (!await verifyJobToken(jobToken)) throw new AppError(401, "Token jadwal Drive tidak valid.");
    if (action !== "sync" && action !== "backup") throw new AppError(400, "Tugas Drive tidak valid.");
    return { source: "schedule" };
  }
  const actor = await requireUser(request);
  requireLeadership(actor.roles);
  if (action !== "sync" && action !== "backup") throw new AppError(400, "Tugas Drive tidak valid.");
  return { source: "admin", email: actor.email };
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") {
    const headers = corsHeaders(request);
    if (request.headers.get("origin") && !headers.has("Access-Control-Allow-Origin")) {
      return new Response(null, { status: 403, headers });
    }
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("action") === "callback") {
    return await oauthCallback(request);
  }
  if (request.method !== "POST") return jsonResponse(request, 405, { error: "Metode tidak didukung." });

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "connect") {
      const result = await startOAuth(request);
      return jsonResponse(request, 200, result);
    }
    if (action === "status") {
      const actor = await requireUser(request);
      return jsonResponse(request, 200, await integrationStatus());
    }
    if (action === "sync" || action === "backup") {
      await authorizeWorker(request, action);
      const result = action === "sync" ? await runSync() : await runBackup();
      return jsonResponse(request, 200, { ok: true, action, ...result });
    }
    return jsonResponse(request, 400, { error: "Perintah Drive tidak dikenal." });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : "Integrasi Google Drive mengalami kendala.";
    return jsonResponse(request, status, { error: message });
  }
}

Deno.serve(handleRequest);
