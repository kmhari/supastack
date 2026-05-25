import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  customType,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { supabaseInstances } from './instances.js';
import { users } from './identity.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const projectConfigSnapshots = pgTable(
  'project_config_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    surface: text('surface').notNull(),
    encryptedPayload: bytea('encrypted_payload').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    surfaceCheck: check(
      'project_config_snapshots_surface_check',
      sql`${t.surface} IN ('postgrest', 'auth')`,
    ),
    uniquePerSurface: uniqueIndex('project_config_snapshots_unique').on(
      t.instanceRef,
      t.surface,
    ),
  }),
);

export type ConfigSurface = 'postgrest' | 'auth';
