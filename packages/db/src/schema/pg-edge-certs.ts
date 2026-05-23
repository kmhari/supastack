import {
  pgTable,
  uuid,
  text,
  timestamp,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { supabaseInstances } from './instances.js';

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

export const pgEdgeCerts = pgTable(
  'pg_edge_certs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    certPem: text('cert_pem'),
    keyPem: bytea('key_pem'),
    notBefore: timestamp('not_before', { withTimezone: true }),
    notAfter: timestamp('not_after', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    lastError: text('last_error'),
    lastIssuedAt: timestamp('last_issued_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    hostnameUnique: uniqueIndex('pg_edge_certs_hostname_unique').on(t.hostname),
    instanceIdx: index('pg_edge_certs_instance_idx').on(t.instanceRef),
  }),
);
