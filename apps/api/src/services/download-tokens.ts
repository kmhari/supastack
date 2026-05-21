import { createHmac, timingSafeEqual } from 'node:crypto';

const DOWNLOAD_TOKEN_TTL_SEC = 5 * 60; // 5 minutes

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET missing — cannot sign download token');
  return s;
}

/**
 * Sign a short-lived download URL token. Used for local-disk backups so the
 * dashboard can hand out a direct link that's safe to share for ~5 min but
 * can't be used forever or to access other backups.
 *
 * Token shape: `<backupId>.<exp>.<sigHex>` where sig = HMAC-SHA256(secret, "<backupId>.<exp>").
 * Secret is read at call time so tests can vary it and reloads pick up changes.
 */
export function signDownloadToken(backupId: string, ttlSec = DOWNLOAD_TOKEN_TTL_SEC): string {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${backupId}.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyDownloadToken(token: string, expectedBackupId: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [backupId, expStr, sig] = parts as [string, string, string];
  if (backupId !== expectedBackupId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', secret).update(`${backupId}.${expStr}`).digest('hex');
  // Constant-time compare
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
