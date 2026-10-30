import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const DEFAULT_DRIVE_EMAIL = "unair@cssmora.org";
const DRIVE_SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const MAX_SYNC_BATCH = 5;
const MAX_SYNC_ATTEMPTS = 8;
const BACKUP_PREFIX = new TextEncoder().encode("CSSMORA-DRIVE-BACKUP-V1\n");

class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function clean(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function formatMoney(value: unknown) {
  return `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
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
    "cssmora_drive_connections?select=account_email,drive_root_folder_id,drive_uploads_folder_id,drive_backups_folder_id,backup_spreadsheet_id,refresh_token_ciphertext&singleton=eq.true&limit=1",
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
  if (!response.ok) throw new AppError(response.status, "Permintaan ke Google API gagal.");
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

async function findOrCreateProgramDocumentsFolder(accessToken: string, parentId: string) {
  const query = new URLSearchParams({
    q: `name='Dokumen Proposal dan LPJ' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    pageSize: "10",
  });
  const found = await googleJson(accessToken, "https://www.googleapis.com/drive/v3/files?" + query.toString());
  const existing = Array.isArray(found.data?.files) ? found.data.files[0] : null;
  if (existing?.id) return String(existing.id);
  return await createDriveFolder(accessToken, "Dokumen Proposal dan LPJ", parentId);
}

function programDocumentRequests(blocks: any[], previousEndIndex = 2) {
  const textParts: string[] = [];
  const styles: any[] = [];
  const photos: Array<{ index: number; uri: string; markerLength: number }> = [];
  const pageBreaks: Array<{ index: number; markerLength: number }> = [];
  const tables: Array<{ index: number; markerLength: number; rows: string[][]; columns: number }> = [];
  let index = 1;
  for (const raw of blocks) {
    const kind = String(raw?.kind || "paragraph");
    let value = typeof raw?.text === "string" ? raw.text.replace(/\r/g, "") : "";
    if (kind === "table") {
      const rows = Array.isArray(raw?.rows) ? raw.rows.slice(0, 100) : [];
      const normalizedRows = rows.map((row: unknown[]) => Array.isArray(row) ? row.slice(0, 10).map(cell => String(cell ?? "").replace(/[\t\n]+/g, " ").trim()) : []);
      const columns = Math.max(1, ...normalizedRows.map(row => row.length));
      const marker = `CSSMORA_TABLE_SLOT_${String(tables.length + 1).padStart(6, "0")}`;
      if (normalizedRows.length) tables.push({ index, markerLength: marker.length, rows: normalizedRows.map(row => Array.from({ length: columns }, (_, column) => row[column] || "")), columns });
      value = normalizedRows.length ? marker : "";
    }
    if (kind === "photo") {
      const uri = String(raw?.uri || "");
      if (!/^https:\/\//i.test(uri)) throw new AppError(400, "Tautan dokumentasi tidak valid.");
      const photoNumber=String(photos.length+1).padStart(6,"0");
      const photoMarker=`CSSMORA_IMAGE_SLOT_${photoNumber}`;
      photos.push({ index, uri, markerLength: photoMarker.length });
      value = `${photoMarker}\n${value}`;
    }
    if (kind === "pagebreak") {
      const marker = `CSSMORA_PAGE_BREAK_SLOT_${String(pageBreaks.length + 1).padStart(6, "0")}`;
      pageBreaks.push({ index, markerLength: marker.length });
      value = marker;
    }
    if (value.length > 8000) throw new AppError(413, "Salah satu bagian dokumen terlalu panjang.");
    const start = index;
    textParts.push(value + "\n");
    index += value.length + 1;
    if (["title", "subtitle", "center", "heading", "signature", "paragraph", "link"].includes(kind)) styles.push({ kind: kind === "link" ? "paragraph" : kind, start, end: index });
  }
  const text = textParts.join("");
  if (!text.trim() || text.length > 80000) throw new AppError(413, "Isi Google Docs kosong atau terlalu panjang.");
  const requests: any[] = [];
  if (previousEndIndex > 2) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: previousEndIndex - 1 } } });
  requests.push({ insertText: { location: { index: 1 }, text } });
  requests.push({ updateDocumentStyle: {
    documentStyle: {
      pageSize: { width: { magnitude: 595.28, unit: "PT" }, height: { magnitude: 841.89, unit: "PT" } },
      marginTop: { magnitude: 62, unit: "PT" }, marginBottom: { magnitude: 62, unit: "PT" },
      marginLeft: { magnitude: 68, unit: "PT" }, marginRight: { magnitude: 68, unit: "PT" },
    },
    fields: "pageSize,marginTop,marginBottom,marginLeft,marginRight",
  } });
  requests.push({ updateTextStyle: {
    range: { startIndex: 1, endIndex: text.length + 1 },
    textStyle: { weightedFontFamily: { fontFamily: "Times New Roman" }, fontSize: { magnitude: 12, unit: "PT" }, foregroundColor: { color: { rgbColor: { red: 0.08, green: 0.13, blue: 0.1 } } } },
    fields: "weightedFontFamily,fontSize,foregroundColor",
  } });
  for (const style of styles) {
    if (style.end <= style.start) continue;
    if (style.kind === "title") {
      requests.push({ updateParagraphStyle: { range: { startIndex: style.start, endIndex: style.end }, paragraphStyle: { namedStyleType: "TITLE", alignment: "CENTER", spaceAbove: { magnitude: 80, unit: "PT" }, spaceBelow: { magnitude: 10, unit: "PT" } }, fields: "namedStyleType,alignment,spaceAbove,spaceBelow" } });
      requests.push({ updateTextStyle: { range: { startIndex: style.start, endIndex: style.end - 1 }, textStyle: { bold: true, fontSize: { magnitude: 20, unit: "PT" } }, fields: "bold,fontSize" } });
    } else if (style.kind === "subtitle") {
      requests.push({ updateParagraphStyle: { range: { startIndex: style.start, endIndex: style.end }, paragraphStyle: { alignment: "CENTER", spaceBelow: { magnitude: 12, unit: "PT" } }, fields: "alignment,spaceBelow" } });
      requests.push({ updateTextStyle: { range: { startIndex: style.start, endIndex: style.end - 1 }, textStyle: { bold: true, fontSize: { magnitude: 16, unit: "PT" } }, fields: "bold,fontSize" } });
    } else if (style.kind === "heading") {
      requests.push({ updateParagraphStyle: { range: { startIndex: style.start, endIndex: style.end }, paragraphStyle: { namedStyleType: "HEADING_1", spaceAbove: { magnitude: 15, unit: "PT" }, spaceBelow: { magnitude: 5, unit: "PT" }, keepWithNext: true }, fields: "namedStyleType,spaceAbove,spaceBelow,keepWithNext" } });
      requests.push({ updateTextStyle: { range: { startIndex: style.start, endIndex: style.end - 1 }, textStyle: { bold: true, foregroundColor: { color: { rgbColor: { red: 0.10, green: 0.31, blue: 0.21 } } } }, fields: "bold,foregroundColor" } });
    } else if (style.kind === "signature" || style.kind === "center") {
      requests.push({ updateParagraphStyle: { range: { startIndex: style.start, endIndex: style.end }, paragraphStyle: { alignment: "CENTER", lineSpacing: 115 }, fields: "alignment,lineSpacing" } });
    } else if (style.kind === "paragraph") {
      requests.push({ updateParagraphStyle: { range: { startIndex: style.start, endIndex: style.end }, paragraphStyle: { lineSpacing: 115, spaceBelow: { magnitude: 7, unit: "PT" } }, fields: "lineSpacing,spaceBelow" } });
    } else if (style.kind === "tableHeader") {
      requests.push({ updateTextStyle: { range: { startIndex: style.start, endIndex: style.end }, textStyle: { bold: true, fontSize: { magnitude: 10, unit: "PT" } }, fields: "bold,fontSize" } });
    } else if (style.kind === "tableBody") {
      requests.push({ updateTextStyle: { range: { startIndex: style.start, endIndex: style.end }, textStyle: { fontSize: { magnitude: 9, unit: "PT" } }, fields: "fontSize" } });
    }
  }
  const anchors = [
    ...photos.map(photo => ({ ...photo, kind: "photo" as const })),
    ...pageBreaks.map(pageBreak => ({ ...pageBreak, kind: "pagebreak" as const })),
    ...tables.map(table => ({ ...table, kind: "table" as const })),
  ].sort((a, b) => b.index - a.index);
  for (const anchor of anchors) {
    requests.push({ deleteContentRange: { range: { startIndex: anchor.index, endIndex: anchor.index + anchor.markerLength } } });
    if (anchor.kind === "photo") {
      requests.push({ insertInlineImage: { location: { index: anchor.index }, uri: anchor.uri, objectSize: { width: { magnitude: 390, unit: "PT" } } } });
    } else if (anchor.kind === "pagebreak") {
      requests.push({ insertPageBreak: { location: { index: anchor.index } } });
    } else {
      requests.push({ insertTable: { rows: anchor.rows.length, columns: anchor.columns, location: { index: anchor.index } } });
    }
  }
  return { text, requests, tables: tables.map(({ rows, columns }) => ({ rows, columns })) };
}

function programDocumentTableCellRequests(document: any, tables: Array<{ rows: string[][]; columns: number }>) {
  const structuralTables = (document?.body?.content || []).filter((item: any) => item?.table);
  if (structuralTables.length !== tables.length) throw new AppError(502, "Struktur tabel Google Docs belum terbentuk dengan benar.");
  const requests: any[] = [];
  for (let tableIndex = tables.length - 1; tableIndex >= 0; tableIndex--) {
    const source = tables[tableIndex];
    const tableElement = structuralTables[tableIndex];
    const tableStart = Number(tableElement.startIndex);
    requests.push({ updateTableCellStyle: {
      tableRange: { tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: source.columns },
      tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 0.10, green: 0.31, blue: 0.21 } } } },
      fields: "backgroundColor",
    } });
    const cells: Array<{ index: number; text: string; header: boolean }> = [];
    const rows = tableElement.table.tableRows || [];
    for (let rowIndex = 0; rowIndex < source.rows.length; rowIndex++) {
      const structuralRow = rows[rowIndex];
      for (let columnIndex = 0; columnIndex < source.columns; columnIndex++) {
        const cell = structuralRow?.tableCells?.[columnIndex];
        const paragraph = (cell?.content || []).find((element: any) => element?.paragraph);
        const index = Number(paragraph?.startIndex);
        const text = source.rows[rowIndex][columnIndex] || "";
        if (Number.isInteger(index) && index > 0 && text) cells.push({ index, text, header: rowIndex === 0 });
      }
    }
    cells.sort((a, b) => b.index - a.index);
    for (const cell of cells) {
      requests.push({ insertText: { location: { index: cell.index }, text: cell.text } });
      requests.push({ updateTextStyle: {
        range: { startIndex: cell.index, endIndex: cell.index + cell.text.length },
        textStyle: {
          weightedFontFamily: { fontFamily: "Times New Roman" },
          fontSize: { magnitude: 9, unit: "PT" },
          ...(cell.header ? { bold: true, foregroundColor: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } } : {}),
        },
        fields: cell.header ? "weightedFontFamily,fontSize,bold,foregroundColor" : "weightedFontFamily,fontSize",
      } });
    }
  }
  return requests;
}

async function createProgramGoogleDoc(accessToken: string, connection: any, input: any) {
  const title = String(input.title || "").trim().slice(0, 180);
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 120) : [];
  if (title.length < 3 || (!blocks.length && !input.template_data)) throw new AppError(400, "Judul dan isi dokumen wajib tersedia.");
  const folderId = await findOrCreateProgramDocumentsFolder(accessToken, String(connection.drive_root_folder_id || ""));
  if (input.template_data) {
    const template = await importProgramTemplate(accessToken, folderId, String(input.template_data.document_type || "proposal"), title, String(input.document_id || ""));
    await renderProgramDocumentTemplate(accessToken, template.documentId, input.template_data);
    const documentRoles = Array.isArray(input.share_roles)
      ? input.share_roles.map((role: unknown) => String(role)).filter((role: string) => ["sekretaris", "bendahara", "ketua"].includes(role))
      : ["sekretaris", "ketua"];
    await shareProgramDocument(accessToken, template.documentId, [String(input.actor_email || "")], documentRoles.length ? documentRoles : ["sekretaris", "ketua"]);
    return { documentId: template.documentId, webViewLink: template.webViewLink, title };
  }
  let documentId = String(input.document_id || "").trim();
  let webViewLink = "";
  let endIndex = 2;
  if (documentId) {
    const existing = await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}?fields=id,name,mimeType,webViewLink`);
    if (existing.data?.mimeType !== "application/vnd.google-apps.document") throw new AppError(404, "Google Docs yang akan diperbarui tidak ditemukan.");
    const patched = await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}?fields=id,name,webViewLink`, { method: "PATCH", body: { name: title } });
    webViewLink = String(patched.data?.webViewLink || existing.data?.webViewLink || "");
    const document = await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
    const content = document.data?.body?.content;
    const last = Array.isArray(content) && content.length ? content[content.length - 1] : null;
    endIndex = Number(last?.endIndex || 2);
  } else {
    const created = await googleJson(accessToken, "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink", {
      method: "POST", body: { name: title, mimeType: "application/vnd.google-apps.document", parents: [folderId] },
    });
    documentId = String(created.data?.id || "");
    webViewLink = String(created.data?.webViewLink || "");
    if (!documentId) throw new AppError(502, "Google Docs belum dapat dibuat.");
  }
  const compiled = programDocumentRequests(blocks, endIndex);
  await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests: compiled.requests } });
  if (compiled.tables.length) {
    const populatedDoc = await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
    const tableRequests = programDocumentTableCellRequests(populatedDoc.data, compiled.tables);
    if (tableRequests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests: tableRequests } });
  }
  if (!webViewLink) webViewLink = "https://docs.google.com/document/d/" + encodeURIComponent(documentId) + "/edit";
  const documentRoles = Array.isArray(input.share_roles)
    ? input.share_roles.map((role: unknown) => String(role)).filter((role: string) => ["sekretaris", "bendahara", "ketua"].includes(role))
    : ["sekretaris", "ketua"];
  await shareProgramDocument(accessToken, documentId, [String(input.actor_email || "")], documentRoles.length ? documentRoles : ["sekretaris", "ketua"]);
  return { documentId, webViewLink, title };
}

async function activeRoleEmails(roles: string[]) {
  if (!roles.length) return [];
  const query = new URLSearchParams({ select: "email", role: "in.(" + roles.join(",") + ")", is_active: "eq.true" });
  const rows = (await serviceRequest("cssmora_user_roles?" + query.toString())).data;
  return [...new Set((Array.isArray(rows) ? rows : []).map((row: any) => String(row.email || "").trim().toLowerCase()).filter(Boolean))];
}

function drivePermissionRank(role: string) {
  return ({
    reader: 1,
    commenter: 2,
    writer: 3,
    fileOrganizer: 4,
    organizer: 4,
    owner: 5,
  } as Record<string, number>)[role] || 0;
}

async function shareDriveFile(accessToken: string, fileId: string, emails: string[], role: "reader" | "writer" = "reader") {
  const uniqueEmails = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
  if (!fileId || !uniqueEmails.length) return;
  const permissions: any[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ fields: "nextPageToken,permissions(id,emailAddress,role,type,permissionDetails(inherited))", pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${query}`);
    permissions.push(...(Array.isArray(response.data?.permissions) ? response.data.permissions : []));
    pageToken = String(response.data?.nextPageToken || "");
  } while (pageToken);

  for (const email of uniqueEmails) {
    const matches = permissions.filter((item: any) => String(item.emailAddress || "").trim().toLowerCase() === email);
    if (matches.some((item: any) => drivePermissionRank(String(item.role || "")) >= drivePermissionRank(role))) continue;
    const directPermission = matches
      .filter((item: any) => item.id && (!Array.isArray(item.permissionDetails) || !item.permissionDetails.some((detail: any) => detail?.inherited)))
      .sort((a: any, b: any) => drivePermissionRank(String(a.role || "")) - drivePermissionRank(String(b.role || "")))[0];
    if (directPermission) {
      await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(String(directPermission.id))}?fields=id,emailAddress,role`, {
        method: "PATCH", body: { role },
      });
      directPermission.role = role;
      continue;
    }
    await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id,emailAddress,role`, {
      method: "POST", body: { type: "user", role, emailAddress: email },
    });
  }
}

async function shareProgramDocument(accessToken: string, documentId: string, extraEmails: string[] = [], roles: string[] = ["sekretaris"]) {
  const roleEmails = await activeRoleEmails(roles);
  await shareDriveFile(accessToken, documentId, extraEmails, "writer");
  await shareDriveFile(accessToken, documentId, roleEmails, "reader");
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

async function importProgramTemplate(accessToken: string, folderId: string, documentType: string, title: string, existingDocumentId = "") {
  const templateName = documentType === "lpj" ? "cssmora-lpj.docx.b64" : "cssmora-proposal.docx.b64";
  let bytes: Uint8Array;
  try {
    let encoded = "";
    try {
      encoded = await Deno.readTextFile(`./templates/${templateName}`);
    } catch {
      const templateUrl = `https://raw.githubusercontent.com/naufalfauza-cell/CSSMoRA/main/supabase/functions/drive-integration/templates/${templateName}`;
      const response = await fetch(templateUrl, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new AppError(502, "Template resmi belum dapat dimuat dari penyimpanan aplikasi.");
      encoded = await response.text();
    }
    bytes = fromBase64(encoded.trim());
  } catch {
    throw new AppError(500, "Aset template proposal/LPJ belum ikut terpasang pada Edge Function.");
  }
  if (bytes.length < 1000 || bytes.length > 15 * 1024 * 1024) throw new AppError(413, "Ukuran template resmi di luar batas yang didukung.");
  if (existingDocumentId) {
    const existing = await googleJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingDocumentId)}?fields=id,mimeType,webViewLink`);
    if (existing.data?.mimeType !== GOOGLE_DOC_MIME) throw new AppError(404, "Google Docs yang akan diperbarui tidak ditemukan.");
  }

  const filePath = existingDocumentId
    ? `files/${encodeURIComponent(existingDocumentId)}`
    : "files";
  const query = new URLSearchParams({ uploadType: "resumable", fields: "id,name,mimeType,webViewLink" });
  const metadata: Record<string, unknown> = { name: title };
  if (!existingDocumentId) {
    metadata.mimeType = GOOGLE_DOC_MIME;
    metadata.parents = [folderId];
  }
  const initialize = await fetch(`https://www.googleapis.com/upload/drive/v3/${filePath}?${query}`, {
    method: existingDocumentId ? "PATCH" : "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": DOCX_MIME,
      "X-Upload-Content-Length": String(bytes.length),
    },
    body: JSON.stringify(metadata),
  });
  const sessionUrl = initialize.headers.get("Location");
  if (!initialize.ok || !sessionUrl) throw new AppError(initialize.status || 502, "Sesi impor template resmi ke Google Docs gagal dimulai.");
  const upload = await fetch(sessionUrl, {
    method: "PUT",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": DOCX_MIME },
    body: bytes,
    signal: AbortSignal.timeout(55_000),
  });
  const raw = await upload.text();
  let file: any = null;
  if (raw) try { file = JSON.parse(raw); } catch { file = null; }
  if (!upload.ok || !file?.id) throw new AppError(upload.status || 502, "Template resmi belum berhasil diimpor sebagai Google Docs.");
  if (file.mimeType && file.mimeType !== GOOGLE_DOC_MIME) throw new AppError(502, "Google Drive tidak mengonversi template resmi menjadi Google Docs.");
  return { documentId: String(file.id), webViewLink: String(file.webViewLink || `https://docs.google.com/document/d/${encodeURIComponent(String(file.id))}/edit`) };
}

function templateDocumentBody(document: any) {
  return document?.body || document?.tabs?.[0]?.body || {};
}

function templateParagraphText(paragraph: any) {
  return (paragraph?.elements || []).map((element: any) => String(element?.textRun?.content || "")).join("").replace(/\n+$/g, "").replace(/\u00a0/g, " ").trim();
}

function templateTextKey(value: unknown) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID").replace(/^[a-h][.)]\s*/, "");
}

function templateParagraphRange(paragraph: any) {
  const elements = (paragraph?.elements || []).filter((element: any) => element?.textRun && Number.isInteger(Number(element.startIndex)) && Number.isInteger(Number(element.endIndex)));
  if (!elements.length) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];
  let endIndex = Number(last.endIndex);
  if (String(last.textRun?.content || "").endsWith("\n")) endIndex--;
  const startIndex = Number(first.startIndex);
  return endIndex >= startIndex ? { startIndex, endIndex } : null;
}

function templateCellRange(cell: any) {
  const elements: any[] = [];
  for (const item of cell?.content || []) {
    if (item?.paragraph) elements.push(...(item.paragraph.elements || []).filter((element: any) => element?.textRun && Number.isInteger(Number(element.startIndex)) && Number.isInteger(Number(element.endIndex))));
  }
  if (!elements.length) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];
  let endIndex = Number(last.endIndex);
  if (String(last.textRun?.content || "").endsWith("\n")) endIndex--;
  const startIndex = Number(first.startIndex);
  return endIndex >= startIndex ? { startIndex, endIndex } : null;
}

const PROGRAM_BODY_TEXT_STYLE = {
  weightedFontFamily: { fontFamily: "Times New Roman" },
  fontSize: { magnitude: 12, unit: "PT" },
  foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
  bold: false,
  italic: false,
  underline: false,
};

const PROGRAM_COMMITTEE_TEXT_STYLE = {
  weightedFontFamily: { fontFamily: "Times New Roman" },
  fontSize: { magnitude: 11, unit: "PT" },
  foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
  bold: false,
  italic: false,
  underline: false,
};

const PROGRAM_TABLE_TEXT_STYLE = {
  weightedFontFamily: { fontFamily: "Times New Roman" },
  fontSize: { magnitude: 9, unit: "PT" },
  foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
  bold: false,
  italic: false,
  underline: false,
};

function textStyleFieldMask(textStyle: Record<string, unknown>) {
  return Object.keys(textStyle).join(",");
}

function templateTopParagraphs(document: any) {
  return (templateDocumentBody(document).content || []).filter((item: any) => item?.paragraph);
}

function templateTables(document: any) {
  const tables: any[] = [];
  const visit = (content: any[]) => {
    for (const item of content || []) {
      if (item?.table) {
        tables.push(item);
        for (const row of item.table.tableRows || []) {
          for (const cell of row.tableCells || []) visit(cell.content || []);
        }
      }
    }
  };
  visit(templateDocumentBody(document).content || []);
  return tables;
}

function templateTableCellText(cell: any) {
  return (cell?.content || []).filter((item: any) => item?.paragraph).map((item: any) => templateParagraphText(item.paragraph)).filter(Boolean).join(" ");
}

function templateTableRows(table: any) {
  return table?.table?.tableRows || [];
}

function templateTableHeaderIndex(table: any, headers: string[]) {
  const expected = headers.map(templateTextKey);
  const rows = templateTableRows(table);
  for (let index = 0; index < Math.min(rows.length, 3); index++) {
    const actual = (rows[index]?.tableCells || []).map(templateTableCellText).map(templateTextKey);
    if (expected.every((value, cellIndex) => actual[cellIndex] === value)) return index;
  }
  return -1;
}

function findProgramTable(document: any, headers: string[]) {
  return templateTables(document).find((element: any) => templateTableHeaderIndex(element, headers) >= 0) || null;
}

function templateEditForParagraph(paragraph: any, text: string) {
  const range = templateParagraphRange(paragraph);
  return range ? { ...range, text: String(text || "") } : null;
}

function templateEditForCell(cell: any, text: string) {
  const range = templateCellRange(cell);
  return range ? { ...range, text: String(text || "") } : null;
}

async function applyTemplateEdits(
  accessToken: string,
  documentId: string,
  edits: Array<{ startIndex: number; endIndex: number; text: string; textStyle?: Record<string, unknown> }>,
  defaultTextStyle?: Record<string, unknown>,
) {
  const requests: any[] = [];
  for (const edit of [...edits].sort((a, b) => b.startIndex - a.startIndex)) {
    if (edit.endIndex > edit.startIndex) requests.push({ deleteContentRange: { range: { startIndex: edit.startIndex, endIndex: edit.endIndex } } });
    if (edit.text) {
      requests.push({ insertText: { location: { index: edit.startIndex }, text: edit.text } });
      const textStyle = edit.textStyle || defaultTextStyle;
      if (textStyle) requests.push({
        updateTextStyle: {
          range: { startIndex: edit.startIndex, endIndex: edit.startIndex + edit.text.length },
          textStyle,
          fields: textStyleFieldMask(textStyle),
        },
      });
    }
  }
  if (requests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
}

function findProgramSignatory(committee: any[], role: string) {
  const sought = templateTextKey(role);
  return (committee || []).find((row: any) => templateTextKey(row.role_title) === sought) || null;
}

function splitTemplateList(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw.split(/\n+|\s*;\s*/).map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 12);
}

function formatTemplateTime(value: unknown) {
  const time = String(value || "").trim();
  return time.replace(":", ".");
}

function formatTemplateDuration(start: unknown, end: unknown) {
  const parse = (value: unknown) => {
    const match = String(value || "").match(/^(\d{1,2})[:.](\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const first = parse(start), last = parse(end);
  if (first === null || last === null) return "—";
  const minutes = (last - first + 1440) % 1440;
  return `${minutes} menit`;
}

function formatTemplateDate(value: unknown, withWeekday = true) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return clean(raw, 120);
  const date = new Date(`${raw}T00:00:00+07:00`);
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  };
  if (withWeekday) options.weekday = "long";
  return new Intl.DateTimeFormat("id-ID", options).format(date);
}

function formatTemplateDateRange(data: any, actual = false) {
  const start = clean(actual ? data.actual_date_start : data.event_date_start, 40);
  const end = clean(actual ? data.actual_date_end : data.event_date_end, 40);
  const fallback = clean(actual ? data.actual_date_text : data.event_date_text, 150);
  if (!start) return fallback || "Belum ditetapkan";
  const first = formatTemplateDate(start);
  const last = end && end !== start ? formatTemplateDate(end) : "";
  return last ? `${first}–${last}` : first;
}

function programDivisionLabel(value: unknown) {
  const raw = clean(value, 100).replace(/^(?:departemen|divisi)\s+/i, "").trim();
  const key = templateTextKey(raw);
  const labels: Record<string, string> = {
    psdm: "Pengembangan Sumber Daya Manusia",
    p3m: "Pendidikan, Penelitian, dan Pengabdian Masyarakat",
    advo: "Advokasi dan Hubungan Luar",
    advokasi: "Advokasi dan Hubungan Luar",
    medinfo: "Media dan Informasi",
    sekretariat: "Sekretariat",
    bendahara: "Bendahara",
    bph: "Badan Pengurus Harian",
    lainnya: "Lainnya",
  };
  return labels[key] || raw || "CSSMoRA UNAIR";
}

function templateCellFillEdits(table: any, values: string[][], headerRowIndex: number) {
  const rows = templateTableRows(table);
  const edits: Array<{ startIndex: number; endIndex: number; text: string }> = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex]?.tableCells || [];
    const valueRowIndex = rowIndex - headerRowIndex - 1;
    if (valueRowIndex >= values.length) continue;
    const valuesForCells = cells.length === values[valueRowIndex].length
      ? values[valueRowIndex]
      : cells.map((cell: any, cellIndex: number) => {
        const logicalIndex = cells.slice(0, cellIndex).reduce((sum: number, prior: any) => sum + Math.max(1, Number(prior?.tableCellStyle?.columnSpan || 1)), 0);
        return cellIndex === cells.length - 1 && logicalIndex < values[valueRowIndex].length - 1
          ? values[valueRowIndex][values[valueRowIndex].length - 1] || values[valueRowIndex][logicalIndex] || ""
          : values[valueRowIndex][logicalIndex] || "";
      });
    for (let columnIndex = 0; columnIndex < cells.length; columnIndex++) {
      const value = valuesForCells[columnIndex] || "";
      const edit = templateEditForCell(cells[columnIndex], value);
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

function programTableAlignment(headers: string[], columnIndex: number) {
  const label = String(headers[columnIndex] || "").toLocaleLowerCase("id-ID");
  if (label === "no") return "CENTER";
  if (["harga", "jumlah total", "total"].includes(label)) return "END";
  if (["pack", "waktu", "durasi"].includes(label)) return "CENTER";
  return "START";
}

function programTableFormatRequests(document: any, headers: string[]) {
  const table = findProgramTable(document, headers);
  if (!table) return [];
  const rows = templateTableRows(table);
  const headerRowIndex = templateTableHeaderIndex(table, headers);
  if (headerRowIndex < 0) return [];
  const requests: any[] = [];
  const tableStartIndex = Number(table.startIndex);
  const headerCells = rows[headerRowIndex]?.tableCells || [];
  const columnCount = headerCells.reduce((count: number, cell: any) => count + Math.max(1, Number(cell?.tableCellStyle?.columnSpan || 1)), 0);
  if (Number.isInteger(tableStartIndex) && tableStartIndex > 0 && rows.length && columnCount) {
    requests.push({
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: { tableStartLocation: { index: tableStartIndex }, rowIndex: 0, columnIndex: 0 },
          rowSpan: rows.length,
          columnSpan: columnCount,
        },
        tableCellStyle: {
          paddingTop: { magnitude: 3, unit: "PT" },
          paddingBottom: { magnitude: 3, unit: "PT" },
          paddingLeft: { magnitude: 4, unit: "PT" },
          paddingRight: { magnitude: 4, unit: "PT" },
          verticalAlignment: "MIDDLE",
        },
        fields: "paddingTop,paddingBottom,paddingLeft,paddingRight,verticalAlignment",
      },
    });
  }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex]?.tableCells || [];
    const rowText = cells.map(templateCellText).join(" ").toLocaleLowerCase("id-ID");
    const isHeader = rowIndex === headerRowIndex;
    const isTotal = rowText.includes("total pemasukan") || rowText.includes("total pengeluaran");
    let logicalColumn = 0;
    for (const cell of cells) {
      const cellText = templateCellText(cell);
      const isTableTitle = rowIndex < headerRowIndex && Boolean(cellText);
      const range = templateCellRange(cell);
      const cellSpan = Math.max(1, Number(cell?.tableCellStyle?.columnSpan || 1));
      const centerTotalLabel = isTotal && /total\s+(?:pemasukan|pengeluaran)/i.test(cellText);
      if (range && range.endIndex > range.startIndex) {
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              weightedFontFamily: { fontFamily: "Times New Roman" },
              fontSize: { magnitude: 9, unit: "PT" },
              foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
              bold: isHeader || isTableTitle || isTotal,
              italic: false,
              underline: false,
            },
            fields: "weightedFontFamily,fontSize,foregroundColor,bold,italic,underline",
          },
        });
      }
      for (const item of cell?.content || []) {
        if (!item?.paragraph) continue;
        const paragraph = item.paragraph;
        const startIndex = Number(item.startIndex);
        const endIndex = Number(item.endIndex);
        if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) continue;
        requests.push({
          updateParagraphStyle: {
            range: { startIndex, endIndex },
            paragraphStyle: {
              alignment: isHeader || isTableTitle || centerTotalLabel
                ? "CENTER"
              : programTableAlignment(headers, logicalColumn),
              indentStart: { magnitude: 0, unit: "PT" },
              indentEnd: { magnitude: 0, unit: "PT" },
              indentFirstLine: { magnitude: 0, unit: "PT" },
              spaceAbove: { magnitude: 0, unit: "PT" },
              spaceBelow: { magnitude: 0, unit: "PT" },
              lineSpacing: 110,
            },
            fields: "alignment,indentStart,indentEnd,indentFirstLine,spaceAbove,spaceBelow,lineSpacing",
          },
        });
      }
      logicalColumn += cellSpan;
    }
  }
  return requests;
}

async function resizeProgramTable(accessToken: string, documentId: string, headers: string[], dataRowCount: number, trailingRows = 1) {
  let document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  let table = findProgramTable(document, headers);
  if (!table) throw new AppError(502, `Tabel ${headers[1] || "dokumen"} tidak ditemukan pada template resmi.`);
  const headerRowIndex = templateTableHeaderIndex(table, headers);
  if (headerRowIndex < 0) throw new AppError(502, `Header tabel ${headers[1] || "dokumen"} tidak ditemukan pada template resmi.`);
  const desiredRows = Math.max(headerRowIndex + 2 + trailingRows, headerRowIndex + 1 + dataRowCount + trailingRows);
  let currentRows = templateTableRows(table).length;
  if (currentRows === desiredRows) return document;
  const tableStartIndex = Number(table.startIndex);
  const requests: any[] = [];
  const lastDataRow = () => currentRows - trailingRows - 1;
  while (currentRows < desiredRows) {
    requests.push({ insertTableRow: { tableCellLocation: { tableStartLocation: { index: tableStartIndex }, rowIndex: Math.max(headerRowIndex, lastDataRow()), columnIndex: 0 }, insertBelow: true } });
    currentRows++;
  }
  while (currentRows > desiredRows) {
    requests.push({ deleteTableRow: { tableCellLocation: { tableStartLocation: { index: tableStartIndex }, rowIndex: Math.max(headerRowIndex + 1, lastDataRow()), columnIndex: 0 } } });
    currentRows--;
  }
  await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
  document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  return document;
}

async function fillProgramTable(accessToken: string, documentId: string, headers: string[], dataRowCount: number, values: string[][], trailingRows = 1) {
  const document = await resizeProgramTable(accessToken, documentId, headers, dataRowCount, trailingRows);
  const table = findProgramTable(document, headers);
  if (!table) throw new AppError(502, `Tabel ${headers[1] || "dokumen"} tidak dapat diisi.`);
  const headerRowIndex = templateTableHeaderIndex(table, headers);
  await applyTemplateEdits(accessToken, documentId, templateCellFillEdits(table, values, headerRowIndex), PROGRAM_TABLE_TEXT_STYLE);
}

function programPhotoMarkers(photos: any[]) {
  return photos.map((photo, index) => ({
    marker: `CSSMORA_LPJ_PHOTO_${String(index + 1).padStart(5, "0")}`,
    uri: String(photo.uri || ""),
    caption: clean(photo.caption || `Dokumentasi kegiatan ${index + 1}`, 300),
  })).filter((photo) => /^https:\/\//i.test(photo.uri));
}

async function appendProgramPhotos(accessToken: string, documentId: string, photos: any[]) {
  const markers = programPhotoMarkers(photos);
  if (!markers.length) return;
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const content = templateDocumentBody(document).content || [];
  const endIndex = Number(content[content.length - 1]?.endIndex || 2);
  const appendedStartIndex = Math.max(1, endIndex - 1);
  const bodyText = markers.map((photo) => `${photo.marker}\n${photo.caption}\n\n`).join("");
  await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests: [{ insertText: { location: { index: appendedStartIndex }, text: bodyText } }] } });
  const refreshed = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const ranges = markers.map((photo) => ({ ...photo, range: findGoogleDocMarkerRanges(refreshed, photo.marker)[0] })).filter((photo) => photo.range);
  const requests: any[] = [];
  for (const photo of ranges.sort((a, b) => b.range.startIndex - a.range.startIndex)) {
    requests.push({ deleteContentRange: { range: photo.range } });
    requests.push({ insertInlineImage: { location: { index: photo.range.startIndex }, uri: photo.uri, objectSize: { width: { magnitude: 390, unit: "PT" } } } });
  }
  if (requests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
  const withPhotos = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const captions = new Set(markers.map((photo) => photo.caption));
  const captionRequests: any[] = [];
  for (const item of templateDocumentBody(withPhotos).content || []) {
    if (!item?.paragraph || Number(item.startIndex) < appendedStartIndex) continue;
    const paragraph = item.paragraph;
    if (!captions.has(templateParagraphText(paragraph))) continue;
    const range = templateParagraphRange(paragraph);
    if (!range || range.endIndex <= range.startIndex) continue;
    captionRequests.push({
      updateTextStyle: {
        range,
        textStyle: { ...PROGRAM_COMMITTEE_TEXT_STYLE, fontSize: { magnitude: 10, unit: "PT" } },
        fields: "weightedFontFamily,fontSize,foregroundColor,bold,italic,underline",
      },
    });
    captionRequests.push({
      updateParagraphStyle: {
        range: { startIndex: Number(item.startIndex), endIndex: Number(item.endIndex) },
        paragraphStyle: { alignment: "CENTER", indentStart: { magnitude: 0, unit: "PT" }, indentEnd: { magnitude: 0, unit: "PT" }, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 6, unit: "PT" }, lineSpacing: 110 },
        fields: "alignment,indentStart,indentEnd,spaceAbove,spaceBelow,lineSpacing",
      },
    });
  }
  if (captionRequests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests: captionRequests } });
}

function topParagraphMatches(paragraphs: any[], text: string) {
  const key = templateTextKey(text);
  return paragraphs.filter((paragraph) => templateTextKey(templateParagraphText(paragraph.paragraph)) === key);
}

function sectionParagraphs(paragraphs: any[], startLabel: string, endLabel: string) {
  const start = paragraphs.findIndex((paragraph) => templateTextKey(templateParagraphText(paragraph.paragraph)) === templateTextKey(startLabel));
  if (start < 0) throw new AppError(502, `Bagian “${startLabel}” tidak ditemukan pada template resmi.`);
  let end = paragraphs.length;
  if (endLabel) {
    const found = paragraphs.findIndex((paragraph, index) => index > start && templateTextKey(templateParagraphText(paragraph.paragraph)) === templateTextKey(endLabel));
    if (found >= 0) end = found;
  }
  return paragraphs.slice(start + 1, end);
}

function pushParagraphEdit(edits: Array<{ startIndex: number; endIndex: number; text: string }>, paragraph: any | undefined, text: unknown) {
  if (!paragraph) return;
  const edit = templateEditForParagraph(paragraph.paragraph, String(text || ""));
  if (edit) edits.push(edit);
}

function approvalTableEditRequests(document: any, data: any) {
  const table = templateTables(document).find((element: any) => {
    const cells = templateTableRows(element)[0]?.tableCells || [];
    return cells.length >= 2 &&
      templateTextKey(templateTableCellText(cells[0])).includes("sekretaris umum cssmora universitas airlangga") &&
      templateTextKey(templateTableCellText(cells[1])).includes("ketua panitia");
  });
  if (!table) throw new AppError(502, "Tabel lembar pengesahan tidak ditemukan pada template resmi.");
  const edits: Array<{ startIndex: number; endIndex: number; text: string }> = [];
  const committee = Array.isArray(data.committee) ? data.committee : [];
  const chair = findProgramSignatory(committee, "Ketua Pelaksana") || findProgramSignatory(committee, "Ketua Panitia");
  const marker = "Nama Ketua Panitia";
  const range = findGoogleDocMarkerRanges(document, marker)[0];
  if (range) edits.push({ ...range, text: chair?.name ? clean(chair.name, 180).toLocaleUpperCase("id-ID") : "Belum ditentukan" });
  return { objectRequests: [], edits };
}

function committeeAppendixText(committee: any[], enabled: boolean) {
  if (!enabled) return "Susunan kepanitiaan tidak disertakan.";
  const rows = committee.filter((row) => clean(row.name, 180));
  if (!rows.length) return "Susunan kepanitiaan belum ditentukan.";
  const used = new Set<number>();
  const lines: string[] = [];
  const roles: Array<[string, string[]]> = [
    ["Ketua", ["ketua pelaksana", "ketua panitia"]],
    ["Wakil Ketua", ["wakil ketua pelaksana", "wakil ketua panitia"]],
    ["Sekretaris", ["sekretaris pelaksana", "sekretaris panitia"]],
    ["Bendahara", ["bendahara pelaksana", "bendahara panitia"]],
  ];
  for (const [label, aliases] of roles) {
    const index = rows.findIndex((row, rowIndex) => !used.has(rowIndex) && aliases.includes(templateTextKey(row.role_title)));
    if (index < 0) continue;
    used.add(index);
    lines.push(`${label}\t: ${clean(rows[index].name, 180)}`);
  }
  const remaining = rows.map((row, index) => ({ row, index })).filter((item) => !used.has(item.index));
  if (remaining.length) {
    if (lines.length) lines.push("");
    lines.push("Divisi-divisi:");
    const groups = new Map<string, any[]>();
    for (const { row } of remaining) {
      const division = clean(row.division, 100) || "Lainnya";
      const group = groups.get(division) || [];
      group.push(row);
      groups.set(division, group);
    }
    let groupNumber = 1;
    for (const [division, members] of groups) {
      members.forEach((row, memberIndex) => {
        const role = clean(row.role_title, 120) || "Anggota";
        const name = clean(row.name, 180);
        if (memberIndex === 0) lines.push(`${groupNumber}. Divisi ${division} : ${role} — ${name}`);
        else lines.push(`   ${role} — ${name}`);
      });
      groupNumber++;
    }
  }
  return lines.join("\n");
}

async function fillProgramCommitteeSection(accessToken: string, documentId: string, committee: any[], enabled: boolean) {
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const marker = "CSSMORA_COMMITTEE_SECTION_SLOT";
  const ranges = findGoogleDocMarkerRanges(document, marker);
  if (ranges.length !== 1) throw new AppError(502, "Posisi daftar panitia tidak ditemukan pada template proposal resmi.");
  await applyTemplateEdits(accessToken, documentId, [{ ...ranges[0], text: committeeAppendixText(committee, enabled) }], PROGRAM_COMMITTEE_TEXT_STYLE);
}

async function removeEmptyProgramGoalRows(accessToken: string, documentId: string) {
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const paragraphs = templateTopParagraphs(document);
  const start = paragraphs.findIndex((item: any) => templateTextKey(templateParagraphText(item.paragraph)) === "tujuan kegiatan");
  const end = paragraphs.findIndex((item: any, index: number) => index > start && templateTextKey(templateParagraphText(item.paragraph)) === "nama kegiatan");
  if (start < 0 || end <= start) return;
  const requests: any[] = [];
  for (const item of paragraphs.slice(start + 1, end)) {
    const paragraph = item.paragraph;
    if (templateParagraphText(paragraph) || !paragraph?.bullet) continue;
    const startIndex = Number(item.startIndex);
    const endIndex = Number(item.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) continue;
    requests.push({ deleteParagraphBullets: { range: { startIndex, endIndex } } });
    requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: { spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" }, lineSpacing: 100 },
        fields: "spaceAbove,spaceBelow,lineSpacing",
      },
    });
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { fontSize: { magnitude: 1, unit: "PT" } },
        fields: "fontSize",
      },
    });
  }
  if (requests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
}

async function normalizeProgramDocumentTypography(accessToken: string, documentId: string, documentType: string) {
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const body = templateDocumentBody(document);
  const content = body.content || [];
  const bodyEndIndex = Number(content[content.length - 1]?.endIndex || 2);
  const requests: any[] = [];
  if (bodyEndIndex > 2) requests.push({
    updateTextStyle: {
      range: { startIndex: 1, endIndex: bodyEndIndex - 1 },
      textStyle: { weightedFontFamily: { fontFamily: "Times New Roman" } },
      fields: "weightedFontFamily",
    },
  });
  if (documentType === "proposal") requests.push({
    updateDocumentStyle: {
      documentStyle: {
        pageSize: { width: { magnitude: 595.28, unit: "PT" }, height: { magnitude: 841.89, unit: "PT" } },
        marginTop: { magnitude: 113, unit: "PT" },
        marginBottom: { magnitude: 85, unit: "PT" },
        marginLeft: { magnitude: 113, unit: "PT" },
        marginRight: { magnitude: 85, unit: "PT" },
      },
      fields: "pageSize,marginTop,marginBottom,marginLeft,marginRight",
    },
  });

  const paragraphs = templateTopParagraphs(document);
  const formatParagraph = (item: any, paragraphStyle: Record<string, unknown>) => {
    const startIndex = Number(item?.startIndex);
    const endIndex = Number(item?.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) return;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle,
        fields: Object.keys(paragraphStyle).join(","),
      },
    });
    const textRange = templateParagraphRange(item.paragraph);
    if (textRange && textRange.endIndex > textRange.startIndex) {
      requests.push({ updateTextStyle: { range: textRange, textStyle: { italic: false }, fields: "italic" } });
    }
  };

  const approvalDate = paragraphs.find((item: any) => templateParagraphText(item.paragraph).toLocaleLowerCase("id-ID").startsWith("surabaya,"));
  if (approvalDate) formatParagraph(approvalDate, {
    alignment: "END",
    indentStart: { magnitude: 0, unit: "PT" },
    indentEnd: { magnitude: 0, unit: "PT" },
    indentFirstLine: { magnitude: 0, unit: "PT" },
    keepLinesTogether: true,
  });

  if (documentType === "proposal") {
    const signerIndex = paragraphs.findIndex((item: any) => templateTextKey(templateParagraphText(item.paragraph)) === "nama ketua umum");
    const bodyTitleIndex = signerIndex < 0
      ? -1
      : paragraphs.findIndex((item: any, index: number) => index > signerIndex && templateTextKey(templateParagraphText(item.paragraph)) === "proposal");
    const backgroundIndex = paragraphs.findIndex((item: any, index: number) => index > bodyTitleIndex && templateTextKey(templateParagraphText(item.paragraph)) === "latar belakang");
    if (bodyTitleIndex >= 0) {
      const titleBlockEnd = backgroundIndex > bodyTitleIndex ? backgroundIndex : bodyTitleIndex + 1;
      for (let index = bodyTitleIndex; index < titleBlockEnd; index++) {
        const isFirstBodyTitle = index === bodyTitleIndex;
        formatParagraph(paragraphs[index], {
          ...(isFirstBodyTitle ? { pageBreakBefore: true } : {}),
          keepWithNext: true,
          keepLinesTogether: true,
        });
      }
    }
  }

  const keepTogetherHeadings = new Set([
    "latar belakang", "tujuan kegiatan", "nama kegiatan", "tema kegiatan", "deskripsi kegiatan",
    "sasaran kegiatan", "waktu dan tempat pelaksanaan", "penutup", "lampiran 1", "susunan panitia",
    "lampiran 2", "susunan acara", "lampiran 3", "rencana anggaran dana", "pemasukan", "pengeluaran",
  ]);
  for (const item of paragraphs) {
    const key = templateTextKey(templateParagraphText(item.paragraph));
    if (!keepTogetherHeadings.has(key)) continue;
    formatParagraph(item, {
      keepWithNext: true,
      keepLinesTogether: true,
      ...(key === "lampiran 3" ? { pageBreakBefore: true } : {}),
    });
  }

  if (documentType === "proposal") {
    for (const headers of [
      ["No", "Kegiatan", "Waktu", "Durasi", "Keterangan"],
      ["No", "Sumber Dana", "Jumlah Total"],
      ["No", "Nama", "Harga", "Pack", "Total"],
    ]) requests.push(...programTableFormatRequests(document, headers));
  }
  if (requests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
}

async function renderProgramDocumentTemplate(accessToken: string, documentId: string, rawData: any) {
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const documentType = data.document_type === "lpj" ? "lpj" : "proposal";
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const paragraphs = templateTopParagraphs(document);
  const edits: Array<{ startIndex: number; endIndex: number; text: string }> = [];
  const setAll = (label: string, value: string) => topParagraphMatches(paragraphs, label).forEach((paragraph) => pushParagraphEdit(edits, paragraph, value));
  const setFollowingSlots = (heading: string, nextHeading: string, values: string[]) => {
    const slots = sectionParagraphs(paragraphs, heading, nextHeading);
    slots.forEach((paragraph, index) => pushParagraphEdit(edits, paragraph, values[index] || ""));
  };
  const title = clean(data.title, 180) || "Nama Kegiatan";
  const period = clean(data.period_label, 100);
  const year = clean(data.year, 4) || "2026";
  const committee = Array.isArray(data.committee) ? data.committee : [];
  const eventDate = formatTemplateDateRange(data, documentType === "lpj");
  const eventTime = clean(data.event_time_text || data.actual_time_text, 100) || "Belum ditetapkan";
  const place = clean(data.place || data.actual_place, 300) || "Belum ditetapkan";

  if (documentType === "proposal") {
    setFollowingSlots("Latar Belakang", "Tujuan Kegiatan", [clean(data.background, 7000) || clean(data.description, 7000) || "Latar belakang kegiatan belum dilengkapi."]);
    const goals = splitTemplateList(data.goals);
    const goalSlots = sectionParagraphs(paragraphs, "Tujuan Kegiatan", "Nama Kegiatan");
    const objectiveItems = goals.length > 4 ? [...goals.slice(0, 3), goals.slice(3).join("; ")] : goals;
    pushParagraphEdit(edits, goalSlots[0], `Kegiatan ${title} CSSMoRA Universitas Airlangga bertujuan untuk:`);
    for (let index = 1; index < goalSlots.length; index++) pushParagraphEdit(edits, goalSlots[index], objectiveItems[index - 1] || "");
    setFollowingSlots("Nama Kegiatan", "Tema Kegiatan", [`Kegiatan ini bernama “${title}” CSSMoRA Universitas Airlangga${period ? ` Periode ${period}` : ""}.`]);
    setFollowingSlots("Tema Kegiatan", "Deskripsi Kegiatan", [`Tema kegiatan ini adalah “${clean(data.theme, 600) || "Disesuaikan dengan arah dan tujuan kegiatan"}”.`]);
    const descriptionSlots = sectionParagraphs(paragraphs, "Deskripsi Kegiatan", "Sasaran Kegiatan");
    const materials = splitTemplateList(data.materials);
    const description = clean(data.approach, 7000) || clean(data.description, 7000) || "Deskripsi kegiatan belum dilengkapi.";
    pushParagraphEdit(edits, descriptionSlots[0], [description, materials.length ? `Materi kegiatan meliputi:\n${materials.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : ""].filter(Boolean).join("\n\n"));
    setFollowingSlots("Sasaran Kegiatan", "Waktu dan Tempat Pelaksanaan", [clean(data.target, 1000) || "Seluruh pengurus dan anggota aktif CSSMoRA Universitas Airlangga"]);
    const dateSlots = sectionParagraphs(paragraphs, "Waktu dan Tempat Pelaksanaan", "Penutup");
    pushParagraphEdit(edits, dateSlots[0], `${title} CSSMoRA Universitas Airlangga dilaksanakan pada:`);
    pushParagraphEdit(edits, dateSlots[1], `\tHari/tanggal\t: ${eventDate} · Waktu: ${eventTime}`);
    pushParagraphEdit(edits, dateSlots[2], `\tTempat\t: ${place}`);
    setFollowingSlots("Penutup", "Lampiran 1", [clean(data.closing, 7000) || `Demikian proposal kegiatan ${title} ini kami susun sebagai acuan pelaksanaan kegiatan.`, ""]);
  } else {
    setAll("(NAMA KEGIATAN)", title);
    setAll("(Nama Kegiatan)", title);
    setAll("(NAMA PROKER)", title);
    setAll("Tahun 2026", `Tahun ${year}`);
    setAll("(Waktu Pelaksanaan)", eventDate);
    setAll("(Surabaya, tgl proposal disahkan)", `(Surabaya, ${clean(data.approval_date_text, 100) || eventDate})`);
    const realizationHeading = "Realisasi Kegiatan (umum dan tiap seksi/divisi)";
    const evaluationHeading = "Evaluasi dan Saran (umum dan tiap seksi/divisi yang berisi kendala, solusi, dan evaluasi)";
    setAll(realizationHeading, "Realisasi Kegiatan");
    setAll(evaluationHeading, "Evaluasi dan Saran");
    const opening = sectionParagraphs(paragraphs, "Pendahuluan", realizationHeading);
    pushParagraphEdit(edits, opening[0], clean(data.opening, 7000) || clean(data.realization_summary, 7000) || "Pendahuluan kegiatan belum dilengkapi.");
    const realization = sectionParagraphs(paragraphs, realizationHeading, "Indikator Keberhasilan");
    const realizationInfo = [
      `Tanggal: ${eventDate} · Waktu: ${eventTime} · Tempat: ${place}`,
      `Target peserta: ${clean(data.attendance_target, 100)} · Peserta hadir: ${clean(data.attendance_count, 100)}`,
      clean(data.implementation, 6500) || clean(data.realization_summary, 6500) || "Realisasi kegiatan belum dicatat.",
    ].filter(Boolean).join("\n");
    pushParagraphEdit(edits, realization[0], realizationInfo);
    pushParagraphEdit(edits, realization[1], clean(data.realization_by_division, 3000));
    const outcome = sectionParagraphs(paragraphs, "Indikator Keberhasilan", evaluationHeading);
    pushParagraphEdit(edits, outcome[0], clean(data.outcome, 5000) || "Indikator dan capaian kegiatan belum dicatat.");
    const evaluation = sectionParagraphs(paragraphs, evaluationHeading, "Laporan Keuangan");
    pushParagraphEdit(edits, evaluation[0], [
      clean(data.obstacles, 1800) ? `Kendala dan solusi: ${clean(data.obstacles, 1800)}` : "",
      clean(data.evaluation, 3000) || "Evaluasi kegiatan belum dicatat.",
      clean(data.evaluation_by_division, 1800) ? `Evaluasi tiap seksi/divisi: ${clean(data.evaluation_by_division, 1800)}` : "",
      clean(data.recommendations, 1800) ? `Saran tindak lanjut: ${clean(data.recommendations, 1800)}` : "",
    ].filter(Boolean).join("\n"));
    const finance = data.finance && typeof data.finance === "object" ? data.finance : null;
    const incomeValue = !data.finance_enabled ? "Tidak disertakan" : finance?.confirmed_at ? formatMoney(finance.income_amount) : "Belum diverifikasi Bendahara";
    const expenseValue = !data.finance_enabled ? "Tidak disertakan" : finance?.confirmed_at ? formatMoney(finance.expense_amount) : "Belum diverifikasi Bendahara";
    const balanceValue = !data.finance_enabled ? "Tidak disertakan" : finance?.confirmed_at ? formatMoney(Number(finance.income_amount) - Number(finance.expense_amount)) : "Belum diverifikasi Bendahara";
    setAll("Pemasukan", `Pemasukan: ${incomeValue}`);
    setAll("Pengeluaran", `Pengeluaran: ${expenseValue}`);
    setAll("Akumulasi Dana", `Akumulasi Dana: ${balanceValue}`);
    const archiveLabel = "Arsip kegiatan (susunan acara, CV pemateri, MoU, absensi kegiatan, angket, sertifikat, dll.)";
    const archiveText = [
      clean(data.administration_summary, 1800),
      Array.isArray(data.attendance) && data.attendance.length ? `Rekap absensi: ${data.attendance.map((row: any) => `${clean(row.activity, 100)} (${clean(row.present, 30)}/${clean(row.eligible, 30)} hadir)`).join("; ")}` : "",
      finance?.akunpro_url ? `Referensi AkunPro: ${clean(finance.akunpro_url, 500)}` : "",
      finance?.realization_note ? `Catatan Bendahara: ${clean(finance.realization_note, 1000)}` : "",
    ].filter(Boolean).join("\n");
    if (archiveText) setAll(archiveLabel, `Arsip kegiatan: ${archiveText}`);
  }

  const approval = approvalTableEditRequests(document, { committee });
  const requests = [...approval.objectRequests];
  const styledBodyEdits = documentType === "proposal"
    ? edits.map((edit) => ({ ...edit, textStyle: PROGRAM_BODY_TEXT_STYLE }))
    : edits;
  const allEdits: Array<{ startIndex: number; endIndex: number; text: string; textStyle?: Record<string, unknown> }> = [...styledBodyEdits, ...approval.edits];
  for (const edit of allEdits.sort((a, b) => b.startIndex - a.startIndex)) {
    if (edit.endIndex > edit.startIndex) requests.push({ deleteContentRange: { range: { startIndex: edit.startIndex, endIndex: edit.endIndex } } });
    if (edit.text) {
      requests.push({ insertText: { location: { index: edit.startIndex }, text: edit.text } });
      if (edit.textStyle) requests.push({
        updateTextStyle: {
          range: { startIndex: edit.startIndex, endIndex: edit.startIndex + edit.text.length },
          textStyle: edit.textStyle,
          fields: textStyleFieldMask(edit.textStyle),
        },
      });
    }
  }
  if (requests.length) await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests } });
  if (documentType === "proposal") await removeEmptyProgramGoalRows(accessToken, documentId);

  if (documentType === "proposal") {
    await replaceTemplateMarkers(accessToken, documentId, {
      "{{PROGRAM_TITLE}}": title.toLocaleUpperCase("id-ID"),
      "{{PERIOD_LABEL}}": period || `${Number(year) - 1}-${year}`,
      "{{YEAR}}": year,
      "{{DIVISION_NAME}}": programDivisionLabel(data.program_division),
      "{{EVENT_DATE}}": eventDate,
      "{{EVENT_TIME}}": eventTime,
      "{{EVENT_PLACE}}": place,
      "{{APPROVAL_DATE}}": clean(data.approval_date_text, 100) || eventDate,
    });

    const rundown = data.rundown_enabled && Array.isArray(data.rundown) ? data.rundown : [];
    const scheduleRows = (rundown.length ? rundown : [{}]).map((row: any, index: number) => [
      String(index + 1),
      clean(row.activity, 300) || (data.rundown_enabled ? "Belum ditentukan" : "Bagian susunan acara tidak disertakan."),
      `${formatTemplateTime(row.start_time) || "—"}${row.end_time ? ` - ${formatTemplateTime(row.end_time)}` : ""}`,
      formatTemplateDuration(row.start_time, row.end_time),
      row.person ? `Penanggung jawab: ${clean(row.person, 120)}` : "",
    ]);
    const scheduleCount = Math.max(1, scheduleRows.length);
    const scheduleHeaders = ["No", "Kegiatan", "Waktu", "Durasi", "Keterangan"];
    const scheduleTable = findProgramTable((await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data, scheduleHeaders);
    if (!scheduleTable) throw new AppError(502, "Tabel rundown tidak ditemukan pada template proposal resmi.");
    const scheduleDoc = await resizeProgramTable(accessToken, documentId, scheduleHeaders, scheduleCount, 0);
    const sizedSchedule = findProgramTable(scheduleDoc, scheduleHeaders);
    if (sizedSchedule) {
      await applyTemplateEdits(accessToken, documentId, templateCellFillEdits(sizedSchedule, scheduleRows, templateTableHeaderIndex(sizedSchedule, scheduleHeaders)), PROGRAM_TABLE_TEXT_STYLE);
    }

    const budget = data.rab_enabled && Array.isArray(data.budget) ? data.budget : [];
    const income = budget.filter((row: any) => row.direction === "income");
    const expense = budget.filter((row: any) => row.direction !== "income");
    const amount = (row: any) => Math.round((Number(row.quantity) || 0) * (Number(row.unit_price) || 0));
    const quantity = (row: any) => `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(row.quantity) || 0)}${row.unit ? ` ${clean(row.unit, 40)}` : ""}`;
    const incomeValues = data.rab_enabled
      ? (income.length ? income : [{}]).map((row: any, index: number) => [`${index + 1}.`, clean(row.item_name, 240) || "Belum ditentukan", formatMoney(amount(row))])
      : [["", "Bagian RAB tidak disertakan.", "—"]];
    incomeValues.push([data.rab_enabled ? "Total Pemasukan" : "", "", data.rab_enabled ? formatMoney(income.reduce((sum: number, row: any) => sum + amount(row), 0)) : "—"]);
    const expenseValues = data.rab_enabled
      ? (expense.length ? expense : [{}]).map((row: any, index: number) => [String(index + 1), clean(row.item_name, 240) || "Belum ditentukan", formatMoney(Number(row.unit_price) || 0), quantity(row), formatMoney(amount(row))])
      : [["", "Bagian RAB tidak disertakan.", "", "", "—"]];
    expenseValues.push([data.rab_enabled ? "Total Pengeluaran" : "", "", "", "", data.rab_enabled ? formatMoney(expense.reduce((sum: number, row: any) => sum + amount(row), 0)) : "—"]);
    await fillProgramTable(accessToken, documentId, ["No", "Sumber Dana", "Jumlah Total"], Math.max(1, income.length), incomeValues, 1);
    await fillProgramTable(accessToken, documentId, ["No", "Nama", "Harga", "Pack", "Total"], Math.max(1, expense.length), expenseValues, 1);
    await fillProgramCommitteeSection(accessToken, documentId, committee, Boolean(data.committee_enabled));
  }

  await appendProgramPhotos(accessToken, documentId, Array.isArray(data.photos) ? data.photos : []);
  await normalizeProgramDocumentTypography(accessToken, documentId, documentType);
}

async function createSignerAssetUrl(actorId: string) {
  const path = `${actorId}/signature.png`.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/cssmora-signer-assets/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: "Bearer " + SERVICE_ROLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 1800 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.signedURL) throw new AppError(409, "Simpan tanda tangan PNG Anda terlebih dahulu pada fitur tanda tangan surat.");
  const signed = String(data.signedURL);
  return signed.startsWith("http") ? signed : SUPABASE_URL + signed;
}

function findGoogleDocMarkerRanges(document: any, marker: string) {
  const ranges: Array<{ startIndex: number; endIndex: number }> = [];
  const inspect = (content: any[]) => {
    for (const structural of content || []) {
      if (structural?.paragraph?.elements) {
        for (const element of structural.paragraph.elements) {
          const text = String(element?.textRun?.content || "");
          const offset = text.indexOf(marker);
          if (offset >= 0) {
            const startIndex = Number(element.startIndex) + offset;
            ranges.push({ startIndex, endIndex: startIndex + marker.length });
          }
        }
      }
      if (structural?.table?.tableRows) {
        for (const row of structural.table.tableRows) for (const cell of row.tableCells || []) inspect(cell.content || []);
      }
    }
  };
  inspect(templateDocumentBody(document).content || []);
  return ranges;
}

async function replaceTemplateMarkers(accessToken: string, documentId: string, replacements: Record<string, string>) {
  const document = (await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`)).data;
  const edits: Array<{ startIndex: number; endIndex: number; text: string }> = [];
  for (const [marker, value] of Object.entries(replacements)) {
    for (const range of findGoogleDocMarkerRanges(document, marker)) edits.push({ ...range, text: String(value || "") });
  }
  if (edits.length) await applyTemplateEdits(accessToken, documentId, edits);
}

function hasGoogleDocSignatureImage(document: any, stage: string) {
  const expectedLabel = stage === "sekretaris" ? "Sekretaris Umum CSSMoRA Universitas Airlangga" : "Ketua Umum CSSMoRA Universitas Airlangga";
  const containsImage = (content: any[]): boolean => (content || []).some((item: any) => {
    if (item?.paragraph?.elements?.some((element: any) => Boolean(element.inlineObjectElement))) return true;
    return (item?.table?.tableRows || []).some((row: any) => (row.tableCells || []).some((cell: any) => containsImage(cell.content || [])));
  });
  if (stage === "sekretaris") {
    for (const table of templateTables(document)) {
      for (const row of templateTableRows(table)) for (const cell of row.tableCells || []) {
        if (templateTextKey(templateTableCellText(cell)).includes(templateTextKey(expectedLabel)) && containsImage(cell.content || [])) return true;
      }
    }
    return false;
  }
  const content = templateDocumentBody(document).content || [];
  for (let index = 0; index < content.length; index++) {
    if (!content[index]?.paragraph || !templateTextKey(templateParagraphText(content[index].paragraph)).includes(templateTextKey(expectedLabel))) continue;
    if (containsImage(content.slice(index, index + 7))) return true;
  }
  return false;
}

async function exportProgramPdf(accessToken: string, documentId: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}/export?mimeType=application%2Fpdf`;
  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!response.ok) throw new AppError(response.status, "PDF dari Google Docs belum dapat dibuat.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 25 * 1024 * 1024) throw new AppError(502, "Ukuran PDF hasil ekspor tidak valid.");
  return bytes;
}

async function saveProgramPdf(accessToken: string, connection: any, document: any, bytes: Uint8Array) {
  const title = `${String(document.document_type || "DOKUMEN").toUpperCase()} - ${String(document.title || "Dokumen")} - ${String(document.period_label || "")}.pdf`.slice(0, 180);
  let file: any;
  const folderId = await findOrCreateProgramDocumentsFolder(accessToken, String(connection.drive_root_folder_id || ""));
  let fileId = String(document.google_pdf_id || "");
  if (!fileId) {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and appProperties has { key='cssmoraProgramDocumentId' and value='${String(document.id)}' } and appProperties has { key='cssmoraRevisionNumber' and value='${String(document.revision_number || 1)}' } and trashed=false`,
      fields: "files(id,name,webViewLink)",
      pageSize: "10",
    });
    const found = await googleJson(accessToken, "https://www.googleapis.com/drive/v3/files?" + query.toString());
    fileId = String(found.data?.files?.[0]?.id || "");
  }
  if (fileId) {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,webViewLink`, {
      method: "PATCH", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/pdf" }, body: bytes,
    });
    const raw = await response.text();
    file = raw ? JSON.parse(raw) : null;
    if (!response.ok || !file?.id) throw new AppError(response.status, "PDF Drive yang ada belum dapat diperbarui.");
  } else {
    const boundary = `cssmora_${crypto.randomUUID().replace(/-/g, "")}`;
    const encoder = new TextEncoder();
    const metadata = { name: title, mimeType: "application/pdf", parents: [folderId], appProperties: { cssmoraProgramDocumentId: String(document.id), cssmoraRevisionNumber: String(document.revision_number || 1) } };
    const prefix = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
    const suffix = encoder.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
    body.set(prefix, 0); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
      method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    const raw = await response.text();
    file = raw ? JSON.parse(raw) : null;
    if (!response.ok || !file?.id) throw new AppError(response.status, "PDF belum dapat disimpan di Drive.");
  }
  const id = String(file.id);
  return { google_pdf_id: id, google_pdf_url: String(file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`), title };
}

async function signProgramGoogleDoc(accessToken: string, connection: any, input: any, actor: any) {
  const documentId = String(input.document_id || "");
  const stage = String(input.stage || "");
  const expectedRole = stage === "sekretaris" ? "sekretaris" : stage === "ketua" ? "ketua" : "";
  if (!expectedRole || !actor.roles.includes(expectedRole) || String(input.actor_id || "") !== String(actor.user.id)) throw new AppError(403, "Akun ini tidak berwenang membubuhkan tanda tangan tahap tersebut.");
  const rows = (await serviceRequest("cssmora_program_documents?select=id,created_by,status,document_type,title,period_label,google_doc_id,google_pdf_id,optional_sections,revision_number&id=eq." + encodeURIComponent(String(input.program_document_id || "")))).data;
  const programDocument = Array.isArray(rows) ? rows[0] : null;
  if (!programDocument || String(programDocument.google_doc_id || "") !== documentId) throw new AppError(404, "Google Docs tidak terhubung dengan dokumen program kerja ini.");
  const requiredStatus = stage === "sekretaris" ? "secretary_review" : "chair_review";
  if (programDocument.status !== requiredStatus) throw new AppError(409, "Dokumen belum berada pada tahap tanda tangan akun ini.");
  if (String(programDocument.created_by) === String(actor.user.id)) throw new AppError(403, "PIC/pengaju tidak dapat menandatangani dokumennya sendiri.");
  if (stage === "sekretaris" && programDocument.document_type === "lpj" && programDocument.optional_sections?.finance) {
    const financeRows = (await serviceRequest("cssmora_program_document_finance?select=confirmed_by,confirmed_at,document_id&document_id=eq." + encodeURIComponent(programDocument.id))).data;
    const finance = Array.isArray(financeRows) ? financeRows[0] : null;
    if (!finance?.confirmed_by || !finance?.confirmed_at) throw new AppError(409, "Bendahara perlu memverifikasi bagian realisasi keuangan sebelum tanda tangan Sekretaris.");
    const generatedRows = (await serviceRequest("cssmora_program_documents?select=google_doc_generated_at&id=eq." + encodeURIComponent(programDocument.id))).data;
    const generatedAt = Array.isArray(generatedRows) ? new Date(generatedRows[0]?.google_doc_generated_at || 0).getTime() : 0;
    if (generatedAt < new Date(finance.confirmed_at).getTime()) throw new AppError(409, "Perbarui Google Docs setelah verifikasi Bendahara sebelum Sekretaris menandatangani.");
  }
  const document = await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
  const marker = stage === "sekretaris" ? "Menunggu tanda tangan Sekretaris" : "Menunggu tanda tangan Ketua";
  const ranges = findGoogleDocMarkerRanges(document.data, marker);
  if (ranges.length > 1) throw new AppError(409, "Penanda tanda tangan muncul lebih dari sekali pada Google Docs.");
  const signerMarker = stage === "sekretaris" ? "Nama Sekretaris Umum" : "Nama Ketua Umum";
  const signerRanges = findGoogleDocMarkerRanges(document.data, signerMarker);
  if (signerRanges.length > 1) throw new AppError(409, "Nama penanda tangan muncul lebih dari sekali pada Google Docs.");
  const requests: any[] = [];
  if (ranges.length === 1) {
    const uri = await createSignerAssetUrl(String(actor.user.id));
    requests.push({ range: ranges[0], insert: { insertInlineImage: { location: { index: ranges[0].startIndex }, uri, objectSize: { width: { magnitude: 112, unit: "PT" }, height: { magnitude: 38, unit: "PT" } } } } });
  } else if (!hasGoogleDocSignatureImage(document.data, stage)) {
    throw new AppError(409, "Penanda tanda tangan tidak ditemukan. Muat ulang Docs sebelum melanjutkan.");
  }
  if (signerRanges.length === 1) {
    const metadata = actor.user?.user_metadata && typeof actor.user.user_metadata === "object" ? actor.user.user_metadata : {};
    const displayName = clean(metadata.full_name || metadata.name || metadata.display_name || actor.email?.split("@")[0] || "", 180) || "Nama belum tersedia";
    requests.push({ range: signerRanges[0], insert: { insertText: { location: { index: signerRanges[0].startIndex }, text: displayName } } });
  }
  for (const item of requests.sort((a, b) => b.range.startIndex - a.range.startIndex)) {
    await googleJson(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: { requests: [
      { deleteContentRange: { range: item.range } },
      item.insert,
    ] } });
  }
  const pdfBytes = await exportProgramPdf(accessToken, documentId);
  const pdf = await saveProgramPdf(accessToken, connection, programDocument, pdfBytes);
  if (stage === "sekretaris") await shareProgramDocument(accessToken, documentId, [], ["ketua"]);
  const chairEmails = await activeRoleEmails(["ketua"]);
  await shareDriveFile(accessToken, pdf.google_pdf_id, [...chairEmails, String(actor.email || "")]);
  return pdf;
}


function sheetRangeTitle(title: string) {
  return "'" + title.replace(/'/g, "''") + "'";
}

function sheetCellParts(value: any, maxCellChars = 40000): any[] {
  let cell: any;
  if (value === null || value === undefined) cell = "";
  else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") cell = value;
  else cell = JSON.stringify(value) ?? "";
  if (typeof cell !== "string" || cell.length <= maxCellChars) return [cell];
  const parts: string[] = [];
  for (let offset = 0; offset < cell.length; offset += maxCellChars) {
    parts.push(cell.slice(offset, offset + maxCellChars));
  }
  return parts;
}

function rowsForBackupSheet(rows: any[]): any[][] {
  const records = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (!records.length) return [["Status", "Keterangan"], ["snapshot", "Tidak ada data pada saat backup."]];
  const columns = Array.from(new Set(records.flatMap((row) => Object.keys(row))));
  const values = records.map((row) => columns.map((column) => sheetCellParts(row[column])));
  const chunkCounts = columns.map((_, columnIndex) =>
    Math.max(1, ...values.map((row) => row[columnIndex].length))
  );
  const headers = columns.flatMap((column, columnIndex) => {
    const count = chunkCounts[columnIndex];
    return count === 1
      ? [column]
      : Array.from({ length: count }, (_, partIndex) => column + " (" + (partIndex + 1) + "/" + count + ")");
  });
  const body = values.map((row) =>
    row.flatMap((parts, columnIndex) => {
      const expanded = parts.slice(0, chunkCounts[columnIndex]);
      while (expanded.length < chunkCounts[columnIndex]) expanded.push("");
      return expanded;
    })
  );
  return [headers, ...body];
}

async function backupSpreadsheet(accessToken: string, connection: any, tables: Record<string, unknown>) {
  const tableNames = Object.keys(tables).sort();
  if (!tableNames.length) throw new AppError(500, "Tabel backup Google Sheets kosong.");
  const apiBase = "https://sheets.googleapis.com/v4/spreadsheets";
  const fields = new URLSearchParams({
    fields: "spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)",
  }).toString();
  let spreadsheetId = String(connection?.backup_spreadsheet_id || "");
  let spreadsheetInfo: any = null;

  if (spreadsheetId) {
    try {
      spreadsheetInfo = (await googleJson(
        accessToken,
        apiBase + "/" + encodeURIComponent(spreadsheetId) + "?" + fields,
      )).data;
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 404) throw error;
      await serviceRequest("cssmora_drive_connections?singleton=eq.true", {
        method: "PATCH",
        body: { backup_spreadsheet_id: null, updated_at: new Date().toISOString() },
      });
      connection.backup_spreadsheet_id = null;
      spreadsheetId = "";
    }
  }

  if (!spreadsheetId) {
    const createUrl = new URL(apiBase);
    createUrl.searchParams.set("fields", "spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)");
    spreadsheetInfo = (await googleJson(accessToken, createUrl.toString(), {
      method: "POST",
      body: {
        properties: { title: "CSSMoRA Data Backup" },
        sheets: tableNames.map((title) => ({ properties: { title } })),
      },
    })).data;
    spreadsheetId = String(spreadsheetInfo?.spreadsheetId || "");
    if (!spreadsheetId) throw new AppError(502, "Spreadsheet backup tidak berhasil dibuat.");
    await serviceRequest("cssmora_drive_connections?singleton=eq.true", {
      method: "PATCH",
      body: { backup_spreadsheet_id: spreadsheetId, updated_at: new Date().toISOString() },
    });
    connection.backup_spreadsheet_id = spreadsheetId;
  }

  const sheetRows = Array.isArray(spreadsheetInfo?.sheets) ? spreadsheetInfo.sheets : [];
  const existingTitles = new Set(sheetRows.map((sheet: any) => String(sheet?.properties?.title || "")));
  const missingTitles = tableNames.filter((title) => !existingTitles.has(title));
  if (missingTitles.length) {
    await googleJson(
      accessToken,
      apiBase + "/" + encodeURIComponent(spreadsheetId) + ":batchUpdate",
      {
        method: "POST",
        body: {
          requests: missingTitles.map((title) => ({ addSheet: { properties: { title } } })),
        },
      },
    );
    spreadsheetInfo = (await googleJson(
      accessToken,
      apiBase + "/" + encodeURIComponent(spreadsheetId) + "?" + fields,
    )).data;
  }

  const backupFolderId = String(connection?.drive_backups_folder_id || "");
  if (backupFolderId) {
    const driveFileUrl = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(spreadsheetId);
    const metadata = (await googleJson(accessToken, driveFileUrl + "?fields=parents")).data;
    const parents = Array.isArray(metadata?.parents) ? metadata.parents.map(String) : [];
    if (!parents.includes(backupFolderId)) {
      const updateUrl = new URL(driveFileUrl);
      updateUrl.searchParams.set("addParents", backupFolderId);
      updateUrl.searchParams.set("fields", "id,parents");
      if (parents.length) updateUrl.searchParams.set("removeParents", parents.join(","));
      await googleJson(accessToken, updateUrl.toString(), { method: "PATCH", body: {} });
    }
  }

  const ranges = tableNames.map((title) => sheetRangeTitle(title) + "!A:ZZZ");
  await googleJson(
    accessToken,
    apiBase + "/" + encodeURIComponent(spreadsheetId) + "/values:batchClear",
    { method: "POST", body: { ranges } },
  );

  const updates: Array<{ range: string; values: any[][] }> = [];
  let recordCount = 0;
  for (const title of tableNames) {
    const rows = Array.isArray(tables[title]) ? tables[title] as any[] : [];
    recordCount += rows.length;
    const matrix = rowsForBackupSheet(rows);
    for (let offset = 0; offset < matrix.length; offset += 10) {
      updates.push({
        range: sheetRangeTitle(title) + "!A" + (offset + 1),
        values: matrix.slice(offset, offset + 10),
      });
    }
  }

  let batch: Array<{ range: string; values: any[][] }> = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await googleJson(
      accessToken,
      apiBase + "/" + encodeURIComponent(spreadsheetId) + "/values:batchUpdate",
      {
        method: "POST",
        body: { valueInputOption: "RAW", data: batch },
      },
    );
    batch = [];
    batchBytes = 0;
  };
  const encoder = new TextEncoder();
  for (const update of updates) {
    const updateBytes = encoder.encode(JSON.stringify(update)).byteLength;
    if (batch.length && batchBytes + updateBytes > 900000) await flush();
    batch.push(update);
    batchBytes += updateBytes;
  }
  await flush();

  const spreadsheetUrl = String(
    spreadsheetInfo?.spreadsheetUrl || "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(spreadsheetId) + "/edit",
  );
  return { spreadsheetId, spreadsheetUrl, tableCount: tableNames.length, recordCount };
}

async function startOAuth(request: Request) {
  const actor = await requireUser(request);
  requireLeadership(actor.roles);
  const { clientId } = googleClientConfig();
  const expiredStates = new URLSearchParams({ expires_at: 'lt.' + new Date().toISOString() });
  await serviceRequest('cssmora_drive_oauth_states?' + expiredStates.toString(), { method: 'DELETE' }).catch(() => null);
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
    serviceRequest("cssmora_drive_backup_runs?select=status,started_at,finished_at,encrypted_size_bytes,sheet_status,sheet_updated_at,sheet_error_message&order=started_at.desc&limit=1"),
  ]);
  const latestBackup = Array.isArray(backupRows.data) && backupRows.data.length ? backupRows.data[0] : null;
  return {
    connected: Boolean(connection),
    accountEmail: connection?.account_email || null,
    folderUrl: connection?.drive_root_folder_id
      ? "https://drive.google.com/drive/folders/" + encodeURIComponent(connection.drive_root_folder_id)
      : null,
    spreadsheetUrl: connection?.backup_spreadsheet_id
      ? "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(connection.backup_spreadsheet_id) + "/edit"
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

async function runSync(retryFailed = false) {
  const connection = await currentConnection();
  if (!connection) return { processed: 0, succeeded: 0, failed: 0, skipped: "Drive belum tersambung." };
  const accessToken = await driveAccessToken(connection);
  if (retryFailed) {
    await serviceRequest('cssmora_drive_sync_queue?status=eq.failed', {
      method: 'PATCH',
      body: { status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() },
    });
  }
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
    body: { status: "running", sheet_status: "pending", started_at: startedAt },
  });
  const run = Array.isArray(created.data) ? created.data[0] : created.data;
  const runId = String(run?.id || "");
  if (!runId) throw new AppError(500, "Catatan backup tidak berhasil dibuat.");

  let encryptedBytes = 0;
  let driveFileId = "";
  let counts: Record<string, number> = {};
  let snapshot: any = null;
  try {
    snapshot = (await serviceRequest("rpc/export_cssmora_drive_backup", { method: "POST", body: {} })).data;
    if (!snapshot || snapshot.format !== "cssmora-data-backup-v1" || typeof snapshot.tables !== "object") {
      throw new AppError(500, "Data backup tidak memiliki format yang dikenali.");
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const encrypted = await encryptBackup(jsonBytes);
    encryptedBytes = encrypted.byteLength;
    for (const [table, rows] of Object.entries(snapshot.tables)) counts[table] = Array.isArray(rows) ? rows.length : 0;
    const fileName = "CSSMoRA-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json.gz.enc";
    driveFileId = await uploadDriveFile(accessToken, {
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
        encrypted_size_bytes: encryptedBytes,
        record_counts: counts,
        error_message: null,
        sheet_status: "pending",
        sheet_error_message: null,
      },
    });
  } catch (error) {
    await serviceRequest("cssmora_drive_backup_runs?id=eq." + encodeURIComponent(runId), {
      method: "PATCH",
      body: {
        status: "failed",
        finished_at: new Date().toISOString(),
        sheet_status: "not_started",
        sheet_error_message: null,
        error_message: error instanceof AppError ? "Backup gagal (HTTP " + error.status + ")." : "Backup gagal diproses.",
      },
    }).catch(() => null);
    throw new AppError(502, "Backup terenkripsi di Drive belum berhasil. Periksa konfigurasi dan status koneksi Drive.");
  }

  let sheetBackupStatus = "failed";
  let spreadsheetUrl = connection.backup_spreadsheet_id
    ? "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(connection.backup_spreadsheet_id) + "/edit"
    : null;
  let sheetErrorMessage = "Google Sheets gagal diperbarui.";
  try {
    const sheets = await backupSpreadsheet(accessToken, connection, snapshot.tables);
    spreadsheetUrl = sheets.spreadsheetUrl;
    sheetBackupStatus = "succeeded";
    sheetErrorMessage = "";
    await serviceRequest("cssmora_drive_backup_runs?id=eq." + encodeURIComponent(runId), {
      method: "PATCH",
      body: {
        sheet_status: "succeeded",
        sheet_updated_at: new Date().toISOString(),
        sheet_error_message: null,
      },
    });
  } catch (error) {
    sheetErrorMessage = error instanceof AppError
      ? "Google Sheets gagal diperbarui (HTTP " + error.status + ")."
      : "Google Sheets gagal diperbarui.";
    await serviceRequest("cssmora_drive_backup_runs?id=eq." + encodeURIComponent(runId), {
      method: "PATCH",
      body: {
        sheet_status: "failed",
        sheet_updated_at: new Date().toISOString(),
        sheet_error_message: sheetErrorMessage,
      },
    }).catch(() => null);
  }

  return {
    backupId: runId,
    encryptedBytes,
    recordCounts: counts,
    sheetBackupStatus,
    spreadsheetUrl,
    sheetError: sheetBackupStatus === "failed" ? sheetErrorMessage : null,
  };
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
    if (action === "sign_program_document") {
      const actor = await requireUser(request);
      const connection = await currentConnection();
      if (!connection?.refresh_token_ciphertext || !connection?.drive_root_folder_id) throw new AppError(409, "Drive CSSMoRA belum tersambung.");
      const accessToken = await driveAccessToken(connection);
      return jsonResponse(request, 200, { ok: true, action, ...(await signProgramGoogleDoc(accessToken, connection, body, actor)) });
    }
    if (action === "create_document") {
      const actor = await requireUser(request);
      if (!actor.roles.some(role => ["ketua", "wakil", "sekretaris", "bendahara", "bph_departemen"].includes(role))) {
        throw new AppError(403, "Pembuatan dokumen hanya tersedia untuk pengurus CSSMoRA.");
      }
      const programDocumentId = String(body.program_document_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(programDocumentId)) throw new AppError(400, "Dokumen program kerja tidak valid.");
      const documentRows = (await serviceRequest(
        "cssmora_program_documents?select=id,created_by,status,google_doc_id,document_type,optional_sections&id=eq." + encodeURIComponent(programDocumentId),
      )).data;
      const programDocument = Array.isArray(documentRows) ? documentRows[0] : null;
      if (!programDocument) throw new AppError(404, "Dokumen program kerja tidak ditemukan.");
      const authorCanBuild = programDocument.created_by === actor.user.id && ["draft", "revision"].includes(programDocument.status);
      const treasurerCanBuild = programDocument.status === "treasurer_review" && actor.roles.includes("bendahara");
      const financialPreSignCanBuild = programDocument.status === "secretary_review" && programDocument.document_type === "lpj" && programDocument.optional_sections?.finance && actor.roles.includes("bendahara");
      if (!authorCanBuild && !treasurerCanBuild && !financialPreSignCanBuild) throw new AppError(403, "Akun ini tidak dapat membuat dokumen pada tahap tersebut.");
      const requestedDocId = String(body.document_id || "").trim();
      if (requestedDocId && requestedDocId !== String(programDocument.google_doc_id || "")) {
        throw new AppError(403, "Google Docs tersebut tidak terhubung ke dokumen program kerja ini.");
      }
      const connection = await currentConnection();
      if (!connection?.refresh_token_ciphertext || !connection?.drive_root_folder_id) {
        throw new AppError(409, "Drive CSSMoRA belum tersambung. Hubungkan akun organisasi terlebih dahulu.");
      }
      const accessToken = await driveAccessToken(connection);
      const shareRoles = ["sekretaris", "ketua"];
      if (programDocument.document_type === "lpj" && programDocument.optional_sections?.finance) shareRoles.push("bendahara");
      const document = await createProgramGoogleDoc(accessToken, connection, { ...body, actor_email: actor.email, share_roles: shareRoles });
      return jsonResponse(request, 200, { ok: true, action, ...document });
    }
    if (action === "sync" || action === "backup") {
      const authorization = await authorizeWorker(request, action);
      const result = action === "sync" ? await runSync(authorization.source === "admin") : await runBackup();
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
