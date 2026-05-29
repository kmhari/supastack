/**
 * Mock API server for testing the /setup wizard locally.
 * Simulates the 3-step setup wizard:
 *   Step 1: Admin account creation
 *   Step 2: Domain + Certs (DNS verify → parallel cert issuance → HTTPS check)
 *   Step 3: CLI onboarding (shown on new domain via ?step=4)
 *
 * Run: node scripts/mock-setup-server.mjs
 * Reset state: restart this server
 */
import http from 'node:http';

// ── State ──────────────────────────────────────────────────────────────────
let setupDone = false;
let apex = null;
let dnsResolved = false;
let certIssued = false;
let wildcardChallengeSent = false;
let wildcardCertIssued = false;

// ── Helpers ────────────────────────────────────────────────────────────────
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function apexStatus() {
  return {
    apex,
    expectedIp: '1.2.3.4',
    observedIps: dnsResolved ? ['1.2.3.4'] : [],
    wildcardResolved: dnsResolved,
    wildcardObservedIps: dnsResolved ? ['1.2.3.4'] : [],
    dnsResolved,
    httpsReachable: certIssued && wildcardCertIssued,
    cert: certIssued
      ? { issued: true, issuer: "Let's Encrypt", notAfter: '2026-09-01', selfSigned: false }
      : { issued: false, selfSigned: false, error: null },
  };
}

// ── Router ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    res.end();
    return;
  }

  console.log(`[mock] ${method} ${url}`);

  // GET /api/v1/setup/status
  if (method === 'GET' && url === '/api/v1/setup/status') {
    return json(res, 200, { open: !setupDone });
  }

  // POST /api/v1/setup
  if (method === 'POST' && url === '/api/v1/setup') {
    if (setupDone) return json(res, 410, { error: { message: 'Setup already complete' } });
    const body = await readBody(req);
    console.log(`[mock]   email=${body.email} org=${body.orgName}`);
    setupDone = true;
    return json(res, 200, {
      userId: 'mock-user-id',
      orgId: 'mock-org-id',
      apiToken: 'sbp_mock_' + Math.random().toString(36).slice(2, 18),
    });
  }

  // GET /api/v1/auth/me  (called after setup to check auth state)
  if (method === 'GET' && url === '/api/v1/auth/me') {
    if (!setupDone) return json(res, 401, { error: 'unauthenticated' });
    return json(res, 200, { id: 'mock-user-id', email: 'admin@example.com', role: 'admin' });
  }

  // GET /api/v1/apex
  if (method === 'GET' && url === '/api/v1/apex') {
    return json(res, 200, apexStatus());
  }

  // POST /api/v1/apex/recheck  — simulate DNS resolving after 2nd recheck
  if (method === 'POST' && url === '/api/v1/apex/recheck') {
    if (apex) dnsResolved = true; // instantly resolve for demo
    return json(res, 200, apexStatus());
  }

  // POST /api/v1/apex/issue
  if (method === 'POST' && url === '/api/v1/apex/issue') {
    if (!dnsResolved) return json(res, 400, { error: { message: 'DNS not resolved yet' } });
    certIssued = true;
    return json(res, 200, apexStatus());
  }

  // POST /api/v1/apex/recheck already above — duplicate guard

  // PATCH /api/v1/org  (save apex domain)
  if (method === 'PATCH' && url === '/api/v1/org') {
    const body = await readBody(req);
    if (body.apexDomain) {
      apex = body.apexDomain;
      dnsResolved = false;
      certIssued = false;
      console.log(`[mock]   apex set to ${apex}`);
    }
    return json(res, 200, { id: 'mock-org-id', name: 'Selfbase', apexDomain: apex });
  }

  // POST /api/v1/wildcard-certs/initiate
  if (method === 'POST' && url === '/api/v1/wildcard-certs/initiate') {
    wildcardChallengeSent = true;
    return json(res, 200, {
      apex: apex ?? 'example.com',
      challengeRecords: [
        { name: `_acme-challenge.${apex ?? 'example.com'}`, value: 'mock-acme-token-abc123' },
        { name: `_acme-challenge.${apex ?? 'example.com'}`, value: 'mock-acme-token-xyz789' },
      ],
    });
  }

  // GET /api/v1/wildcard-certs/status
  if (method === 'GET' && url === '/api/v1/wildcard-certs/status') {
    if (wildcardCertIssued) {
      return json(res, 200, {
        cert: {
          status: 'issued',
          notAfter: '2026-09-01',
          allDnsReady: true,
          dnsChecks: [
            { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-abc123', found: true },
            { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-xyz789', found: true },
          ],
          challengeRecords: [
            { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-abc123' },
            { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-xyz789' },
          ],
        },
      });
    }
    const ready = wildcardChallengeSent && dnsResolved;
    return json(res, 200, {
      cert: {
        status: wildcardChallengeSent ? 'awaiting_dns' : 'pending',
        allDnsReady: ready,
        dnsChecks:
          wildcardChallengeSent && apex
            ? [
                { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-abc123', found: ready },
                { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-xyz789', found: ready },
              ]
            : [],
        challengeRecords:
          wildcardChallengeSent && apex
            ? [
                { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-abc123' },
                { name: `_acme-challenge.${apex}`, value: 'mock-acme-token-xyz789' },
              ]
            : [],
      },
    });
  }

  // POST /api/v1/wildcard-certs/verify
  if (method === 'POST' && url === '/api/v1/wildcard-certs/verify') {
    if (!dnsResolved)
      return json(res, 200, { status: 'awaiting_dns', allDnsReady: false, dnsChecks: [] });
    wildcardCertIssued = true;
    return json(res, 200, { status: 'issued', notAfter: '2026-09-01' });
  }

  // fallthrough
  console.log(`[mock]   404: ${method} ${url}`);
  json(res, 404, { error: 'not found' });
});

server.listen(3001, () => {
  console.log('\n🟢 Mock setup server running on http://localhost:3001');
  console.log('   Proxied by Vite at http://localhost:5173\n');
  console.log('   State resets: restart this server\n');
  console.log('   Steps covered (3-step redesign):');
  console.log('     1. Admin account creation → goes directly to Step 2 (no token reveal)');
  console.log('     2. Domain + Certs: enter apex → 4 DNS records shown → Recheck resolves DNS');
  console.log('        → Create Certs → apex + wildcard issued in parallel → HTTPS verified');
  console.log('     3. CLI onboarding: navigate to /setup?step=4 to test');
  console.log('');
  console.log('   Tip: Click "Recheck now" to auto-resolve DNS in the mock\n');
});
