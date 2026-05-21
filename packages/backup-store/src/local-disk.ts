import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { BackupStore, BackupRef, PutResult } from './types.js';

export class LocalDiskStore implements BackupStore {
  constructor(private readonly root: string) {}

  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  async put(ref: string, stream: Readable): Promise<PutResult> {
    const dir = path.join(this.root, ref);
    await fs.mkdir(dir, { recursive: true });
    const key = path.join(ref, `${this.timestamp()}.dump`);
    const abs = path.join(this.root, key);
    const out = createWriteStream(abs, { mode: 0o600 });
    await pipeline(stream, out);
    const stat = await fs.stat(abs);
    return { key, size: stat.size };
  }

  async get(key: string): Promise<Readable> {
    this.assertKeyShape(key);
    return createReadStream(path.join(this.root, key));
  }

  async delete(key: string): Promise<void> {
    this.assertKeyShape(key);
    await fs.rm(path.join(this.root, key), { force: true });
  }

  async list(ref: string): Promise<BackupRef[]> {
    const dir = path.join(this.root, ref);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: BackupRef[] = [];
    for (const name of names) {
      if (!name.endsWith('.dump')) continue;
      const abs = path.join(dir, name);
      const stat = await fs.stat(abs);
      out.push({ key: path.join(ref, name), size: stat.size, createdAt: stat.mtime });
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Defense in depth: never let a caller traverse out of the root. */
  private assertKeyShape(key: string): void {
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new Error(`invalid backup key shape: ${key}`);
    }
  }
}
