import {
  pgTable,
  uuid,
  text,
  timestamp,
  customType,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity.js';

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

// ─── wildcard_certs ─────────────────────────────────────────────────────────
export const wildcardCerts = pgTable(
  'wildcard_certs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Feature 084 — vestigial since the `org` singleton was split out; certs are
    // keyed by `apex` (installation-level). Soft uuid, no FK. 0018 drops the constraint.
    orgId: uuid('org_id'),
    apex: text('apex').notNull(),
    status: text('status').notNull().default('pending'),
    accountEmail: text('account_email').notNull(),
    accountKeyPem: bytea('account_key_pem').notNull(),
    orderUrl: text('order_url'),
    challengeRecords: jsonb('challenge_records')
      .notNull()
      .default(sql`'[]'`),
    certPem: text('cert_pem'),
    keyPem: bytea('key_pem'),
    notBefore: timestamp('not_before', { withTimezone: true }),
    notAfter: timestamp('not_after', { withTimezone: true }),
    renewalDue: boolean('renewal_due').notNull().default(false),
    lastError: text('last_error'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    apexUnique: uniqueIndex('wildcard_certs_apex_unique').on(t.apex),
    orgIdx: index('wildcard_certs_org_idx').on(t.orgId),
  }),
);

// ─── cert_renewal_events ────────────────────────────────────────────────────
export const certRenewalEvents = pgTable(
  'cert_renewal_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    certId: uuid('cert_id').references(() => wildcardCerts.id, { onDelete: 'cascade' }),
    // Feature 084 — vestigial (see wildcard_certs.org_id). Soft uuid, no FK.
    orgId: uuid('org_id'),
    triggeredBy: text('triggered_by').notNull(),
    outcome: text('outcome').notNull(),
    errorMessage: text('error_message'),
    certNotAfter: timestamp('cert_not_after', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    certIdx: index('cert_renewal_events_cert_idx').on(t.certId, t.startedAt),
    orgIdx: index('cert_renewal_events_org_idx').on(t.orgId, t.startedAt),
  }),
);
