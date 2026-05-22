import tls from 'node:tls';

export interface CertProbeResult {
  reachable: boolean;
  issued: boolean;
  issuer?: string;
  subject?: string;
  notAfter?: string;
  selfSigned?: boolean;
  error?: string;
}

/**
 * Opens a TLS connection to our own :443 with the given SNI and inspects
 * the certificate. Connects to the `caddy` container hostname (resolvable
 * inside the docker network) so:
 *   - we don't loop through the public IP (works behind NAT, single host),
 *   - the SNI handshake triggers Caddy's on-demand TLS if no cert exists
 *     yet — which is what we want for a "ready?" probe.
 *
 * Lifted from /Users/lord/Code/open-frontend/apps/api/src/services/cert-probe.ts.
 */
export async function probeHttpsCert(apex: string, host = 'caddy'): Promise<CertProbeResult> {
  return new Promise<CertProbeResult>((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: apex,
        timeout: 10_000,
        rejectUnauthorized: false, // we inspect the cert manually
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          if (!cert || Object.keys(cert).length === 0) {
            resolve({ reachable: true, issued: false, error: 'no peer certificate' });
            socket.end();
            return;
          }
          const issuer = cert.issuer?.CN ?? cert.issuer?.O;
          const subject = cert.subject?.CN;
          const selfSigned = cert.issuer && cert.subject && cert.issuer.CN === cert.subject.CN;
          // Caddy serves a self-signed "fallback" cert when on-demand fails
          // (e.g. /internal/tls/ask said no, or ACME rejected). Treat anything
          // not issued by a real CA as not-yet-issued.
          const issued = !!issuer && !!subject && !selfSigned;
          resolve({
            reachable: true,
            issued,
            issuer: typeof issuer === 'string' ? issuer : undefined,
            subject: typeof subject === 'string' ? subject : undefined,
            notAfter: cert.valid_to,
            selfSigned: !!selfSigned,
          });
        } finally {
          socket.end();
        }
      },
    );
    socket.on('error', (err) => {
      resolve({ reachable: false, issued: false, error: err.message });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ reachable: false, issued: false, error: 'timeout' });
    });
  });
}
