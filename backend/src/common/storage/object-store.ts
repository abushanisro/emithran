/**
 * Where uploaded files live. One small interface so the services do not know which S3-compatible bucket holds the bytes
 *  (S3, Cloudflare R2, MinIO). A `bucket` here is a logical name (`bom-files`); keys are the same paths the
 * database already stores, so moving the bytes between backends never touches a row.
 */
export interface ObjectStore {
  /** Fails with ObjectExistsError when `upsert` is false and the key is taken. */
  put(bucket: string, key: string, body: Buffer, options?: { contentType?: string; upsert?: boolean }): Promise<void>;
  /** The bytes, or null when nothing is stored at the key. Any other failure throws. */
  get(bucket: string, key: string): Promise<Buffer | null>;
  /** Missing keys are not an error (deleting twice is fine). */
  remove(bucket: string, keys: string[]): Promise<void>;
  /** The names directly under `prefix` (not recursive). */
  list(bucket: string, prefix: string): Promise<string[]>;
  exists(bucket: string, key: string): Promise<boolean>;
  /** A time-limited download URL that needs no credentials. */
  signedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string>;
}

export const OBJECT_STORE = Symbol('OBJECT_STORE');

export class ObjectExistsError extends Error {
  constructor(bucket: string, key: string) {
    super(`${bucket}/${key} already exists`);
  }
}
