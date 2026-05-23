import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { supabaseInstances } from './instances.js';

// ─── pooler_tenants ─────────────────────────────────────────────────────────
export const poolerTenants = pgTable(
  'pooler_tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sniHostname: text('sni_hostname').notNull(),
    poolSize: integer('pool_size').notNull().default(20),
    maxClients: integer('max_clients').notNull().default(100),
    registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
    lastHealthAt: timestamp('last_health_at', { withTimezone: true }),
    status: text('status').notNull().default('registering'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdUnique: uniqueIndex('pooler_tenants_external_id_unique').on(t.externalId),
    instanceIdx: index('pooler_tenants_instance_idx').on(t.instanceRef),
    statusIdx: index('pooler_tenants_status_idx').on(t.status),
  }),
);

// ─── pooler_events ──────────────────────────────────────────────────────────
export const poolerEvents = pgTable(
  'pooler_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => poolerTenants.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    event: text('event').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('pooler_events_tenant_idx').on(t.tenantId, t.createdAt),
    externalIdx: index('pooler_events_external_idx').on(t.externalId, t.createdAt),
  }),
);

// Suppress unused import warning — `boolean`/`sql` may be needed for future fields.
void boolean;
void sql;
