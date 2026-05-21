import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalDiskStore } from '../src/local-disk.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'selfbase-backups-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const stream = (data: string): Readable => Readable.from([Buffer.from(data)]);

describe('LocalDiskStore', () => {
  test('round-trips a small payload', async () => {
    const store = new LocalDiskStore(root);
    const put = await store.put('inst1', stream('hello world'));
    expect(put.size).toBe(11);
    expect(put.key.startsWith('inst1/')).toBe(true);

    const chunks: Buffer[] = [];
    const rs = await store.get(put.key);
    for await (const chunk of rs) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello world');
  });

  test('lists newest-first', async () => {
    const store = new LocalDiskStore(root);
    await store.put('inst2', stream('one'));
    await new Promise((r) => setTimeout(r, 10));
    await store.put('inst2', stream('two'));
    const refs = await store.list('inst2');
    expect(refs).toHaveLength(2);
    expect(refs[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(refs[1]!.createdAt.getTime());
  });

  test('list of unknown ref returns []', async () => {
    const store = new LocalDiskStore(root);
    expect(await store.list('nonexistent')).toEqual([]);
  });

  test('delete removes the file', async () => {
    const store = new LocalDiskStore(root);
    const { key } = await store.put('inst3', stream('bye'));
    await store.delete(key);
    expect(await store.list('inst3')).toEqual([]);
  });

  test('rejects directory traversal in keys', async () => {
    const store = new LocalDiskStore(root);
    await expect(store.get('../etc/passwd')).rejects.toThrow(/invalid backup key/);
    await expect(store.delete('../etc/passwd')).rejects.toThrow(/invalid backup key/);
  });

  test('rejects absolute keys', async () => {
    const store = new LocalDiskStore(root);
    await expect(store.get('/etc/passwd')).rejects.toThrow(/invalid backup key/);
  });
});
