import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { ObjectExistsError, type ObjectStore } from './object-store';

export interface S3Settings {
  bucket: string;
  region: string;
  /** Only for S3-compatible services (R2, MinIO); leave empty for AWS. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO and some gateways need path-style addresses. */
  forcePathStyle?: boolean;
}

type AwsError = { name?: string; $metadata?: { httpStatusCode?: number } };
const status = (e: unknown) => (e as AwsError).$metadata?.httpStatusCode;
const missing = (e: unknown) => status(e) === 404 || (e as AwsError).name === 'NoSuchKey' || (e as AwsError).name === 'NotFound';

/**
 * One real bucket holds every logical bucket as a key prefix (`bom-files/<key>`), so a new logical bucket needs no provisioning
 * and the one set of credentials can be limited to this bucket alone.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings, client?: S3Client) {
    const config: S3ClientConfig = {
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      forcePathStyle: settings.forcePathStyle ?? false,
      ...(settings.endpoint && { endpoint: settings.endpoint }),
    };
    this.client = client ?? new S3Client(config);
  }

  private key(bucket: string, key: string): string {
    if (!bucket || bucket.includes('/') || key.startsWith('/') || key.split('/').includes('..')) throw new Error('invalid storage key');
    return `${bucket}/${key}`;
  }

  async put(bucket: string, key: string, body: Buffer, options: { contentType?: string; upsert?: boolean } = {}): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: this.key(bucket, key),
        Body: body,
        ContentType: options.contentType ?? 'application/octet-stream',
        // Without upsert the write must not replace an existing object (the same rule Supabase enforced).
        ...(!options.upsert && { IfNoneMatch: '*' }),
      }));
    } catch (error) {
      if (status(error) === 412) throw new ObjectExistsError(bucket, key);
      throw error;
    }
  }

  async get(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(bucket, key) }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async remove(bucket: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const out = await this.client.send(new DeleteObjectsCommand({
        Bucket: this.settings.bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((k) => ({ Key: this.key(bucket, k) })), Quiet: true },
      }));
      if (out.Errors?.length) throw new Error(`storage remove failed for ${out.Errors.length} object(s): ${out.Errors[0]?.Code ?? 'unknown'}`);
    }
  }

  async list(bucket: string, prefix: string): Promise<string[]> {
    const base = this.key(bucket, prefix.replace(/\/?$/, '/'));
    const names: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(new ListObjectsV2Command({ Bucket: this.settings.bucket, Prefix: base, Delimiter: '/', ContinuationToken: token }));
      for (const o of out.Contents ?? []) if (o.Key && o.Key !== base) names.push(o.Key.slice(base.length));
      for (const p of out.CommonPrefixes ?? []) if (p.Prefix) names.push(p.Prefix.slice(base.length).replace(/\/$/, ''));
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return names;
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: this.key(bucket, key) }));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  signedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(bucket, key) }), { expiresIn: ttlSeconds });
  }
}
