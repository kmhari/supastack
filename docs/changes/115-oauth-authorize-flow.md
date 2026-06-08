# Feature 115 — Supabase-Style OAuth Authorize Flow

**Branch**: `115-oauth-authorize-flow` · **Spec**: [specs/115-oauth-authorize-flow/spec.md](../../specs/115-oauth-authorize-flow/spec.md)

## What changed

Replaced the inline-HTML OAuth consent form with a server-side session + redirect
to the **existing upstream Studio consent page** (`apps/studio/pages/authorize.tsx`,
served at `https://<apex>/dashboard/authorize`). The MCP OAuth flow now matches
Supabase Cloud's three-stage shape.

### The flow

```
MCP client                api (this feature)              Studio (upstream)        client callback
   │  GET api.<apex>/v1/oauth/authorize?…  │                      │                      │
   │ ────────────────────────────────────▶ │ validate + store     │                      │
   │                                        │ Redis session (10m)  │                      │
   │  303 → <apex>/dashboard/authorize?auth_id=UUID                │                      │
   │ ──────────────────────────────────────────────────────────▶ │ withAuth gate        │
   │                                        │  GET /platform/oauth/authorizations/:id     │
   │                                        │ ◀──────────────────── │ render consent      │
   │   operator clicks Authorize            │                      │                      │
   │                                        │  POST …/organizations/:slug/oauth/          │
   │                                        │    authorizations/:id?skip_browser_redirect=true
   │                                        │ ◀──────────────────── │                      │
   │                                        │ consume session +    │                      │
   │                                        │ issueCode → { url }  │                      │
   │                                        │ ─────────────────────────────────────────▶ │ ?code=&state=
```

## Endpoints

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/v1/oauth/authorize` | none | Validate OAuth 2.1 PKCE params → store Redis session → `303` to `<apex>/dashboard/authorize?auth_id=…`. GET-only (the old `POST` form handler is removed). |
| GET | `/platform/oauth/authorizations/:id` | `oauth.consent.read` (any member) | Return `{ name, website, icon, domain, scopes[], expires_at, approved_at, approved_organization_slug }`; `404` if missing/expired. |
| POST | `/platform/organizations/:slug/oauth/authorizations/:id` | `oauth.consent.approve` (owner/admin) | Consume session, `issueCode`, audit `oauth.code.issued`. `?skip_browser_redirect=true` → `201 { url }`; else `302`. `404` if consumed/missing. |
| DELETE | `/platform/organizations/:slug/oauth/authorizations/:id` | `oauth.consent.approve` (owner/admin) | Consume session, audit `oauth.consent.denied`, `200 { id }`. |

## Code

- **New** `apps/api/src/services/oauth-auth-sessions-store.ts` — Redis CRUD (`createAuthSession`/`getAuthSession`/`consumeAuthSession`), key `oauth:auth_session:<uuid>`, `EX 600 NX`, atomic `GETDEL` for single-use/replay protection.
- **Rewrote** `apps/api/src/routes/oauth/authorize.ts` — GET-only; removed `POST` handler, `renderConsentHtml`, `resolveOperator`, login redirect.
- **Converted 3 stubs** in `apps/api/src/routes/platform-misc.ts` (GET details, POST approve, DELETE deny) + `emitConsentAudit` helper.
- **RBAC** `packages/shared/src/rbac.ts` — `oauth.consent.read` (READ_ONLY tier), `oauth.consent.approve` (ADMIN_EXTRA tier). Snapshot in `apps/api/tests/contract/rbac.test.ts` regenerated.

## Security properties

- **Single-use**: `GETDEL` consumes the session atomically — replay returns `404`.
- **Time-bounded**: 10-minute Redis TTL (`FR-007`).
- **Clean URL**: only `?auth_id=UUID` reaches the browser — no PKCE challenge / redirect_uri / state in history (`SC-002`).
- **No new secrets, no migration** — sessions are ephemeral Redis KV; `issueCode` and `POST /v1/oauth/token` are unchanged.

## Tests

`oauth-auth-sessions-store.test.ts` (6), `oauth-authorize.test.ts` (5), `oauth-platform-consent.test.ts` (7), `oauth-platform-consent-deny.test.ts` (3), `rbac.test.ts` (6) — **27 pass**. Each endpoint/service has happy + sad paths.

## Deploy

**Rebuild the `api` container only.** No migration, no Studio rebuild, no worker change.

```bash
rsync … && sudo docker compose build api && sudo docker compose up -d api
```

## Rollback

Revert the `api` image (the change is confined to the api container; Redis sessions self-expire in ≤10 min).

## Live verification

See [specs/115-oauth-authorize-flow/quickstart.md](../../specs/115-oauth-authorize-flow/quickstart.md): register a client, run the PKCE dance, browser-authorize → consent → callback, exchange the code for a token.
