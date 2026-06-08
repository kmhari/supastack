import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { supabaseInstances } from './instances.js';

export const sqlSnippetFolders = pgTable('sql_snippet_folders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  instanceRef: text('instance_ref').notNull().references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id'),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sqlSnippets = pgTable('sql_snippets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  instanceRef: text('instance_ref').notNull().references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id'),
  folderId: uuid('folder_id'),
  name: text('name').notNull().default('Untitled Query'),
  description: text('description'),
  content: text('content').notNull().default(''),
  visibility: text('visibility').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
