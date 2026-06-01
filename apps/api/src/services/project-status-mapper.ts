/**
 * Supastack → Cloud project-status enum translation.
 *
 * Cloud's wire enum (per upstream OpenAPI): ACTIVE_HEALTHY, COMING_UP,
 * INACTIVE, RESTORING, REMOVED, UNKNOWN.
 *
 * Supastack's internal enum: running, paused, stopped, provisioning, creating,
 * failed, deleting (see `packages/db/src/schema/instances.ts`).
 *
 * Applied at every `/v1/projects/*` response boundary so MCP + CLI clients
 * see the wire shape they expect (FR-036, research.md Decision 8).
 */
const SUPASTACK_TO_CLOUD: Record<string, string> = {
  running: 'ACTIVE_HEALTHY',
  paused: 'INACTIVE',
  stopped: 'INACTIVE',
  provisioning: 'COMING_UP',
  creating: 'COMING_UP',
  failed: 'UNKNOWN',
  deleting: 'REMOVED',
};

export function mapSupastackStatusToCloud(status: string): string {
  return SUPASTACK_TO_CLOUD[status] ?? 'UNKNOWN';
}
