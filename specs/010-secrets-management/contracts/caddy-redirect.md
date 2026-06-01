# Contract — Caddy redirect for Studio's `/functions/secrets`

**Scope**: `apps/caddy/Caddyfile` (per-deployment; rendered with `<apex>` substituted).

## Rule

```caddy
@studio_secrets {
  host_regexp studio_ref ^studio-(?P<ref>[a-z0-9]{20})\.<apex>$
  path /project/default/functions/secrets /project/default/functions/secrets/*
}
redir @studio_secrets https://<apex>/dashboard/project/{re.studio_ref.ref}/secrets?{query} 302
```

## Behavior

| Input | Output |
|---|---|
| `GET https://studio-abc123…20chars.<apex>/project/default/functions/secrets` | `302 Location: https://<apex>/dashboard/project/abc123…20chars/secrets?` |
| `GET https://studio-<ref>.<apex>/project/default/functions/secrets?preset=foo` | `302 Location: https://<apex>/dashboard/project/<ref>/secrets?preset=foo` |
| `GET https://studio-<ref>.<apex>/project/default/functions/secrets/anything` | `302 Location: https://<apex>/dashboard/project/<ref>/secrets?` |
| `GET https://studio-<ref>.<apex>/project/default/functions/my-fn` | Pass-through to Studio container (unchanged) |
| `GET https://studio-<ref>.<apex>/project/default/sql` | Pass-through to Studio container (unchanged) |
| `GET https://studio-<ref>.<apex>/anything-else` | Pass-through to Studio container (unchanged) |
| `GET https://<apex>/dashboard/...` | Pass-through to web container (unchanged) |

## Auth boundary

The redirect is unconditional (no Caddy-level auth check). The supastack dashboard's `/dashboard/project/<ref>/secrets` route applies normal session-cookie auth — unauthenticated visitors bounce to `/login?next=/dashboard/...` per the existing pattern.

Studio and the supastack dashboard share a session-cookie scope (both under `<apex>`), so an authenticated Studio user lands on the secrets page without re-auth.

## Manual verification

```bash
# Should 302 to dashboard
curl -sI -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://studio-<existing-ref>.<apex>/project/default/functions/secrets

# Should pass through to Studio (any non-200 from Studio itself is fine for this check)
curl -sI -o /dev/null -w '%{http_code}\n' \
  https://studio-<existing-ref>.<apex>/project/default/functions/some-other-page
```

## Contract test obligations

No unit test (Caddyfile is config, not code). Live verification on the VM after deploy is the gate — covered by US4 acceptance scenarios + the quickstart.md script.
