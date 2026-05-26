/**
 * selfbase MCP HTTP service — feature 014 US1.
 *
 * Wraps upstream @supabase/mcp-server-supabase as a Streamable HTTP
 * transport at POST /mcp, gated by selfbase OAuth 2.1 bearer tokens.
 *
 * Per Clarifications Q5: single-replica + in-process session map.
 */
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { loadMasterKey } from '@selfbase/crypto';
import { createSupabaseMcpServer } from '@supabase/mcp-server-supabase';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { AuthError, resolveBearer, wwwAuthenticateHeader } from './bearer-auth.js';
import { buildPlatform } from './platform-build.js';

const DEFERRED_TOOLS = new Set([
  'create_project',
  'get_cost',
  'confirm_cost',
  'get_advisors',
  'get_storage_config',
  'update_storage_config',
]);

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? '0.0.0.0';
const APEX = process.env.SELFBASE_APEX ?? '';
const API_URL = process.env.SELFBASE_API_URL ?? 'http://api:3001';
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');

interface SessionEntry {
  sessionId: string;
  userId: string;
  clientId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any;
  transport: StreamableHTTPServerTransport;
  lastUsedAt: number;
}

const sessions = new Map<string, SessionEntry>();

// Idle sweep (1-min interval)
const sweep = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, entry] of sessions) {
    if (entry.lastUsedAt < cutoff) {
      sessions.delete(id);
    }
  }
}, 60_000);
sweep.unref();

// ─── Routes ────────────────────────────────────────────────────────────────

app.get('/health', async () => ({ ok: true, service: 'selfbase-mcp' }));

// RFC 9728 — protected-resource metadata for OAuth discovery
app.get('/.well-known/oauth-protected-resource', async (_req, reply) => {
  if (!APEX) {
    return reply.status(503).send({ message: 'apex not configured', code: 'not_ready' });
  }
  reply.header('Cache-Control', 'max-age=3600');
  return {
    resource: `https://mcp.${APEX}/mcp`,
    authorization_servers: [`https://api.${APEX}`],
    scopes_supported: ['platform'],
    bearer_methods_supported: ['header'],
  };
});

// POST /mcp — MCP Streamable HTTP transport
app.post('/mcp', async (req, reply) => {
  let claims;
  try {
    claims = await resolveBearer({
      authHeader: req.headers.authorization,
      masterKey: loadMasterKey(),
      expectedIss: `https://api.${APEX}`,
      expectedAud: `https://mcp.${APEX}/mcp`,
      redis,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      reply.header('WWW-Authenticate', wwwAuthenticateHeader(APEX, err.errorCode));
      return reply.status(err.status).send({
        error: err.errorCode,
        error_description: err.message,
      });
    }
    throw err;
  }

  // Bearer token (raw) — re-extract to forward to platform
  const rawBearer = (req.headers.authorization ?? '').slice('Bearer '.length).trim();

  // Session lookup
  const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;
  let entry: SessionEntry | undefined;
  let isNewSession = false;
  if (sessionIdHeader && sessions.has(sessionIdHeader)) {
    entry = sessions.get(sessionIdHeader)!;
    entry.lastUsedAt = Date.now();
  } else {
    // Mint new session. We don't know the transport's sessionId until
    // handleRequest assigns one; store under that id post-hoc.
    const platform = buildPlatform({ accessToken: rawBearer, apiUrl: API_URL });
    const server = createSupabaseMcpServer({ platform });

    // Filter deferred tools out of tools/list so clients never see them.
    // _requestHandlers is an internal Map on Protocol; capture before replacing.
    const origListTools = (server as any)._requestHandlers?.get('tools/list');
    if (origListTools) {
      server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
        const r = await origListTools(req, extra);
        return { ...r, tools: (r.tools ?? []).filter((t: { name: string }) => !DEFERRED_TOOLS.has(t.name)) };
      });
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    await server.connect(transport);
    entry = {
      sessionId: '', // populated after handleRequest assigns one
      userId: claims.sub,
      clientId: claims.azp,
      server,
      transport,
      lastUsedAt: Date.now(),
    };
    isNewSession = true;
  }

  // Hand off to the transport — it handles the JSON-RPC routing
  reply.hijack();
  try {
    await entry.transport.handleRequest(req.raw, reply.raw, req.body);
    // For a new session, finalize the session-map key using the transport's
    // assigned sessionId (populated during initialize handling).
    if (isNewSession) {
      const sid = (entry.transport as { sessionId?: string }).sessionId;
      if (sid) {
        entry.sessionId = sid;
        sessions.set(sid, entry);
        req.log.info(
          { sessionId: sid, userId: entry.userId, clientId: entry.clientId },
          'mcp.session.opened',
        );
      } else {
        req.log.warn('transport did not assign sessionId after handleRequest');
      }
    }
  } catch (err) {
    req.log.error({ err }, 'mcp transport error');
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
      reply.raw.setHeader('content-type', 'application/json');
      reply.raw.end(JSON.stringify({ error: 'internal_error' }));
    } else if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
});

// ─── Boot ──────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  app
    .listen({ port: PORT, host: HOST })
    .then(() => {
      app.log.info({ port: PORT, apex: APEX, apiUrl: API_URL }, 'selfbase mcp listening');
    })
    .catch((err) => {
      console.error('mcp startup failed:', err);
      process.exit(1);
    });
}

export { app };
