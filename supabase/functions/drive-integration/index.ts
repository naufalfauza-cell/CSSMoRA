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
  if (title.length < 3 || !blocks.length) throw new AppError(400, "Judul dan isi dokumen wajib tersedia.");
  const folderId = await findOrCreateProgramDocumentsFolder(accessToken, String(connection.drive_root_folder_id || ""));
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
  return { documentId, webViewLink, title };
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
    if (action === "create_document") {
      const actor = await requireUser(request);
      if (!actor.roles.some(role => ["ketua", "wakil", "sekretaris", "bendahara", "bph_departemen"].includes(role))) {
        throw new AppError(403, "Pembuatan dokumen hanya tersedia untuk pengurus CSSMoRA.");
      }
      const programDocumentId = String(body.program_document_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(programDocumentId)) throw new AppError(400, "Dokumen program kerja tidak valid.");
      const documentRows = (await serviceRequest(
        "cssmora_program_documents?select=id,created_by,status,google_doc_id&id=eq." + encodeURIComponent(programDocumentId),
      )).data;
      const programDocument = Array.isArray(documentRows) ? documentRows[0] : null;
      if (!programDocument) throw new AppError(404, "Dokumen program kerja tidak ditemukan.");
      const leadership = actor.roles.includes("ketua") || actor.roles.includes("wakil");
      const authorCanBuild = programDocument.created_by === actor.user.id && ["draft", "revision"].includes(programDocument.status);
      const treasurerCanBuild = programDocument.status === "treasurer_review" && actor.roles.includes("bendahara");
      if (!leadership && !authorCanBuild && !treasurerCanBuild) throw new AppError(403, "Akun ini tidak dapat membuat dokumen pada tahap tersebut.");
      const requestedDocId = String(body.document_id || "").trim();
      if (requestedDocId && requestedDocId !== String(programDocument.google_doc_id || "")) {
        throw new AppError(403, "Google Docs tersebut tidak terhubung ke dokumen program kerja ini.");
      }
      const connection = await currentConnection();
      if (!connection?.refresh_token_ciphertext || !connection?.drive_root_folder_id) {
        throw new AppError(409, "Drive CSSMoRA belum tersambung. Hubungkan akun organisasi terlebih dahulu.");
      }
      const accessToken = await driveAccessToken(connection);
      const document = await createProgramGoogleDoc(accessToken, connection, body);
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
