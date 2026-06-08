import { describe, expect, it } from 'vitest';
import {
  backfillBucketName,
  normalizeDeleteObjectsBody,
  normalizeObjectListBody,
  rewriteStoragePath,
} from '../../src/routes/platform-proxy.js';

// ─── rewriteStoragePath ───────────────────────────────────────────────────────

describe('rewriteStoragePath', () => {
  it('rewrites list path: buckets/:b/objects/list → object/list/:b', () => {
    expect(rewriteStoragePath('buckets/test/objects/list')).toBe('object/list/test');
    expect(rewriteStoragePath('buckets/my-bucket/objects/list')).toBe('object/list/my-bucket');
  });

  it('rewrites object path: buckets/:b/objects/:key → object/:b/:key', () => {
    expect(rewriteStoragePath('buckets/test/objects/file.jpg')).toBe('object/test/file.jpg');
    expect(rewriteStoragePath('buckets/test/objects/dir/sub/img.png')).toBe(
      'object/test/dir/sub/img.png',
    );
  });

  it('rewrites upload root: buckets/:b/objects → object/:b', () => {
    expect(rewriteStoragePath('buckets/test/objects')).toBe('object/test');
  });

  it('rewrites bucket CRUD: buckets → bucket', () => {
    expect(rewriteStoragePath('buckets')).toBe('bucket');
    expect(rewriteStoragePath('buckets/test')).toBe('bucket/test');
  });

  it('does NOT match list if suffix has more segments after list', () => {
    // buckets/b/objects/list/extra is not a list call — falls to object match
    const result = rewriteStoragePath('buckets/b/objects/list/extra');
    expect(result).toBe('object/b/list/extra');
  });
});

// ─── normalizeObjectListBody ──────────────────────────────────────────────────

describe('normalizeObjectListBody', () => {
  const listSuffix = 'buckets/test/objects/list';

  it('normalizes Studio IS_PLATFORM list body to storage-api shape', () => {
    const req = {
      method: 'POST',
      params: { '*': listSuffix },
      body: {
        path: 'my-folder/',
        options: { limit: 50, offset: 10, search: 'img', sortBy: { column: 'size', order: 'desc' } },
      },
    };
    normalizeObjectListBody(req);
    expect(req.body).toEqual({
      prefix: 'my-folder/',
      limit: 50,
      offset: 10,
      search: 'img',
      sortBy: { column: 'size', order: 'desc' },
    });
  });

  it('fills defaults when options are absent', () => {
    const req = {
      method: 'POST',
      params: { '*': listSuffix },
      body: { path: '' },
    };
    normalizeObjectListBody(req);
    expect(req.body).toEqual({
      prefix: '',
      limit: 100,
      offset: 0,
      search: '',
      sortBy: { column: 'name', order: 'asc' },
    });
  });

  it('leaves body untouched when already in prefix form', () => {
    const original = { prefix: 'dir/', limit: 20, offset: 0, search: '' };
    const req = { method: 'POST', params: { '*': listSuffix }, body: { ...original } };
    normalizeObjectListBody(req);
    expect(req.body).toEqual(original);
  });

  it('no-ops for non-POST methods', () => {
    const req = {
      method: 'GET',
      params: { '*': listSuffix },
      body: { path: 'folder/' },
    };
    normalizeObjectListBody(req);
    expect(req.body).toEqual({ path: 'folder/' });
  });

  it('no-ops for non-list suffixes', () => {
    const req = {
      method: 'POST',
      params: { '*': 'buckets/test/objects/file.jpg' },
      body: { anything: true },
    };
    normalizeObjectListBody(req);
    expect(req.body).toEqual({ anything: true });
  });

  it('no-ops when body is null', () => {
    const req = { method: 'POST', params: { '*': listSuffix }, body: null };
    normalizeObjectListBody(req);
    expect(req.body).toBeNull();
  });
});

// ─── normalizeDeleteObjectsBody ──────────────────────────────────────────────

describe('normalizeDeleteObjectsBody', () => {
  const deleteSuffix = 'buckets/test/objects';

  it('translates paths → prefixes (platform→storage-api shape)', () => {
    const req = {
      method: 'DELETE',
      params: { '*': deleteSuffix },
      body: { paths: ['/.emptyFolderPlaceholder', 'file.jpg'] },
    };
    normalizeDeleteObjectsBody(req);
    expect(req.body).toEqual({ prefixes: ['/.emptyFolderPlaceholder', 'file.jpg'] });
  });

  it('leaves body untouched when already using prefixes', () => {
    const original = { prefixes: ['file.jpg'] };
    const req = { method: 'DELETE', params: { '*': deleteSuffix }, body: { ...original } };
    normalizeDeleteObjectsBody(req);
    expect(req.body).toEqual(original);
  });

  it('no-ops for non-DELETE methods', () => {
    const req = { method: 'POST', params: { '*': deleteSuffix }, body: { paths: ['a'] } };
    normalizeDeleteObjectsBody(req);
    expect(req.body).toEqual({ paths: ['a'] });
  });

  it('no-ops for paths with trailing file (single object delete)', () => {
    const req = {
      method: 'DELETE',
      params: { '*': 'buckets/test/objects/file.jpg' },
      body: { paths: ['a'] },
    };
    normalizeDeleteObjectsBody(req);
    expect(req.body).toEqual({ paths: ['a'] });
  });

  it('no-ops when body is null', () => {
    const req = { method: 'DELETE', params: { '*': deleteSuffix }, body: null };
    normalizeDeleteObjectsBody(req);
    expect(req.body).toBeNull();
  });
});

// ─── backfillBucketName ───────────────────────────────────────────────────────

describe('backfillBucketName', () => {
  it('sets name from id when name is absent (Studio create-bucket shape)', () => {
    const req = {
      method: 'POST',
      params: { '*': 'buckets' },
      body: { id: 'my-bucket', type: 'STANDARD', public: true },
    };
    backfillBucketName(req);
    expect((req.body as Record<string, unknown>).name).toBe('my-bucket');
  });

  it('does not override an explicit name', () => {
    const req = {
      method: 'POST',
      params: { '*': 'buckets' },
      body: { id: 'an-id', name: 'explicit', public: false },
    };
    backfillBucketName(req);
    expect((req.body as Record<string, unknown>).name).toBe('explicit');
  });

  it('does not backfill on non-POST methods', () => {
    const req = {
      method: 'GET',
      params: { '*': 'buckets' },
      body: { id: 'x' },
    };
    backfillBucketName(req);
    expect((req.body as Record<string, unknown>).name).toBeUndefined();
  });

  it('does not backfill on non-bucket-root paths', () => {
    const req = {
      method: 'POST',
      params: { '*': 'buckets/test/objects' },
      body: { id: 'x' },
    };
    backfillBucketName(req);
    expect((req.body as Record<string, unknown>).name).toBeUndefined();
  });

  it('sets name from id when name is null', () => {
    const req = {
      method: 'POST',
      params: { '*': 'buckets' },
      body: { id: 'my-bucket', name: null },
    };
    backfillBucketName(req);
    expect((req.body as Record<string, unknown>).name).toBe('my-bucket');
  });
});
