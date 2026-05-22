import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { BackupStore, BackupRef, PutResult } from './types.js';

export interface S3StoreConfig {
  /** Endpoint URL (omit for AWS S3; set for MinIO/R2/B2/etc.). */
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing — required by MinIO, optional elsewhere. */
  forcePathStyle?: boolean;
}

export class S3Store implements BackupStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: S3StoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
    });
  }

  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  async put(ref: string, stream: Readable): Promise<PutResult> {
    const key = `${ref}/${this.timestamp()}.dump`;
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: 'application/octet-stream',
      },
    });
    await upload.done();

    // Re-read size — the upload result doesn't give a reliable ContentLength.
    const head = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: 'bytes=0-0' }),
    );
    // S3 returns ContentRange like "bytes 0-0/12345"
    const range = head.ContentRange;
    const size = range ? Number(range.split('/').pop()) : (head.ContentLength ?? 0);
    return { key, size };
  }

  async get(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(ref: string): Promise<BackupRef[]> {
    const refs: BackupRef[] = [];
    let token: string | undefined;
    do {
      const out: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${ref}/`,
          ContinuationToken: token,
        }),
      );
      for (const obj of out.Contents ?? []) {
        if (!obj.Key || !obj.LastModified) continue;
        refs.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          createdAt: obj.LastModified,
        });
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return refs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async signedUrl(key: string, expiresInSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }
}
