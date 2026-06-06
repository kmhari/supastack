/**
 * Per-instance edge function deploy hot path.
 *
 * Spec: specs/003-supabase-cli-compat-p0/research.md R-002, R-003
 *       specs/003-supabase-cli-compat-p0/contracts/functions-deploy.md
 *
 * Supports both wire formats:
 *   - --use-api (multipart/form-data): metadata JSON + N raw file parts
 *   - default eszip path (application/vnd.denoland.eszip): raw eszip bytes
 *
 * Both branches converge on `commitDeploy` which:
 *   - validates the slug
 *   - snapshots prior version to .deploy-rollback/<slug>-<ts>/
 *   - atomically renames the staging tree into the per-instance volume
 *   - writes a meta.json sidecar consumed by the runtime's main router
 *   - upserts project_functions + function_deploys (audit) inside a tx
 *   - calls dockerControl.restart('supastack-<ref>-functions-1')
 *   - on restart failure: restores the snapshot and rolls back the row
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const brotliDecompress = promisify(zlib.brotliDecompress);
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import type { DeployFunctionResponse } from '@supastack/shared';
import {
  FunctionDeployMetadataSchema,
  EszipDeployQuerySchema,
  EszipUpdateQuerySchema,
} from '@supastack/shared';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import { functionRowToFunction } from './mgmt-api-mapping.js';
import { getDockerControl } from './docker-control-adapter.js';
import { instanceFunctionsDir, slugDir } from './function-store.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ESZIP_MAGIC = Buffer.from('ESZIP', 'utf8');
const EZBR_MAGIC = Buffer.from('EZBR', 'utf8');
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Per-instance staging root. We deliberately do NOT use /tmp because /tmp
 * lives on the api container's overlay filesystem while /var/selfbase/
 * instances/<ref>/ is a bind-mount to the host — Linux's rename(2) returns
 * EXDEV across filesystems and atomic move becomes impossible. Staging
 * inside the per-instance volume guarantees same-FS rename and gives us
 * free cleanup when the instance is deleted.
 */
function stagingRootFor(ref: string): string {
  return path.join(instanceFunctionsDir(ref), '.staging');
}

export type DeployMode = 'create' | 'update';

// ─── Pure helpers (unit-tested in T003a) ────────────────────────────────────

export function isEszipMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ESZIP_MAGIC.byteLength) return false;
  for (let i = 0; i < ESZIP_MAGIC.byteLength; i++) {
    if (bytes[i] !== ESZIP_MAGIC[i]) return false;
  }
  return true;
}

/**
 * True iff `bytes` starts with the 4-byte ASCII magic `EZBR`. The CLI's
 * default deploy path (`pkg/function/bundle.go:Compress`) wraps the eszip
 * with this header + Brotli compression to shave upload size. Decompressing
 * yields the runtime-loadable ESZIP2.x bytes.
 */
export function isEzbrMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < EZBR_MAGIC.byteLength) return false;
  for (let i = 0; i < EZBR_MAGIC.byteLength; i++) {
    if (bytes[i] !== EZBR_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Decompress an `EZBR`-prefixed body to the underlying eszip bytes. Strips
 * the 4-byte magic + Brotli-decompresses the remainder. The result must
 * start with `ESZIP` or we treat the upload as malformed.
 */
async function decompressEzbrToEszip(body: Buffer): Promise<Buffer> {
  if (!isEzbrMagic(body)) {
    throw new Error('decompressEzbrToEszip: body does not start with EZBR magic');
  }
  const brotliPayload = body.subarray(EZBR_MAGIC.byteLength);
  const decompressed = await brotliDecompress(brotliPayload);
  return Buffer.from(decompressed);
}

function assertSlug(slug: string): void {
  if (!SLUG_REGEX.test(slug)) {
    throw new ManagementApiError(
      422,
      `Function slug '${slug}' is invalid. Must match ${SLUG_REGEX}.`,
      'validation',
      { field: 'slug', value: slug },
    );
  }
}

/**
 * Strip the `supabase/functions/<slug>/` prefix from an uploaded file's
 * relative path, leaving the path-inside-the-function-dir. Rejects path-
 * escape attempts (`..`, absolute paths).
 *
 *   supabase/functions/hello/index.ts  →  index.ts
 *   supabase/functions/hello/lib/x.ts  →  lib/x.ts
 *   supabase/functions/_shared/x.ts    →  _shared/x.ts   (cross-fn share)
 */
function rebaseFilename(filename: string, slug: string): string {
  const normalized = filename.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..')) {
    throw new ManagementApiError(
      422,
      `Filename '${filename}' escapes the working tree`,
      'validation',
      { filename },
    );
  }
  const prefix = `supabase/functions/${slug}/`;
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  // Sibling shared dirs like supabase/functions/_shared/* are written
  // relative to the per-instance functions volume — preserve the segment
  // after `supabase/functions/`.
  const fallback = 'supabase/functions/';
  if (normalized.startsWith(fallback)) return normalized.slice(fallback.length);
  // Anything else lands under the slug dir as-is.
  return normalized;
}

// ─── Multipart staging ──────────────────────────────────────────────────────

interface StagedDeploy {
  stagingDir: string;
  sourcePath: string; // relative — "index.ts" or "bundle.eszip"
  entrypointPath: string | null;
  importMapPath: string | null;
  verifyJwt: boolean;
  sizeBytes: number;
  sha256: string;
  meta: Record<string, unknown>; // contents of the sidecar meta.json
}

async function stageMultipart(
  ref: string,
  slug: string,
  parts: AsyncIterableIterator<MultipartFile | MultipartValue>,
): Promise<StagedDeploy> {
  const stagingDir = path.join(stagingRootFor(ref), randomUUID());
  await mkdir(stagingDir, { recursive: true });

  let metadataRaw: string | null = null;
  const fileEntries: Array<{ rel: string; bytes: Buffer }> = [];

  for await (const part of parts) {
    if ((part as MultipartFile).file && part.type === 'file') {
      const filePart = part as MultipartFile;
      const rel = rebaseFilename(filePart.filename ?? '', slug);
      // Stream into memory — 50 MB cap is enforced by fastify-multipart.
      const chunks: Buffer[] = [];
      for await (const chunk of filePart.file) {
        chunks.push(chunk as Buffer);
      }
      fileEntries.push({ rel, bytes: Buffer.concat(chunks) });
    } else if (part.fieldname === 'metadata') {
      // Multipart non-file part — value is a string.
      const v = (part as MultipartValue).value;
      metadataRaw = typeof v === 'string' ? v : Buffer.from(v as ArrayBuffer).toString('utf8');
    }
  }

  if (!metadataRaw) {
    throw new ManagementApiError(400, 'multipart upload missing `metadata` part', 'bad_request');
  }
  if (fileEntries.length === 0) {
    throw new ManagementApiError(400, 'multipart upload has no `file` parts', 'bad_request');
  }

  const meta = FunctionDeployMetadataSchema.parse(JSON.parse(metadataRaw));
  const entrypointRel = rebaseFilename(meta.entrypoint_path, slug);

  // Verify entrypoint_path matches one of the uploaded files.
  const entryExists = fileEntries.some((e) => e.rel === entrypointRel);
  if (!entryExists) {
    throw new ManagementApiError(
      422,
      `entrypoint_path '${meta.entrypoint_path}' does not match any uploaded file`,
      'validation',
      { entrypoint_path: meta.entrypoint_path },
    );
  }

  // Write all files into the staging dir.
  let totalBytes = 0;
  for (const { rel, bytes } of fileEntries) {
    const dst = path.join(stagingDir, rel);
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(dst, bytes);
    totalBytes += bytes.byteLength;
  }

  // ezbr_sha256: stable SHA-256 of sorted (rel, bytes) pairs.
  const sorted = [...fileEntries].sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = createHash('sha256');
  for (const { rel, bytes } of sorted) {
    hash.update(rel);
    hash.update(bytes);
  }
  const sha = hash.digest('hex');

  // Write the sidecar meta.json the runtime's main router will read.
  const metaJson = {
    source_path: entrypointRel, // raw source path inside the slug dir
    entrypoint_path: meta.entrypoint_path,
    import_map_path: meta.import_map_path ?? null,
    verify_jwt: meta.verify_jwt ?? true,
    ezbr_sha256: sha,
    deployed_at: Date.now(),
  };
  await writeFile(path.join(stagingDir, 'meta.json'), JSON.stringify(metaJson, null, 2));

  return {
    stagingDir,
    sourcePath: entrypointRel,
    entrypointPath: meta.entrypoint_path,
    importMapPath: meta.import_map_path ?? null,
    verifyJwt: meta.verify_jwt ?? true,
    sizeBytes: totalBytes,
    sha256: sha,
    meta: metaJson,
  };
}

// ─── Eszip staging ──────────────────────────────────────────────────────────

async function stageEszip(
  ref: string,
  slug: string,
  body: Buffer,
  query: Record<string, string | string[] | undefined>,
  mode: DeployMode,
): Promise<StagedDeploy> {
  // ezbr_sha256 (from the CLI's query string) is hashed over the WIRE bytes
  // — including the EZBR magic + Brotli payload — not the decompressed
  // eszip. So compute the wire-hash before decompression.
  const wireHash = createHash('sha256').update(body).digest('hex');

  // The CLI's default path (pkg/function/bundle.go) wraps each eszip in
  // EZBR + Brotli. The --use-api path on older CLIs sends raw ESZIP.
  // Accept either; persist the decompressed ESZIP bytes so the runtime's
  // EdgeRuntime.userWorkers.create({ maybeEszip }) can load them.
  let eszipBytes: Buffer;
  if (isEzbrMagic(body)) {
    eszipBytes = await decompressEzbrToEszip(body);
    if (!isEszipMagic(eszipBytes)) {
      throw new ManagementApiError(
        422,
        'EZBR payload decompressed to bytes that do not start with the ESZIP magic',
        'invalid_eszip',
      );
    }
  } else if (isEszipMagic(body)) {
    eszipBytes = body;
  } else {
    throw new ManagementApiError(
      422,
      'Request body must start with ESZIP or EZBR magic',
      'invalid_eszip',
    );
  }
  const sha = wireHash;

  // Validate the query metadata. PATCH uses the narrower schema (no slug/name).
  const parsedQuery =
    mode === 'create'
      ? EszipDeployQuerySchema.parse({ ...query, slug })
      : EszipUpdateQuerySchema.parse(query);
  const claimedSha = parsedQuery.ezbr_sha256;
  if (claimedSha && claimedSha !== sha) {
    throw new ManagementApiError(
      422,
      `ezbr_sha256 mismatch: query=${claimedSha} actual=${sha}`,
      'ezbr_mismatch',
    );
  }

  const stagingDir = path.join(stagingRootFor(ref), randomUUID());
  await mkdir(stagingDir, { recursive: true });
  // Write the DECOMPRESSED ESZIP bytes — the runtime's eszip loader expects
  // raw ESZIP2.x, not the EZBR-wrapped wire form.
  await writeFile(path.join(stagingDir, 'bundle.eszip'), eszipBytes);

  const metaJson = {
    source_path: 'bundle.eszip',
    entrypoint_path: parsedQuery.entrypoint_path ?? null,
    import_map_path: parsedQuery.import_map_path ?? null,
    verify_jwt: parsedQuery.verify_jwt ?? true,
    ezbr_sha256: sha,
    deployed_at: Date.now(),
  };
  await writeFile(path.join(stagingDir, 'meta.json'), JSON.stringify(metaJson, null, 2));

  return {
    stagingDir,
    sourcePath: 'bundle.eszip',
    entrypointPath: parsedQuery.entrypoint_path ?? null,
    importMapPath: parsedQuery.import_map_path ?? null,
    verifyJwt: parsedQuery.verify_jwt ?? true,
    sizeBytes: eszipBytes.byteLength,
    sha256: sha,
    meta: metaJson,
  };
}

// ─── Shared commit (move + DB + restart + rollback) ─────────────────────────

interface CommitOpts {
  ref: string;
  slug: string;
  deployerUserId: string;
  staged: StagedDeploy;
}

async function commitDeploy({
  ref,
  slug,
  deployerUserId,
  staged,
}: CommitOpts): Promise<DeployFunctionResponse> {
  assertSlug(slug);
  const targetDir = slugDir(ref, slug);
  const parent = instanceFunctionsDir(ref);
  await mkdir(parent, { recursive: true });

  // Snapshot prior version if present.
  const rollbackRoot = path.join(parent, '.deploy-rollback');
  await mkdir(rollbackRoot, { recursive: true });
  let rollbackPath: string | null = null;
  let priorVersion = 0;
  try {
    await stat(targetDir);
    rollbackPath = path.join(rollbackRoot, `${slug}-${Date.now()}`);
    await rename(targetDir, rollbackPath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  // Atomically move staging into the per-instance volume.
  try {
    await rename(staged.stagingDir, targetDir);
  } catch (e) {
    // Restore snapshot if move failed.
    if (rollbackPath) await rename(rollbackPath, targetDir).catch(() => {});
    throw e;
  }

  // DB upsert. We deliberately do NOT wrap the file move inside a SQL
  // transaction — Postgres can't roll back a filesystem rename. Instead
  // the file move happens first, then the DB write; on DB failure we
  // restore the snapshot.
  let row: typeof schema.projectFunctions.$inferSelect;
  try {
    const existing = await db()
      .select({
        id: schema.projectFunctions.id,
        version: schema.projectFunctions.version,
      })
      .from(schema.projectFunctions)
      .where(
        and(eq(schema.projectFunctions.instanceRef, ref), eq(schema.projectFunctions.slug, slug)),
      )
      .limit(1);

    if (existing[0]) {
      priorVersion = existing[0].version;
      const [updated] = await db()
        .update(schema.projectFunctions)
        .set({
          name: slug,
          verifyJwt: staged.verifyJwt,
          version: existing[0].version + 1,
          entrypointPath: staged.entrypointPath,
          importMapPath: staged.importMapPath,
          sourcePath: staged.sourcePath,
          sizeBytes: staged.sizeBytes,
          sha256: staged.sha256,
          updatedAt: new Date(),
          updatedBy: deployerUserId,
        })
        .where(eq(schema.projectFunctions.id, existing[0].id))
        .returning();
      row = updated!;
    } else {
      const [created] = await db()
        .insert(schema.projectFunctions)
        .values({
          instanceRef: ref,
          slug,
          name: slug,
          status: 'ACTIVE',
          verifyJwt: staged.verifyJwt,
          version: 1,
          entrypointPath: staged.entrypointPath,
          importMapPath: staged.importMapPath,
          sourcePath: staged.sourcePath,
          sizeBytes: staged.sizeBytes,
          sha256: staged.sha256,
          createdBy: deployerUserId,
          updatedBy: deployerUserId,
        })
        .returning();
      row = created!;
    }
  } catch (e) {
    // Restore snapshot.
    await rm(targetDir, { recursive: true, force: true });
    if (rollbackPath) await rename(rollbackPath, targetDir).catch(() => {});
    throw e;
  }

  // Restart functions container. On failure, roll back files AND DB row.
  const docker = getDockerControl();
  const containerName = `supastack-${ref}-functions-1`;
  const auditId = randomUUID();
  try {
    await docker.restart(containerName);
    await docker.waitHealthy(containerName, 5000);
  } catch (restartErr) {
    // File rollback.
    await rm(targetDir, { recursive: true, force: true });
    if (rollbackPath) await rename(rollbackPath, targetDir).catch(() => {});
    // DB rollback: revert to prior version, or hard-delete if this was create.
    if (priorVersion === 0) {
      await db().delete(schema.projectFunctions).where(eq(schema.projectFunctions.id, row.id));
      // No function_deploys audit row when the project_functions row was just deleted —
      // the FK would violate. The rollback error is logged by the caller.
    } else {
      await db()
        .update(schema.projectFunctions)
        .set({ version: priorVersion })
        .where(eq(schema.projectFunctions.id, row.id));
      await db()
        .insert(schema.functionDeploys)
        .values({
          id: auditId,
          functionId: row.id,
          instanceRef: ref,
          slug,
          version: row.version,
          status: 'ROLLED_BACK',
          sizeBytes: staged.sizeBytes,
          sha256: staged.sha256,
          errorMessage: (restartErr as Error).message,
          finishedAt: new Date(),
          deployedBy: deployerUserId,
          source: 'cli',
        });
    }
    throw new ManagementApiError(
      500,
      `Deploy of function '${slug}' was rolled back: ${(restartErr as Error).message}. The previous version is still serving traffic.`,
      'deploy_rolled_back',
      { slug, prior_version: priorVersion },
    );
  }

  // Success — audit + clean up the rollback snapshot opportunistically.
  await db().insert(schema.functionDeploys).values({
    id: auditId,
    functionId: row.id,
    instanceRef: ref,
    slug,
    version: row.version,
    status: 'SUCCEEDED',
    sizeBytes: staged.sizeBytes,
    sha256: staged.sha256,
    finishedAt: new Date(),
    deployedBy: deployerUserId,
    source: 'cli',
  });
  if (rollbackPath) await rm(rollbackPath, { recursive: true, force: true }).catch(() => {});
  void sql; // silences unused import when SQL helpers move out

  return functionRowToFunction(row);
}

// ─── Public entry points ────────────────────────────────────────────────────

export async function deployFromMultipart(opts: {
  ref: string;
  slug: string;
  deployerUserId: string;
  parts: AsyncIterableIterator<MultipartFile | MultipartValue>;
}): Promise<DeployFunctionResponse> {
  assertSlug(opts.slug);
  const staged = await stageMultipart(opts.ref, opts.slug, opts.parts);
  try {
    return await commitDeploy({
      ref: opts.ref,
      slug: opts.slug,
      deployerUserId: opts.deployerUserId,
      staged,
    });
  } finally {
    // staging is moved into place on success; on failure rm-rf to clean up.
    await rm(staged.stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function deployFromEszip(opts: {
  ref: string;
  slug: string;
  deployerUserId: string;
  mode: DeployMode;
  body: Buffer | Readable;
  query: Record<string, string | string[] | undefined>;
}): Promise<DeployFunctionResponse> {
  assertSlug(opts.slug);
  const body = await collectBody(opts.body);
  const staged = await stageEszip(opts.ref, opts.slug, body, opts.query, opts.mode);
  try {
    return await commitDeploy({
      ref: opts.ref,
      slug: opts.slug,
      deployerUserId: opts.deployerUserId,
      staged,
    });
  } finally {
    await rm(staged.stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function collectBody(body: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Read the source bundle back from disk for `GET .../functions/:slug/body`.
 * Returns the list of {filename, contents} pairs so the route can stream them
 * as a multipart response (mirror of the upload format).
 */
export async function readFunctionBundle(
  ref: string,
  slug: string,
): Promise<Array<{ filename: string; contents: Buffer }>> {
  const dir = slugDir(ref, slug);
  const out: Array<{ filename: string; contents: Buffer }> = [];
  async function walk(p: string, rel: string): Promise<void> {
    const ents = await readdir(p, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name === 'meta.json') continue; // sidecar, not part of source
      const full = path.join(p, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(full, r);
      else out.push({ filename: r, contents: await readFile(full) });
    }
  }
  await walk(dir, '');
  return out;
}
