const ALLOWED_BUCKETS = new Set([
  "attendance-proofs",
  "cssmora-prestasi-proofs",
  "cssmora-achievement-certificates",
  "cssmora-agenda-programs",
  "posters",
]);

function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function storageLocation(bucket, path) {
  const normalizedBucket = String(bucket ?? "").trim();
  if (!ALLOWED_BUCKETS.has(normalizedBucket)) throw new Error("Bucket penyimpanan tidak diizinkan.");
  const segments = String(path ?? "").split("/");
  if (!segments.length || segments.some(segment => !segment || segment === "." || segment === ".." || /[\\\0]/.test(segment))) {
    throw new Error("Jalur berkas tidak valid.");
  }
  return {
    bucket: normalizedBucket,
    path: segments.map(encodeSegment).join("/"),
    reference: Object.freeze({ provider: "supabase", bucket: normalizedBucket, path: String(path) }),
  };
}

async function responseJson(response) {
  return await response.json().catch(() => ({}));
}

function operationResult(response, body = {}) {
  return {
    ok: response.ok,
    status: response.status,
    errorMessage: String(body.message ?? body.error ?? ""),
  };
}

export class SupabaseStorageProvider {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
    const parsedBase = new URL(String(baseUrl ?? ""));
    if (!/^https?:$/.test(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
      throw new Error("URL Supabase untuk Storage tidak valid.");
    }
    if (!String(apiKey ?? "").trim()) throw new Error("Kredensial Storage belum tersedia.");
    if (typeof fetchImpl !== "function") throw new Error("Transport Storage tidak tersedia.");
    this.baseUrl = parsedBase.toString().replace(/\/$/, "");
    this.apiKey = String(apiKey);
    this.fetchImpl = fetchImpl;
  }

  reference(bucket, path) {
    return storageLocation(bucket, path).reference;
  }

  objectUrl(operation, bucket, path) {
    const location = storageLocation(bucket, path);
    const prefix = `${this.baseUrl}/storage/v1/object`;
    const operationPrefix = operation ? `/${operation}` : "";
    return `${prefix}${operationPrefix}/${encodeSegment(location.bucket)}/${location.path}`;
  }

  bucketUrl(bucket) {
    const location = storageLocation(bucket, "_");
    return `${this.baseUrl}/storage/v1/object/${encodeSegment(location.bucket)}`;
  }

  headers(extra = {}) {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  async upload(bucket, path, body, { contentType, upsert = false } = {}) {
    if (!contentType) throw new Error("Jenis berkas wajib dicantumkan.");
    const response = await this.fetchImpl(this.objectUrl("", bucket, path), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": String(Boolean(upsert)) }),
      body,
    });
    return operationResult(response, await responseJson(response));
  }

  async info(bucket, path) {
    const response = await this.fetchImpl(this.objectUrl("info", bucket, path), { headers: this.headers() });
    const body = await responseJson(response);
    return {
      ...operationResult(response, body),
      sizeBytes: Number(body.size ?? body.metadata?.size ?? 0),
      contentType: String(body.contentType ?? body.content_type ?? body.metadata?.mimetype ?? "").toLowerCase(),
      uploadedAt: body.createdAt ?? body.created_at ?? null,
    };
  }

  async createSignedUrl(bucket, path, expiresIn) {
    const seconds = Number(expiresIn);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60 * 60 * 24 * 7) {
      throw new Error("Masa berlaku tautan Storage tidak valid.");
    }
    const response = await this.fetchImpl(this.objectUrl("sign", bucket, path), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: seconds }),
    });
    const body = await responseJson(response);
    const rawUrl = String(body.signedURL ?? body.signedUrl ?? "");
    const url = rawUrl
      ? /^https?:\/\//i.test(rawUrl)
        ? rawUrl
        : rawUrl.startsWith("/storage/v1/")
          ? this.baseUrl + rawUrl
          : this.baseUrl + "/storage/v1" + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl)
      : "";
    return { ...operationResult(response, body), url };
  }

  async createSignedUploadUrl(bucket, path) {
    const response = await this.fetchImpl(this.objectUrl("upload/sign", bucket, path), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: "{}",
    });
    const body = await responseJson(response);
    const rawUrl = String(body.url ?? body.signedURL ?? body.signedUrl ?? "");
    const url = rawUrl
      ? /^https?:\/\//i.test(rawUrl)
        ? rawUrl
        : rawUrl.startsWith("/storage/v1/")
          ? this.baseUrl + rawUrl
          : this.baseUrl + "/storage/v1" + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl)
      : "";
    return { ...operationResult(response, body), url };
  }

  async remove(bucket, path) {
    const response = await this.fetchImpl(this.objectUrl("", bucket, path), {
      method: "DELETE",
      headers: this.headers(),
    });
    return operationResult(response, await responseJson(response));
  }

  async removeMany(bucket, paths) {
    if (!Array.isArray(paths) || paths.some(path => !path)) throw new Error("Daftar jalur berkas tidak valid.");
    const safePaths = paths.map(path => {
      const location = storageLocation(bucket, path);
      return location.path.split("/").map(decodeURIComponent).join("/");
    });
    const response = await this.fetchImpl(this.bucketUrl(bucket), {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: safePaths }),
    });
    return operationResult(response, await responseJson(response));
  }
}

export function createStorageProvider({ provider = "supabase", ...options }) {
  if (provider !== "supabase") throw new Error(`Provider Storage "${provider}" belum dikonfigurasi.`);
  return new SupabaseStorageProvider(options);
}
