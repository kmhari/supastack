/**
 * SEC-004 — backups are encrypted at rest on S3-compatible stores.
 * Asserts every upload carries ServerSideEncryption: AES256 (SSE-S3), so a
 * bucket read never yields plaintext pg_dump data.
 */
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';

let capturedParams: Record<string, unknown> | undefined;

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    constructor(opts: { params: Record<string, unknown> }) {
      capturedParams = opts.params;
    }
    async done() {
      return {};
    }
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send() {
      return { ContentRange: 'bytes 0-0/123' };
    }
  },
  GetObjectCommand: class {},
  DeleteObjectCommand: class {},
  ListObjectsV2Command: class {},
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed' }));

const { S3Store } = await import('../src/s3.js');

describe('S3Store — SEC-004 at-rest encryption', () => {
  it('uploads with ServerSideEncryption AES256', async () => {
    const store = new S3Store({ bucket: 'b', region: 'r', accessKeyId: 'k', secretAccessKey: 's' });
    await store.put('ref1', Readable.from([Buffer.from('pg_dump output')]));
    expect(capturedParams?.ServerSideEncryption).toBe('AES256');
  });
});
