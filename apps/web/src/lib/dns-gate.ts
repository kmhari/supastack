/**
 * Setup wizard "Create Certs" gate (feature 087 / fix #94).
 *
 * The gate opens only when the apex AND wildcard A-records resolve (server-side
 * flags) AND the backend's authoritative DNS-ready signal is true. `dnsReady` is
 * `cert.allDnsReady ?? false` at the call site — a missing/undefined signal is
 * `false`, so the gate stays closed (fail-safe, FR-006). This replaces the
 * brittle, captured-once client-side recount of per-record results.
 */
export function dnsGateReady(
  apexDnsOk: boolean,
  wildcardDnsOk: boolean,
  dnsReady: boolean,
): boolean {
  return apexDnsOk && wildcardDnsOk && dnsReady;
}
