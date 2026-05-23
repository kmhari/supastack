import acme from 'acme-client';
import { X509Certificate } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eq, and } from 'drizzle-orm';
import Redis from 'ioredis';
import { db, schema } from '@selfbase/db';
import { encryptJson, decryptJson, loadMasterKey } from '@selfbase/crypto';

let _redisPub: Redis | null = null;
function getRedisPub(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!_redisPub) _redisPub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  return _redisPub;
}

const CERTS_DIR = process.env.SELFBASE_CERTS_DIR ?? '/var/selfbase/certs';
const DIRECTORY_URL =
  process.env.ACME_DIRECTORY_URL || acme.directory.letsencrypt.production;

export interface InitiateResult {
  apex: string;
  status: 'awaiting_dns';
  challengeRecords: { name: string; value: string }[];
  ttlHint: number;
}

export interface DnsCheckResult {
  name: string;
  value: string;
  found: boolean;
}

export interface VerifyResult {
  status: 'awaiting_dns' | 'issued' | 'failed';
  dnsChecks?: DnsCheckResult[];
  allDnsReady?: boolean;
  notBefore?: string;
  notAfter?: string;
  message?: string;
}

function publicResolver(): Resolver {
  const r = new Resolver();
  r.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
  return r;
}

function parseCertValidity(pem: string): { notBefore: Date; notAfter: Date } {
  const cert = new X509Certificate(pem);
  return {
    notBefore: new Date(cert.validFrom),
    notAfter: new Date(cert.validTo),
  };
}

async function writeCertFiles(apex: string, certPem: string, keyPem: string): Promise<void> {
  const certPath = `${CERTS_DIR}/${apex}/cert.pem`;
  const keyPath = `${CERTS_DIR}/${apex}/key.pem`;
  await mkdir(dirname(certPath), { recursive: true });
  await writeFile(certPath, certPem, { mode: 0o644 });
  await writeFile(keyPath, keyPem, { mode: 0o600 });
}

export async function loadRow(apex: string) {
  const rows = await db()
    .select()
    .from(schema.wildcardCerts)
    .where(eq(schema.wildcardCerts.apex, apex))
    .limit(1);
  return rows[0] ?? null;
}

export async function initiateWildcardOrder(
  orgId: string,
  apex: string,
  email: string,
): Promise<InitiateResult> {
  const existing = await loadRow(apex);

  // Reuse stored account key if available; otherwise generate a new one.
  let accountKeyPem: Buffer;
  if (existing?.accountKeyPem) {
    const decrypted = decryptJson(existing.accountKeyPem, loadMasterKey()) as { pem: string };
    accountKeyPem = Buffer.from(decrypted.pem, 'utf8');
  } else {
    const key = await acme.crypto.createPrivateKey();
    accountKeyPem = Buffer.from(key);
  }

  const client = new acme.Client({ directoryUrl: DIRECTORY_URL, accountKey: accountKeyPem });
  await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${email}`] });

  const order = await client.createOrder({
    identifiers: [
      { type: 'dns', value: apex },
      { type: 'dns', value: `*.${apex}` },
    ],
  });

  const authorizations = await client.getAuthorizations(order);
  const challengeRecords: { name: string; value: string }[] = [];

  for (const authz of authorizations) {
    const dnsChallenge = authz.challenges.find((c) => c.type === 'dns-01');
    if (!dnsChallenge) throw new Error(`no dns-01 challenge for ${authz.identifier.value}`);
    const keyAuth = await client.getChallengeKeyAuthorization(dnsChallenge);
    const recordName = `_acme-challenge.${authz.identifier.value.replace(/^\*\./, '')}`;
    challengeRecords.push({ name: recordName, value: keyAuth });
  }

  const encryptedKey = encryptJson({ pem: accountKeyPem.toString('utf8') }, loadMasterKey());

  await db()
    .insert(schema.wildcardCerts)
    .values({
      orgId,
      apex,
      status: 'awaiting_dns',
      accountEmail: email,
      accountKeyPem: encryptedKey,
      orderUrl: order.url,
      challengeRecords,
      createdBy: null,
      updatedBy: null,
    })
    .onConflictDoUpdate({
      target: schema.wildcardCerts.apex,
      set: {
        orgId,
        status: 'awaiting_dns',
        accountEmail: email,
        accountKeyPem: encryptedKey,
        orderUrl: order.url,
        challengeRecords,
        lastError: null,
        updatedAt: new Date(),
      },
    });

  // Insert in-progress renewal event
  const certRow = await loadRow(apex);
  if (certRow) {
    await db().insert(schema.certRenewalEvents).values({
      certId: certRow.id,
      orgId,
      triggeredBy: existing?.status === 'issued' ? 'manual' : 'initial',
      outcome: 'in_progress',
    });
  }

  return { apex, status: 'awaiting_dns', challengeRecords, ttlHint: 60 };
}

export async function checkDns(
  challengeRecords: { name: string; value: string }[],
): Promise<DnsCheckResult[]> {
  const resolver = publicResolver();
  return Promise.all(
    challengeRecords.map(async (rec) => {
      try {
        const values = (await resolver.resolveTxt(rec.name)).flat();
        return { name: rec.name, value: rec.value, found: values.includes(rec.value) };
      } catch {
        return { name: rec.name, value: rec.value, found: false };
      }
    }),
  );
}

export async function verifyAndFinalize(apex: string): Promise<VerifyResult> {
  const row = await loadRow(apex);
  if (!row) return { status: 'failed', message: 'no order found for this apex' };
  if (row.status === 'issued') {
    return {
      status: 'issued',
      notBefore: row.notBefore?.toISOString(),
      notAfter: row.notAfter?.toISOString(),
    };
  }

  const challengeRecords = row.challengeRecords as { name: string; value: string }[];
  const dnsChecks = await checkDns(challengeRecords);
  const allDnsReady = dnsChecks.every((c) => c.found);

  if (!allDnsReady) {
    return { status: 'awaiting_dns', dnsChecks, allDnsReady: false };
  }

  await db()
    .update(schema.wildcardCerts)
    .set({ status: 'verifying', updatedAt: new Date() })
    .where(eq(schema.wildcardCerts.apex, apex));

  const decrypted = decryptJson(row.accountKeyPem, loadMasterKey()) as { pem: string };
  const client = new acme.Client({
    directoryUrl: DIRECTORY_URL,
    accountKey: Buffer.from(decrypted.pem, 'utf8'),
  });

  if (!row.orderUrl) {
    await db()
      .update(schema.wildcardCerts)
      .set({ status: 'failed', lastError: 'no order URL — re-initiate', updatedAt: new Date() })
      .where(eq(schema.wildcardCerts.apex, apex));
    return { status: 'failed', message: 'no order URL — re-initiate the request' };
  }

  try {
    await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${row.accountEmail}`] });
    const order = await client.getOrder({ url: row.orderUrl } as acme.Order);
    const authorizations = await client.getAuthorizations(order);

    for (const authz of authorizations) {
      if (authz.status === 'valid') continue;
      const dnsChallenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (!dnsChallenge) throw new Error(`no dns-01 challenge for ${authz.identifier.value}`);
      await client.completeChallenge(dnsChallenge);
      await client.waitForValidStatus(dnsChallenge);
    }

    const [keyPem, csr] = await acme.crypto.createCsr({
      commonName: apex,
      altNames: [apex, `*.${apex}`],
    });

    const finalized = await client.finalizeOrder(order, csr);
    const certPem = await client.getCertificate(finalized);
    const { notBefore, notAfter } = parseCertValidity(certPem);

    await writeCertFiles(apex, certPem, keyPem.toString('utf8'));

    const encryptedKeyPem = encryptJson({ pem: keyPem.toString('utf8') }, loadMasterKey());

    await db()
      .update(schema.wildcardCerts)
      .set({
        status: 'issued',
        certPem,
        keyPem: encryptedKeyPem,
        notBefore,
        notAfter,
        issuedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.wildcardCerts.apex, apex));

    // Mark in-progress renewal event as success
    const orgId = row.orgId;
    await db()
      .update(schema.certRenewalEvents)
      .set({ outcome: 'success', certNotAfter: notAfter, finishedAt: new Date() })
      .where(
        and(
          eq(schema.certRenewalEvents.certId, row.id),
          eq(schema.certRenewalEvents.outcome, 'in_progress'),
        ),
      );

    await db().insert(schema.auditLog).values({
      actorUserId: null,
      action: 'tls.issued',
      targetKind: 'wildcard_cert',
      targetId: row.id,
      payload: { apex, notAfter: notAfter.toISOString() },
    });

    return { status: 'issued', notBefore: notBefore.toISOString(), notAfter: notAfter.toISOString() };
  } catch (err) {
    const message = (err as Error).message;
    await db()
      .update(schema.wildcardCerts)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(eq(schema.wildcardCerts.apex, apex));

    await db()
      .update(schema.certRenewalEvents)
      .set({ outcome: 'failure', errorMessage: message, finishedAt: new Date() })
      .where(
        and(
          eq(schema.certRenewalEvents.certId, row.id),
          eq(schema.certRenewalEvents.outcome, 'in_progress'),
        ),
      );

    return { status: 'failed', message };
  }
}

// ─── Per-Project HTTP-01 Cert (feature 005 Option B) ───────────────────────
// In-memory map: ACME challenge token → key authorization. Populated when an
// order is initiated, consumed when LE hits /.well-known/acme-challenge/:token.
// The Fastify route in apps/api/src/routes/acme-challenge.ts reads this map.
export const acmeChallengeTokens = new Map<string, { keyAuth: string; expiresAt: number }>();

function pruneExpiredChallenges(): void {
  const now = Date.now();
  for (const [token, entry] of acmeChallengeTokens) {
    if (entry.expiresAt < now) acmeChallengeTokens.delete(token);
  }
}

/**
 * Issue (or re-issue) a per-project cert for `db.<ref>.<apex>` via HTTP-01.
 * Returns the row from `pg_edge_certs` after success. Throws on failure.
 *
 * Reuses the ACME account key from the wildcard cert (same LE account, fewer
 * rate-limit headaches). Caller is responsible for ensuring the wildcard
 * cert exists (we assert it does).
 */
export async function issuePerProjectCert(
  instanceRef: string,
  apex: string,
): Promise<{ hostname: string; notAfter: Date }> {
  pruneExpiredChallenges();
  const hostname = `db.${instanceRef}.${apex}`;

  // Pull the ACME account key from wildcard_certs (same LE account).
  const [wc] = await db()
    .select({ accountKeyPem: schema.wildcardCerts.accountKeyPem, email: schema.wildcardCerts.accountEmail })
    .from(schema.wildcardCerts)
    .where(eq(schema.wildcardCerts.apex, apex))
    .limit(1);
  if (!wc?.accountKeyPem) {
    throw new Error(`per-project cert: wildcard cert for ${apex} must exist first`);
  }
  const { pem: accountKeyPemStr } = decryptJson(wc.accountKeyPem, loadMasterKey()) as { pem: string };

  // Upsert pg_edge_certs row with status='pending'.
  await db()
    .insert(schema.pgEdgeCerts)
    .values({ instanceRef, hostname, status: 'pending', lastAttemptAt: new Date() })
    .onConflictDoUpdate({
      target: schema.pgEdgeCerts.hostname,
      set: { status: 'pending', lastError: null, lastAttemptAt: new Date(), updatedAt: new Date() },
    });

  const client = new acme.Client({
    directoryUrl: DIRECTORY_URL,
    accountKey: Buffer.from(accountKeyPemStr, 'utf8'),
  });
  await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${wc.email}`] });

  let certPem: string;
  let keyPemStr: string;
  try {
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: hostname }],
    });
    const authorizations = await client.getAuthorizations(order);

    for (const authz of authorizations) {
      const httpChallenge = authz.challenges.find((c) => c.type === 'http-01');
      if (!httpChallenge) throw new Error(`no http-01 challenge for ${authz.identifier.value}`);
      const keyAuth = await client.getChallengeKeyAuthorization(httpChallenge);
      acmeChallengeTokens.set(httpChallenge.token, {
        keyAuth,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      try {
        await client.completeChallenge(httpChallenge);
        await client.waitForValidStatus(httpChallenge);
      } finally {
        acmeChallengeTokens.delete(httpChallenge.token);
      }
    }

    const [keyPemBuf, csr] = await acme.crypto.createCsr({ commonName: hostname, altNames: [hostname] });
    const finalized = await client.finalizeOrder(order, csr);
    certPem = await client.getCertificate(finalized);
    keyPemStr = keyPemBuf.toString('utf8');
  } catch (err) {
    const msg = (err as Error).message;
    await db()
      .update(schema.pgEdgeCerts)
      .set({ status: 'failed', lastError: msg, updatedAt: new Date() })
      .where(eq(schema.pgEdgeCerts.hostname, hostname));
    throw err;
  }

  const { notBefore, notAfter } = parseCertValidity(certPem);
  const encryptedKey = encryptJson({ pem: keyPemStr }, loadMasterKey());
  await db()
    .update(schema.pgEdgeCerts)
    .set({
      certPem,
      keyPem: encryptedKey,
      notBefore,
      notAfter,
      status: 'issued',
      lastError: null,
      lastIssuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.pgEdgeCerts.hostname, hostname));

  // Notify pg-edge-proxy to invalidate its cert cache for this ref.
  const rpub = getRedisPub();
  if (rpub) {
    try {
      await rpub.connect().catch(() => undefined);
      await rpub.publish('selfbase:pg-edge-cert:issued', JSON.stringify({ ref: instanceRef, hostname }));
    } catch { /* non-fatal */ }
  }

  return { hostname, notAfter };
}
