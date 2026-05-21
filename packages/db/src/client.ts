import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export function makeDb(connectionString: string): NodePgDatabase<typeof schema> {
  if (_db) return _db;
  _pool = new pg.Pool({ connectionString, max: 10 });
  _db = drizzle(_pool, { schema });
  return _db;
}

export const db = (): NodePgDatabase<typeof schema> => {
  if (!_db) throw new Error('db not initialized — call makeDb(connectionString) at startup');
  return _db;
};

export async function closeDb(): Promise<void> {
  if (_pool) await _pool.end();
  _pool = null;
  _db = null;
}

export type SelfbaseDb = NodePgDatabase<typeof schema>;
