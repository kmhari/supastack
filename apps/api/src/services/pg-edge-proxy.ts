import net from 'node:net';
import tls from 'node:tls';
import { readFileSync, existsSync } from 'node:fs';
import { eq, and, not, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import { db, schema } from '@selfbase/db';
import { logger } from '@selfbase/shared';

/**
 * pg-edge-proxy — direct Postgres endpoint for `db.<ref>.<apex>:5432`.
 *
 * Per-connection flow:
 *   1. Read first 8 bytes from client.
 *   2. If they're the Postgres SSLRequest preamble, write 'S' back; else close.
 *   3. Upgrade the socket to TLS using the wildcard cert + key from /var/selfbase/certs.
 *   4. After TLS handshake, read tlsSocket.servername (SNI).
 *   5. Validate SNI matches `^db\.([a-z]{20})\.<apex>$`. Extract ref.
 *   6. Look up the backend port for that ref (cached 60s) from supabase_instances.
 *   7. Open a TCP connection to host.docker.internal:<port_db_direct>.
 *   8. Bidirectionally pipe bytes between the client TLS socket and the backend.
 *
 * caddy-l4's postgres matcher couldn't do step 2 (doesn't write the 'S'
 * response). supavisor 2.7.4 has an SNI lookup bug. Hence this self-contained
 * 100-line proxy. See specs/005-postgres-public-endpoint/contracts/pg-edge-proxy.md.
 */

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
const SSL_ACCEPT = Buffer.from([0x53]); // 'S' — server supports SSL

interface BackendInfo {
  host: string;
  port: number;
  expiresAt: number;
}

interface ProxyOptions {
  port?: number;
  certPath: string;
  keyPath: string;
  apexDomain: string;
  redisUrl?: string;
}

export interface PgEdgeProxy {
  port: number;
  close: () => Promise<void>;
}

export function startPgEdgeProxy(opts: ProxyOptions): PgEdgeProxy {
  const port = opts.port ?? 5432;
  const apexEscaped = opts.apexDomain.replace(/[.\\]/g, '\\$&');
  let sniRegex = new RegExp(`^db\\.([a-z]{20})\\.${apexEscaped}$`);

  // TLS context — recreated on cert reload.
  let tlsContext = tls.createSecureContext({
    cert: readFileSync(opts.certPath),
    key: readFileSync(opts.keyPath),
  });

  // Backend lookup cache (60s TTL).
  const backendCache = new Map<string, BackendInfo>();
  const BACKEND_TTL_MS = 60_000;

  async function lookupBackend(ref: string): Promise<{ host: string; port: number } | null> {
    const now = Date.now();
    const cached = backendCache.get(ref);
    if (cached && cached.expiresAt > now) return { host: cached.host, port: cached.port };

    const rows = await db()
      .select({ portDbDirect: schema.supabaseInstances.portDbDirect })
      .from(schema.supabaseInstances)
      .where(
        and(
          eq(schema.supabaseInstances.ref, ref),
          not(inArray(schema.supabaseInstances.status, ['deleting'])),
        ),
      )
      .limit(1);

    const portDbDirect = rows[0]?.portDbDirect;
    if (!portDbDirect) {
      backendCache.set(ref, { host: '', port: 0, expiresAt: now + BACKEND_TTL_MS });
      return null;
    }
    const info = { host: 'host.docker.internal', port: portDbDirect, expiresAt: now + BACKEND_TTL_MS };
    backendCache.set(ref, info);
    return { host: info.host, port: info.port };
  }

  const server = net.createServer((clientSocket) => {
    clientSocket.once('error', (err) => {
      logger.debug({ err: err.message }, 'pg-edge: client socket error (pre-handshake)');
    });

    let preamble = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      preamble = Buffer.concat([preamble, chunk]);
      if (preamble.length < 8) return;
      clientSocket.removeListener('data', onData);

      if (!preamble.subarray(0, 8).equals(SSL_REQUEST)) {
        logger.debug('pg-edge: not an SSLRequest, closing');
        clientSocket.destroy();
        return;
      }
      clientSocket.write(SSL_ACCEPT);

      // Any bytes past the 8-byte SSLRequest belong to the TLS handshake.
      const extra = preamble.subarray(8);

      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        secureContext: tlsContext,
        SNICallback: (_servername, cb) => cb(null, tlsContext),
      });
      if (extra.length > 0) tlsSocket.unshift(extra);

      tlsSocket.on('error', (err) => {
        logger.debug({ err: err.message }, 'pg-edge: TLS error');
        tlsSocket.destroy();
      });

      tlsSocket.on('secure', () => {
        void handleSecure(tlsSocket);
      });
    };
    clientSocket.on('data', onData);
  });

  async function handleSecure(tlsSocket: tls.TLSSocket): Promise<void> {
    const sni = tlsSocket.servername;
    if (!sni) {
      logger.warn('pg-edge: no SNI after TLS handshake, closing');
      tlsSocket.destroy();
      return;
    }
    const match = sni.match(sniRegex);
    if (!match) {
      logger.warn({ sni }, 'pg-edge: SNI does not match db.<ref>.<apex> pattern');
      tlsSocket.destroy();
      return;
    }
    const ref = match[1]!;

    const backend = await lookupBackend(ref).catch((err) => {
      logger.error({ err: err.message, ref }, 'pg-edge: backend lookup failed');
      return null;
    });
    if (!backend) {
      logger.warn({ ref }, 'pg-edge: no backend for ref, closing');
      tlsSocket.destroy();
      return;
    }

    const backendSocket = net.connect(backend.port, backend.host);
    backendSocket.once('error', (err) => {
      logger.warn(
        { err: err.message, ref, dial: `${backend.host}:${backend.port}` },
        'pg-edge: backend dial failed',
      );
      tlsSocket.destroy();
    });
    backendSocket.once('connect', () => {
      // Bidirectional pipe. Errors on either side tear down both.
      tlsSocket.pipe(backendSocket);
      backendSocket.pipe(tlsSocket);
      const close = (): void => {
        tlsSocket.destroy();
        backendSocket.destroy();
      };
      tlsSocket.once('close', close);
      backendSocket.once('close', close);
      tlsSocket.once('error', close);
      backendSocket.once('error', close);
    });
  }

  server.listen(port, () => {
    logger.info({ port, apex: opts.apexDomain }, 'pg-edge proxy listening');
  });

  // Cert reload + apex change + instance delete via Redis pub/sub (optional).
  let redis: Redis | null = null;
  if (opts.redisUrl) {
    redis = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
    redis.subscribe(
      'selfbase:wildcard-cert:reloaded',
      'selfbase:apex:changed',
      'selfbase:instance:deleted',
    ).catch((err) => logger.warn({ err: err.message }, 'pg-edge: redis subscribe failed'));
    redis.on('message', (channel, raw) => {
      try {
        if (channel === 'selfbase:wildcard-cert:reloaded') {
          if (existsSync(opts.certPath) && existsSync(opts.keyPath)) {
            tlsContext = tls.createSecureContext({
              cert: readFileSync(opts.certPath),
              key: readFileSync(opts.keyPath),
            });
            logger.info('pg-edge: wildcard cert reloaded');
          }
        } else if (channel === 'selfbase:apex:changed') {
          const { apex } = JSON.parse(raw);
          if (typeof apex === 'string' && apex.length > 0) {
            sniRegex = new RegExp(`^db\\.([a-z]{20})\\.${apex.replace(/[.\\]/g, '\\$&')}$`);
            backendCache.clear();
            logger.info({ apex }, 'pg-edge: apex updated');
          }
        } else if (channel === 'selfbase:instance:deleted') {
          const { ref } = JSON.parse(raw);
          if (typeof ref === 'string') {
            backendCache.delete(ref);
            logger.info({ ref }, 'pg-edge: backend cache invalidated');
          }
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, channel }, 'pg-edge: pubsub handler error');
      }
    });
  }

  return {
    port,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          redis?.disconnect();
          resolve();
        });
      }),
  };
}
