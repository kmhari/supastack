import { pgTable, uuid, text, timestamp, jsonb, bigserial } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetKind: text('target_kind'),
  targetId: text('target_id'),
  payload: jsonb('payload')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql.raw(`'{}'::jsonb`)),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// avoid the import-vs-default cycle by re-importing sql at the bottom
import { sql } from 'drizzle-orm';
