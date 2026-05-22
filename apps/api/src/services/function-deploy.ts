/**
 * Per-instance edge function deploy hot path.
 *
 * Spec: specs/003-supabase-cli-compat-p0/research.md R-002, R-003
 *
 * Phase-2 stub. The pure helper (isEszipMagic) gets its real implementation
 * here so unit tests in T003a can exercise it. The deployFromMultipart /
 * deployFromEszip / commitDeploy I/O functions throw `not_implemented`
 * until T038 in Phase 5.
 */

const ESZIP_MAGIC = Buffer.from('ESZIP', 'utf8');

/**
 * Returns true iff `bytes` starts with the literal magic header `ESZIP`.
 * The runtime accepts ESZIP2.x (`v1.71.2` produces `ESZIP2.3`); we don't
 * pin the version byte because future runtime upgrades may bump it.
 */
export function isEszipMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ESZIP_MAGIC.byteLength) return false;
  for (let i = 0; i < ESZIP_MAGIC.byteLength; i++) {
    if (bytes[i] !== ESZIP_MAGIC[i]) return false;
  }
  return true;
}

// ─── Deploy entry points (Phase 5 — currently stubs) ────────────────────────

export type DeployMode = 'create' | 'update';

export async function deployFromMultipart(_opts: {
  ref: string;
  slug: string;
  deployerUserId: string;
  mode: DeployMode;
  multipartBody: AsyncIterable<unknown>;
}): Promise<never> {
  throw new Error('not_implemented: deployFromMultipart lands in T038');
}

export async function deployFromEszip(_opts: {
  ref: string;
  slug: string;
  deployerUserId: string;
  mode: DeployMode;
  body: AsyncIterable<Buffer> | Buffer;
  queryMeta: {
    entrypoint_path?: string;
    import_map_path?: string;
    verify_jwt?: boolean;
    ezbr_sha256?: string;
    name?: string;
  };
}): Promise<never> {
  throw new Error('not_implemented: deployFromEszip lands in T038');
}
