/**
 * selfbase MCP HTTP service — feature 014.
 *
 * v1 implementation lands during Phase 3 US1. This file is currently a
 * scaffold so the package typechecks and the compose service can build
 * without compile errors. Replace with the real Fastify wrapper + upstream
 * @supabase/mcp-server-supabase mount per tasks T034..T039.
 */
import Fastify from 'fastify';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/health', async () => ({ ok: true }));

app.post('/mcp', async (_req, reply) => {
  // TODO(US1 T034..T039): mount upstream MCP server via Streamable HTTP transport
  return reply.status(501).send({ error: 'not_implemented', message: 'MCP transport not wired yet' });
});

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? '0.0.0.0';

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen({ port: PORT, host: HOST }).then(() => {
    app.log.info({ port: PORT }, 'selfbase mcp scaffold listening');
  });
}
