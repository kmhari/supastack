/**
 * Drizzle schemas for the 4 OAuth 2.1 tables — feature 014.
 *
 * Migration: 0013_oauth_tables.sql.
 * Spec: 014-mcp-http-oauth — data-model.md.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigserial,
  index,
  customType,
} from 'drizzle-orm/pg-core';

const inet = customType<{ data: string }>({ dataType: () => 'inet' });

export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIp: inet('created_by_ip'),
  metadata: jsonb('metadata'),
});

export const oauthCodes = pgTable(
  'oauth_codes',
  {
    code: text('code').primaryKey(),
    clientId: uuid('client_id').notNull(),
    userId: uuid('user_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    scope: text('scope').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => ({
    idxExpiresAt: index('idx_oauth_codes_expires_at').on(t.expiresAt),
  }),
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    token: text('token').primaryKey(),
    clientId: uuid('client_id').notNull(),
    userId: uuid('user_id').notNull(),
    scope: text('scope').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    previousToken: text('previous_token'),
  },
  (t) => ({
    idxUserClient: index('idx_oauth_refresh_user_client').on(t.userId, t.clientId),
    idxLastUsed: index('idx_oauth_refresh_last_used').on(t.lastUsedAt),
  }),
);

export const oauthRevocations = pgTable(
  'oauth_revocations',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    jti: text('jti').notNull(),
    userId: uuid('user_id').notNull(),
    clientId: uuid('client_id').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
    revokeReason: text('revoke_reason'),
  },
  (t) => ({
    idxJti: index('idx_oauth_revocations_jti').on(t.jti),
  }),
);

// Suppress unused-import warning
void sql;
