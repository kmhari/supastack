# Using the Supabase CLI with selfbase

The unmodified upstream `supabase` CLI works against selfbase. You don't install a fork, you don't apply a patch, you don't run a shim. You just configure the CLI with a small profile pointing at your selfbase deployment, log in once with a personal access token, and from then on every `supabase` command you know — `functions deploy`, `functions list`, `secrets set`, `link`, `db push`, etc. — operates against your selfbase project instead of Supabase Cloud.

This guide walks through the setup, the day-to-day flow, the known wrinkles, and the troubleshooting steps for the errors you might hit.

---

## Prerequisites

- **Supabase CLI ≥ 2.72.7** — verify with `supabase --version`. Install via `brew install supabase/tap/supabase`, `npm i -g supabase`, `scoop`, or any of the upstream paths.
- **A selfbase deployment with an apex domain configured** — i.e. `/setup` complete with DNS pointing your apex (and its wildcard `*.<apex>`) at the host. Once setup is done, `https://<apex>/dashboard` should load.
- **A user account** on that deployment with at least one provisioned project.

> **Note on project refs.** The upstream Supabase CLI validates project refs client-side against the regex `^[a-z]{20}$` (20 lowercase letters, no digits). Selfbase generates CLI-compatible refs from this guide onward, but if you have **pre-existing instances created with a digit-bearing ref**, the CLI will refuse to interact with them (`Invalid project ref format`). Re-create those instances under a current selfbase build to get CLI-compatible refs.

---

## One-time setup

### 1. Save the selfbase profile snippet

Selfbase exposes a profile snippet at `https://<apex>/api/v1/cli/profile.toml` (you can also click "Connect CLI" in the dashboard to get the same content). Drop it under `~/.supabase/profiles/`:

```bash
mkdir -p ~/.supabase/profiles
curl -fsSL https://<apex>/api/v1/cli/profile.toml > ~/.supabase/profiles/selfbase.toml
cat ~/.supabase/profiles/selfbase.toml
```

You should see something like:

```toml
name          = "selfbase"
api_url       = "https://api.<apex>"
dashboard_url = "https://<apex>/dashboard"
project_host  = "<apex>"
```

### 2. Mint a personal access token (PAT)

Go to **Dashboard → Tokens** at `https://<apex>/settings/tokens` and click **Create token**. The plaintext is shown **once** — copy it immediately. The format is `sbp_` followed by 40 lowercase hex characters; this is what the upstream CLI expects.

Alternatively, the Connect-CLI page (linked from the Tokens page) has a one-click **Generate token** button that surfaces the token in a copy-friendly dialog.

### 3. Log in

```bash
supabase login --profile ~/.supabase/profiles/selfbase.toml --token <paste-the-PAT-here>
```

You'll see:

```
You are now logged in. Happy coding!
```

This stores the PAT in your OS keyring keyed by the profile name `selfbase`. From now on, commands run with `--profile ~/.supabase/profiles/selfbase.toml` pick up the token automatically — you don't need to set `SUPABASE_ACCESS_TOKEN` or pass `--token` again.

### 4. (Optional) Skip `--profile` on every command

By default the CLI's `--profile` flag is set to the literal string `"supabase"` (the cloud profile), and that default *wins* even if you've written a path into `~/.supabase/profile`. So every command you run against selfbase needs `--profile ~/.supabase/profiles/selfbase.toml` somewhere.

There's a way to skip that. The CLI auto-binds every flag to a `SUPABASE_<NAME>` environment variable via Cobra's automatic-env feature. Set the env var once in your shell rc:

```bash
# ~/.zshrc or ~/.bashrc
export SUPABASE_PROFILE="$HOME/.supabase/profiles/selfbase.toml"
```

After that, plain `supabase <whatever>` uses selfbase without any flag. `supabase --profile supabase <whatever>` (or any other explicit `--profile`) still overrides if you want to hit cloud or another deployment.

This step is **purely a convenience**. Every command in this guide also works with `--profile <path>` if you'd rather keep the env clean.

---

## Daily workflow

Inside any directory that has a `supabase/` folder (i.e., a project scaffolded with `supabase init`):

```bash
# Bind this directory to a selfbase project. Run ONCE per directory.
supabase link --project-ref <your-project-ref>
# (with the env var skipped above; otherwise prepend --profile)

# Deploy an edge function.
supabase functions deploy hello

# List, download, delete.
supabase functions list
supabase functions download hello
supabase functions delete hello

# Manage runtime secrets.            (coming in P0.6 — secrets endpoints)
supabase secrets set STRIPE_KEY=sk_test_...
supabase secrets list
supabase secrets unset STRIPE_KEY
```

`supabase link` writes the project ref to `.supabase/.temp/project-ref` inside that directory, so subsequent commands don't need `--project-ref`.

`supabase login`'s PAT lives in the OS keyring under the active profile name (`selfbase`), so subsequent commands don't need `SUPABASE_ACCESS_TOKEN`.

The cleanest fully-configured flow is **zero flags**:

```bash
# (assumes step 4 above)
cd ~/my-app
supabase link --project-ref oxbqvjpyvbwqfeqhgipa
supabase functions deploy hello
```

---

## Function deploys — two paths

The CLI has two deploy mechanisms; selfbase supports both.

### Default — bundle locally with Docker

```bash
supabase functions deploy hello
```

The CLI spins up a `supabase/edge-runtime` Docker container, bundles your function into a Brotli-compressed eszip locally, and uploads the resulting binary to selfbase. Selfbase decompresses it and hands the resulting ESZIP2.x bytes to the edge runtime via `EdgeRuntime.userWorkers.create({maybeEszip})`. This is the same format Supabase Cloud uses; the function loads cold-start-fast.

**Requires Docker running on your machine.**

### `--use-api` — let selfbase handle source

```bash
supabase functions deploy hello --use-api
```

The CLI skips local bundling and ships the raw source files via `multipart/form-data`. Selfbase writes them to the per-instance functions volume and the runtime loads them directly. **Doesn't require Docker** — useful on CI runners that don't have it, airgapped environments, or any machine where pulling the `supabase/edge-runtime` image is impractical.

Both paths end up with the same function reachable at the same public URL; the difference is purely in the bundle wire format.

---

## Public function URL

A deployed function is reachable at:

```
https://<project-ref>.<apex>/functions/v1/<slug>
```

For example with the project ref `oxbqvjpyvbwqfeqhgipa` on apex `selfbase.example.com`:

```bash
curl https://oxbqvjpyvbwqfeqhgipa.selfbase.example.com/functions/v1/hello \
  -H "Authorization: Bearer <anon-key>"
```

The anon key comes from the dashboard's project **API Keys** page, or via `supabase projects api-keys --project-ref <ref>`.

JWT verification is on by default. To deploy a function that doesn't require auth, set `verify_jwt = false` in your function's metadata (the CLI exposes this; see upstream docs for the syntax).

---

## What works, what doesn't

selfbase implements a strict, drift-resistant subset of the Supabase Management API — enough to support the daily app-development workflow, not enough to mirror every dashboard control surface. If a command isn't listed below as supported, you'll get a `501 not_implemented` envelope when the CLI tries to reach the corresponding endpoint.

### Supported

- `supabase login`
- `supabase projects list`
- `supabase projects api-keys`
- `supabase link --project-ref <ref>`
- `supabase functions deploy [slug] [--use-api]`
- `supabase functions list`
- `supabase functions download <slug> [--use-api]`
- `supabase functions delete <slug>`
- `supabase secrets list` *(P0.6 — secrets endpoints; coming)*
- `supabase secrets set <k>=<v>...` *(P0.6)*
- `supabase secrets unset <k>` *(P0.6)*
- DB-level commands that take `--db-url` explicitly: `db push`, `db pull`, `db diff`, `migration *`, `inspect *`. These don't hit selfbase's management API at all — they connect directly to Postgres.

### Not yet (P1+)

- `supabase branches *` (preview branches)
- `supabase domains *` / `supabase vanity-subdomain *`
- `supabase postgres-config *`
- `supabase network-restrictions *` / `supabase network-bans *`
- `supabase ssl-enforcement *`
- `supabase advisors *`
- `supabase gen types typescript` (works if you pass `--db-url`; doesn't work via project ref alone — yet)
- `supabase db push/pull` *without* `--db-url` (would need DB host `db.<ref>.<apex>` to resolve and accept Postgres 5432; out of P0 scope)

---

## Troubleshooting

### `Invalid access token format. Must be like sbp_0102...1920.`

The CLI validates tokens client-side against the regex `^sbp_(oauth_)?[a-f0-9]{40}$` before any network call. Your token doesn't match — likely it's the older `sb_<hex64>` format from a pre-CLI-compat selfbase build, or you pasted something corrupted. Re-mint from the dashboard.

### `Invalid project ref format. Must be like abcdefghijklmnopqrst.`

The CLI's project-ref regex is `^[a-z]{20}$` — exactly 20 lowercase letters, no digits. Your ref contains a digit. Pre-CLI-compat selfbase instances have refs like `4niq8t65h1bb0no97bol`; those won't work with the CLI. Provision a fresh instance via the dashboard (refs created now are letters-only by construction).

### `Authorization failed for the access token and project ref pair: {"message":"Not Found"}`

The CLI sent its `link` API calls to **Supabase Cloud** (`api.supabase.com`), not your selfbase deployment. Almost always means `--profile` wasn't applied — the default `"supabase"` profile won.

Confirm with `--debug`:

```bash
supabase link --project-ref <ref> --debug 2>&1 | grep -i 'profile\|http get'
```

If you see `Using profile: supabase (supabase.co)` and `HTTP GET: https://api.supabase.com/...`, fix it by either:

- adding `--profile ~/.supabase/profiles/selfbase.toml` to the command, or
- setting `export SUPABASE_PROFILE="$HOME/.supabase/profiles/selfbase.toml"` in your shell rc (see step 4 above).

The correct debug output looks like `Using profile: selfbase (<apex>)`.

### `unexpected deploy status 500: {"message":"Internal server error","code":"internal"}`

Selfbase's logs will have the actual stack trace. Check via SSH:

```bash
ssh <vm> 'docker logs --tail 50 selfbase-api-1 | grep -i err | tail -5'
```

Common causes seen in practice:

- **`EXDEV` cross-device link**: was a bug fixed in this codebase before launch — if you're seeing this now, it means the api container's `INSTANCES_DIR` env var doesn't match the bind-mounted volume path. Check `docker inspect selfbase-api-1` and ensure `/var/selfbase/instances` is mounted in.
- **Container restart timeout**: the deploy succeeded on disk but the per-instance `functions` container didn't come back healthy within 5s. Selfbase rolls back automatically and emits `code: deploy_rolled_back`; check that container's logs.

### `Request body does not start with the ESZIP magic header` (`code: invalid_eszip`)

You're hitting a selfbase build that pre-dates EZBR support. Update selfbase — the fix landed during huntvox E2E.

### `unexpected update function status 413: ...`

The bundle exceeds selfbase's 50 MB upload cap. Either prune the function's dependencies or, on a fork-y self-host, bump `bodyLimit` in `apps/api/src/server.ts`.

### `This management endpoint is not implemented in selfbase` (`code: not_implemented`)

The CLI tried to reach an endpoint that's in the upstream cloud Management API but not in selfbase's P0 subset. See "Not yet" above. The error envelope identifies the path in `details.path` so you know which endpoint was hit.

### `Cannot find project ref. Have you run supabase link?`

You're running a per-project command without a linked project AND without `--project-ref`. Either:

```bash
supabase link --project-ref <ref>     # persists for this directory
# OR
supabase <whatever> --project-ref <ref>
```

---

## Behind the scenes

For the curious or for debugging, here's what the CLI is actually talking to:

| CLI command | HTTP request | Selfbase handler |
|---|---|---|
| `supabase login --token <PAT>` | none (writes PAT to keyring) | — |
| `supabase projects list` | `GET /v1/projects` | `apps/api/src/routes/management/projects.ts` |
| `supabase link --project-ref <r>` | `GET /v1/projects/<r>` + `GET /v1/projects/<r>/api-keys?reveal=true` | projects.ts + api-keys.ts |
| `supabase functions deploy <s>` (default) | `PATCH /v1/projects/<r>/functions/<s>?ezbr_sha256=...` (or `POST` for first deploy), body = `EZBR` + Brotli + eszip | functions.ts → function-deploy.ts (`deployFromEszip`) |
| `supabase functions deploy <s> --use-api` | `POST /v1/projects/<r>/functions/deploy?slug=<s>`, multipart body | functions.ts → function-deploy.ts (`deployFromMultipart`) |
| `supabase functions list` | `GET /v1/projects/<r>/functions` | functions.ts |
| `supabase functions download <s>` | `GET /v1/projects/<r>/functions/<s>/body` | functions.ts |
| `supabase functions delete <s>` | `DELETE /v1/projects/<r>/functions/<s>` | functions.ts |

All authenticated calls carry `Authorization: Bearer sbp_<40hex>` and `User-Agent: SupabaseCLI/<version>`.

---

## See also

- Spec: [`/specs/003-supabase-cli-compat-p0/spec.md`](../specs/003-supabase-cli-compat-p0/spec.md)
- Implementation plan: [`/specs/003-supabase-cli-compat-p0/plan.md`](../specs/003-supabase-cli-compat-p0/plan.md)
- Wire-format contracts: [`/specs/003-supabase-cli-compat-p0/contracts/`](../specs/003-supabase-cli-compat-p0/contracts/)
- Upstream CLI source: [github.com/supabase/cli](https://github.com/supabase/cli)
