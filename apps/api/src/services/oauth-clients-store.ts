/**
 * Drizzle accessors for `oauth_clients` (RFC 7591 DCR-registered clients).
 *
 * Spec: 014-mcp-http-oauth — FR-005, contracts/oauth-register-endpoint.md.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

export interface OAuthClient {
  id: string;
  clientName: string;
  redirectUris: string[];
  createdAt: Date;
  createdByIp: string | null;
  metadata: unknown;
}

export interface RegisterClientInput {
  clientName: string;
  redirectUris: string[];
  metadata?: Record<string, unknown>;
  createdByIp?: string | null;
}

export async function registerClient(input: RegisterClientInput): Promise<OAuthClient> {
  const [row] = await db()
    .insert(schema.oauthClients)
    .values({
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      metadata: input.metadata ?? null,
      createdByIp: input.createdByIp ?? null,
    })
    .returning();
  if (!row) throw new Error('oauth_clients insert returned no row');
  return rowToClient(row);
}

export async function getClientById(clientId: string): Promise<OAuthClient | null> {
  const [row] = await db()
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.id, clientId))
    .limit(1);
  return row ? rowToClient(row) : null;
}

/** Exact-match check — substring + trailing-slash mismatch both fail. */
export function validateRedirectUri(client: OAuthClient, requested: string): boolean {
  for (const allowed of client.redirectUris) {
    if (allowed === requested) return true;
  }
  return false;
}

function rowToClient(row: typeof schema.oauthClients.$inferSelect): OAuthClient {
  return {
    id: row.id,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    createdAt: row.createdAt,
    createdByIp: row.createdByIp,
    metadata: row.metadata,
  };
}
