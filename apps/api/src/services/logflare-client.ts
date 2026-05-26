/**
 * Per-project Logflare/analytics container forwarder — feature 014 US4.
 *
 * Forwards a SQL-over-logs query to the project's analytics container
 * (`selfbase-<ref>-analytics-1:4000`). Authenticates with the per-project
 * `logflarePrivateAccessToken` stored in encrypted secrets.
 *
 * Service → log-table mapping mirrors upstream Cloud (research.md Decision 9):
 *   api → edge_logs, postgres → postgres_logs, edge-function → function_edge_logs,
 *   auth → auth_logs, storage → storage_logs, realtime → realtime_logs.
 *
 * Spec: 014-mcp-http-oauth — FR-025..028, contracts/logs-endpoint.md.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

export type LogService =
  | 'api'
  | 'postgres'
  | 'edge-function'
  | 'auth'
  | 'storage'
  | 'realtime';

const SERVICE_TABLE: Record<LogService, string> = {
  api: 'edge_logs',
  postgres: 'postgres_logs',
  'edge-function': 'function_edge_logs',
  auth: 'auth_logs',
  storage: 'storage_logs',
  realtime: 'realtime_logs',
};

export class InstanceNotFoundForLogsError extends Error {
  code = 'instance_not_found' as const;
}
export class AnalyticsUnreachableError extends Error {
  code = 'analytics_unreachable' as const;
  constructor(message: string) {
    super(message);
  }
}
export class AnalyticsBadGatewayError extends Error {
  code = 'analytics_bad_gateway' as const;
  constructor(message: string) {
    super(message);
  }
}

export interface QueryLogsOptions {
  /** Defaults to 'api' when neither service nor sql is supplied. */
  service?: LogService;
  /** Verbatim SQL — overrides service+time-range construction. */
  sql?: string;
  /** ISO timestamp lower bound — default now - 1h. */
  isoTimestampStart?: string;
  /** ISO timestamp upper bound — default now. */
  isoTimestampEnd?: string;
}

export interface LogRow {
  timestamp?: string;
  event_message?: string;
  metadata?: unknown;
  [k: string]: unknown;
}

export async function queryLogs(ref: string, opts: QueryLogsOptions): Promise<LogRow[]> {
  const [inst] = await db()
    .select({
      status: schema.supabaseInstances.status,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new InstanceNotFoundForLogsError(`instance ${ref} not found`);
  if (inst.status !== 'running') {
    throw new AnalyticsUnreachableError(`project status '${inst.status}' — analytics not running`);
  }

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const token = secrets.logflarePrivateAccessToken;
  if (!token) {
    throw new AnalyticsUnreachableError(
      `instance ${ref} has no logflarePrivateAccessToken in secrets`,
    );
  }

  const sql = opts.sql ?? buildDefaultSql(opts);
  const url = `http://selfbase-${ref}-analytics-1:4000/api/endpoints/query/logs.all?sql=${encodeURIComponent(sql)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': token,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new AnalyticsUnreachableError((err as Error).message);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AnalyticsUnreachableError(`logflare returned ${res.status}: ${body.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new AnalyticsBadGatewayError(`logflare returned invalid JSON: ${(err as Error).message}`);
  }
  const result = (json as { result?: LogRow[]; data?: LogRow[] }).result
    ?? (json as { result?: LogRow[]; data?: LogRow[] }).data
    ?? [];
  return result;
}

function buildDefaultSql(opts: QueryLogsOptions): string {
  const service = opts.service ?? 'api';
  const table = SERVICE_TABLE[service];
  const start = opts.isoTimestampStart ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = opts.isoTimestampEnd ?? new Date().toISOString();
  // Logflare SQL expects timestamps as ISO strings inside single-quotes
  return `SELECT id, timestamp, event_message FROM ${table} WHERE timestamp BETWEEN '${start}' AND '${end}' ORDER BY timestamp DESC LIMIT 100`;
}

/** Exposed for unit tests. */
export const _SERVICE_TABLE = SERVICE_TABLE;
