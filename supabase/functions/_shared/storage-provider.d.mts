export type StorageProviderId = "supabase" | "google-drive";

export type StorageReference = Readonly<{
  provider: "supabase";
  bucket: string;
  path: string;
}>;

export type StorageOperationResult = { ok: boolean; status: number; errorMessage: string };
export type StorageInfoResult = StorageOperationResult & {
  sizeBytes: number;
  contentType: string;
  uploadedAt: string | null;
};
export type StorageUrlResult = StorageOperationResult & { url: string };

export class SupabaseStorageProvider {
  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch });
  reference(bucket: string, path: string): StorageReference;
  upload(bucket: string, path: string, body: BodyInit, options: { contentType: string; upsert?: boolean }): Promise<StorageOperationResult>;
  info(bucket: string, path: string): Promise<StorageInfoResult>;
  createSignedUrl(bucket: string, path: string, expiresIn: number): Promise<StorageUrlResult>;
  createSignedUploadUrl(bucket: string, path: string): Promise<StorageUrlResult>;
  remove(bucket: string, path: string): Promise<StorageOperationResult>;
  removeMany(bucket: string, paths: string[]): Promise<StorageOperationResult>;
}

export function createStorageProvider(options: {
  provider?: StorageProviderId;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): SupabaseStorageProvider;
