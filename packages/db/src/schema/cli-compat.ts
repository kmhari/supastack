/**
 * Drizzle schema for the Supabase CLI compatibility (P0) feature.
 *
 * Spec: specs/003-supabase-cli-compat-p0/data-model.md
 * Migration: packages/db/migrations/0002_cli_compat.sql
 *
 * Tables added here:
 *   - project_functions: per-instance edge function metadata
 *   - function_deploys:  per-deploy audit log
 *   - project_secrets:   per-instance runtime secrets (encrypted at rest)
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  customType,
  check,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { supabaseInstances } from './instances.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ─── project_functions ──────────────────────────────────────────────────────
//
// One row per deployed edge function per instance. The bundle itself lives on
// the host filesystem under
//   /var/selfbase/instances/<instance_ref>/volumes/functions/<slug>/
// alongside a meta.json sidecar. This row is the canonical index + metadata.
//
// `source_path` records which form the bundle takes:
//   - "bundle.eszip" for eszip-path deploys (default `supabase functions deploy`)
//   - "index.ts"     for --use-api path deploys (raw source)
// The per-instance edge-runtime main router consults meta.json to dispatch.
export const projectFunctions = pgTable(
  'project_functions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['ACTIVE', 'REMOVED'] })
      .notNull()
      .default('ACTIVE'),
    verifyJwt: boolean('verify_jwt').notNull().default(true),
    version: integer('version').notNull().default(1),
    entrypointPath: text('entrypoint_path'),
    importMapPath: text('import_map_path'),
    sourcePath: text('source_path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    instanceSlugUq: uniqueIndex('project_functions_instance_slug').on(t.instanceRef, t.slug),
    activeIdx: index('project_functions_active_idx')
      .on(t.instanceRef, t.status)
      .where(sql`${t.status} = 'ACTIVE'`),
  }),
);

// ─── function_deploys ───────────────────────────────────────────────────────
//
// One row per deploy attempt (success, failure, or rollback). Useful for the
// dashboard's per-function history view and for debugging silent CLI errors.
export const functionDeploys = pgTable(
  'function_deploys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    functionId: uuid('function_id').references(() => projectFunctions.id, {
      onDelete: 'cascade',
    }),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['SUCCEEDED', 'FAILED', 'ROLLED_BACK'] }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    deployedBy: uuid('deployed_by').references(() => users.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['cli', 'dashboard', 'api'] }).notNull(),
  },
  (t) => ({
    instanceTimeIdx: index('function_deploys_instance_idx').on(
      t.instanceRef,
      sql`${t.startedAt} DESC`,
    ),
  }),
);

// ─── project_secrets ────────────────────────────────────────────────────────
//
// Source of truth for which secrets are configured per project, encrypted at
// rest with the master key (via @selfbase/crypto encryptJson). The runtime
// value is mirrored into the per-instance .env file at
//   /var/selfbase/instances/<ref>/.env
// so the edge-runtime container reads it on (re)start. This table lets the
// dashboard list secret NAMES without ever decrypting the values, and lets
// the platform rebuild the .env file after a disaster restore.
export const projectSecrets = pgTable(
  'project_secrets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    encryptedValue: bytea('encrypted_value').notNull(),
    // SHA-256 hex digest of the plaintext value. Non-reversible, stable,
    // safe to surface in `GET /secrets` as the cloud's redacted-value
    // indicator. Lets the dashboard render a per-secret fingerprint
    // without decrypting on every list call.
    valueSha256: text('value_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    instanceNameUq: uniqueIndex('project_secrets_instance_name').on(t.instanceRef, t.name),
    nameFormat: check('project_secrets_name_format', sql`${t.name} ~ '^[A-Z][A-Z0-9_]{0,63}$'`),
  }),
);
