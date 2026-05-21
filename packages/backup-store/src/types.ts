import type { Readable } from 'node:stream';

export interface BackupRef {
  key: string;
  size: number;
  createdAt: Date;
}

export interface PutResult {
  key: string;
  size: number;
}

/**
 * Pluggable backup destination. `LocalDiskStore` writes to a host directory;
 * `S3Store` writes to any S3-compatible service. Per spec FR-025 + research §7.
 */
export interface BackupStore {
  /** Stream a backup artifact into the store. Returns the storage key + size. */
  put(ref: string, stream: Readable, contentType?: string): Promise<PutResult>;
  /** Stream a backup artifact out by storage key. */
  get(key: string): Promise<Readable>;
  /** Hard-delete the artifact at `key`. */
  delete(key: string): Promise<void>;
  /** List artifacts for an instance, newest first. */
  list(ref: string): Promise<BackupRef[]>;
  /** Optionally produce a signed URL (S3 impl) or null (local impl uses our own download endpoint). */
  signedUrl?(key: string, expiresInSec: number): Promise<string>;
}
