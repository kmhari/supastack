# Using the Supabase CLI with supastack

The unmodified upstream `supabase` CLI works against supastack. You don't install a fork, you don't apply a patch, you don't run a shim. You just configure the CLI with a small profile pointing at your supastack deployment, log in once with a personal access token, and from then on every `supabase` command you know — `functions deploy`, `functions list`, `secrets set`, `link`, `db push`, etc. — operates against your supastack project instead of Supabase Cloud.

This guide walks through the setup, the day-to-day flow, the known wrinkles, and the troubleshooting steps for the errors you might hit.

---

## Prerequisites

- **Supabase CLI ≥ 2.72.7** — verify with `supabase --version`. Install via `brew install supabase/tap/supabase`, `npm i -g supabase`, `scoop`, or any of the upstream paths.
- **A supastack deployment with an apex domain configured** — i.e. `/setup` complete with DNS pointing your apex (and its wildcard `*.<apex>`) at the host. Once setup is done, `https://<apex>/dashboard` should load.
- **A user account** on that deployment with at least one provisioned project.

> **Note on project refs.** The upstream Supabase CLI validates project refs client-side against the regex `^[a-z]{20}$` (20 lowercase letters, no digits). Supastack generates CLI-compatible refs from this guide onward, but if you have **pre-existing instances created with a digit-bearing ref**, the CLI will refuse to interact with them (`Invalid project ref format`). Re-create those instances under a current supastack build to get CLI-compatible refs.

---

## One-time setup

### 1. Save the supastack profile snippet

Supastack exposes a profile snippet at `https://<apex>/api/v1/cli/profile.toml` (you can also click "Connect CLI" in the dashboard to get the same content). Drop it under `~/.supabase/profiles/`:

```bash
mkdir -p ~/.supabase/profiles
curl -fsSL https://<apex>/api/v1/cli/profile.toml > ~/.supabase/profiles/supastack.toml
cat ~/.supabase/profiles/supastack.toml
```

You should see something like:

```toml
name          = "supastack"
api_url       = "https://api.<apex>"
dashboard_url = "https://<apex>/dashboard"
project_host  = "<apex>"
```

### 2. Mint a personal access token (PAT)

Go to **Account → Access Tokens** at `https://<apex>/dashboard/account/tokens` and create a token. The plaintext is shown **once** — copy it immediately. The format is `sbp_` followed by 40 lowercase hex characters; this is what the upstream CLI expects.

Alternatively, skip manual minting entirely: `supabase login` without `--token` opens the browser and mints one for you (see step 3).

### 3. Log in

```bash
supabase login --profile ~/.supabase/profiles/supastack.toml --token <paste-the-PAT-here>
```

Plain `supabase login` (no `--token`) also works: it opens your browser to the
deployment's dashboard, which mints a token for the CLI automatically after you
authorize — the same device-login flow as Supabase Cloud.

You'll see:

```
You are now logged in. Happy coding!
```

This stores the PAT in your OS keyring keyed by the profile name `supastack`. From now on, commands run with `--profile ~/.supabase/profiles/supastack.toml` pick up the token automatically — you don't need to set `SUPABASE_ACCESS_TOKEN` or pass `--token` again.

### 4. (Optional) Skip `--profile` on every command

By default the CLI's `--profile` flag is set to the literal string `"supabase"` (the cloud profile), and that default _wins_ even if you've written a path into `~/.supabase/profile`. So every command you run against supastack needs `--profile ~/.supabase/profiles/supastack.toml` somewhere.

There's a way to skip that. The CLI auto-binds every flag to a `SUPABASE_<NAME>` environment variable via Cobra's automatic-env feature. Set the env var once in your shell rc:

```bash
# ~/.zshrc or ~/.bashrc
export SUPABASE_PROFILE="$HOME/.supabase/profiles/supastack.toml"
```

After that, plain `supabase <whatever>` uses supastack without any flag. `supabase --profile supabase <whatever>` (or any other explicit `--profile`) still overrides if you want to hit cloud or another deployment.

This step is **purely a convenience**. Every command in this guide also works with `--profile <path>` if you'd rather keep the env clean.

---

## Daily workflow

Inside any directory that has a `supabase/` folder (i.e., a project scaffolded with `supabase init`):

```bash
# Bind this directory to a supastack project. Run ONCE per directory.
supabase link --project-ref <your-project-ref>
# (with the env var skipped above; otherwise prepend --profile)

# Deploy an edge function.
supabase functions deploy hello

# List, download, delete.
supabase functions list
supabase functions download hello
supabase functions delete hello

# Manage runtime secrets.
supabase secrets set STRIPE_KEY=sk_test_...
supabase secrets list
supabase secrets unset STRIPE_KEY
```

`supabase link` writes the project ref to `.supabase/.temp/project-ref` inside that directory, so subsequent commands don't need `--project-ref`.

`supabase login`'s PAT lives in the OS keyring under the active profile name (`supastack`), so subsequent commands don't need `SUPABASE_ACCESS_TOKEN`.

The cleanest fully-configured flow is **zero flags**:

```bash
# (assumes step 4 above)
cd ~/my-app
supabase link --project-ref oxbqvjpyvbwqfeqhgipa
supabase functions deploy hello
```

---

## Function deploys — two paths

The CLI has two deploy mechanisms; supastack supports both.

### Default — bundle locally with Docker

```bash
supabase functions deploy hello
```

The CLI spins up a `supabase/edge-runtime` Docker container, bundles your function into a Brotli-compressed eszip locally, and uploads the resulting binary to supastack. Supastack decompresses it and hands the resulting ESZIP2.x bytes to the edge runtime via `EdgeRuntime.userWorkers.create({maybeEszip})`. This is the same format Supabase Cloud uses; the function loads cold-start-fast.

**Requires Docker running on your machine.**

### `--use-api` — let supastack handle source

```bash
supabase functions deploy hello --use-api
```

The CLI skips local bundling and ships the raw source files via `multipart/form-data`. Supastack writes them to the per-instance functions volume and the runtime loads them directly. **Doesn't require Docker** — useful on CI runners that don't have it, airgapped environments, or any machine where pulling the `supabase/edge-runtime` image is impractical.

Both paths end up with the same function reachable at the same public URL; the difference is purely in the bundle wire format.

---

## Public function URL

A deployed function is reachable at:

```
https://<project-ref>.<apex>/functions/v1/<slug>
```

For example with the project ref `oxbqvjpyvbwqfeqhgipa` on apex `supastack.example.com`:

```bash
curl https://oxbqvjpyvbwqfeqhgipa.supastack.example.com/functions/v1/hello \
  -H "Authorization: Bearer <anon-key>"
```

The anon key comes from the dashboard's project **API Keys** page, or via `supabase projects api-keys --project-ref <ref>`.

JWT verification is on by default. To deploy a function that doesn't require auth, set `verify_jwt = false` in your function's metadata (the CLI exposes this; see upstream docs for the syntax).

---

## What works, what doesn't

supastack implements a strict, drift-resistant subset of the Supabase Management API — enough to support the daily app-development workflow, not enough to mirror every dashboard control surface. If a command isn't listed below as supported, you'll get a `501 not_implemented` envelope when the CLI tries to reach the corresponding endpoint.

### Supported

- `supabase login`
- `supabase projects list`
- `supabase projects api-keys`
- `supabase link --project-ref <ref>`
- `supabase functions deploy [slug] [--use-api]`
- `supabase functions list`
- `supabase functions download <slug> [--use-api]`
- `supabase functions delete <slug>`
- `supabase secrets list`
- `supabase secrets set <k>=<v>...`
- `supabase secrets unset <k>`
- `supabase gen types typescript`
- `supabase migration list` / `migration repair` / `migration fetch`
- `supabase db query --linked` / `supabase db dump`
- DB-level commands — `db push`, `db pull`, `db diff`, `inspect *`. These connect directly to Postgres at `db.<ref>.<apex>:5432`. **No `--db-url` and no `--password` required** — with just your PAT, supastack provisions a short-lived login role for the connection, the same passwordless flow as Supabase Cloud. The legacy `--password` / `SUPABASE_DB_PASSWORD` path also still works. For full validation, run `bash tests/cli-e2e/db-push.sh` from a source checkout.

Supastack exposes Postgres at two endpoints (matching Supabase Cloud's architecture):

- **`db.<ref>.<apex>:5432`** — direct Postgres. Standard clients (psql, libpq, `supabase` CLI, every Postgres ORM) connect with `sslmode=require` and username `postgres`. Handled by a small custom STARTTLS+SNI proxy inside the supastack api container. This is what `supabase db push` uses.
- **`pooler.<apex>:6543`** — multi-tenant connection pooler (Supavisor) for apps that need pooling (high-traffic clients, serverless functions). Uses the Supabase Cloud pooler username convention: `postgres.<ref>` (project ref as suffix).

### Not yet

- `supabase branches *` (preview branches)
- `supabase domains *` / `supabase vanity-subdomain *`
- `supabase postgres-config *`
- `supabase network-restrictions *` / `supabase network-bans *`
- `supabase ssl-enforcement *`
- `supabase advisors *`

---

## Troubleshooting

### `Invalid access token format. Must be like sbp_0102...1920.`

The CLI validates tokens client-side against the regex `^sbp_(oauth_)?[a-f0-9]{40}$` before any network call. Your token doesn't match — likely it's the older `sb_<hex64>` format from a pre-CLI-compat supastack build, or you pasted something corrupted. Re-mint from the dashboard.

### `Invalid project ref format. Must be like abcdefghijklmnopqrst.`

The CLI's project-ref regex is `^[a-z]{20}$` — exactly 20 lowercase letters, no digits. Your ref contains a digit. Pre-CLI-compat supastack instances have refs like `4niq8t65h1bb0no97bol`; those won't work with the CLI. Provision a fresh instance via the dashboard (refs created now are letters-only by construction).

### `Authorization failed for the access token and project ref pair: {"message":"Not Found"}`

The CLI sent its `link` API calls to **Supabase Cloud** (`api.supabase.com`), not your supastack deployment. Almost always means `--profile` wasn't applied — the default `"supabase"` profile won.

Confirm with `--debug`:

```bash
supabase link --project-ref <ref> --debug 2>&1 | grep -i 'profile\|http get'
```

If you see `Using profile: supabase (supabase.co)` and `HTTP GET: https://api.supabase.com/...`, fix it by either:

- adding `--profile ~/.supabase/profiles/supastack.toml` to the command, or
- setting `export SUPABASE_PROFILE="$HOME/.supabase/profiles/supastack.toml"` in your shell rc (see step 4 above).

The correct debug output looks like `Using profile: supastack (<apex>)`.

### `unexpected deploy status 500: {"message":"Internal server error","code":"internal"}`

Supastack's logs will have the actual stack trace. Check via SSH:

```bash
ssh <vm> 'docker logs --tail 50 supastack-api-1 | grep -i err | tail -5'
```

Common causes seen in practice:

- **`EXDEV` cross-device link**: was a bug fixed in this codebase before launch — if you're seeing this now, it means the api container's `INSTANCES_DIR` env var doesn't match the bind-mounted volume path. Check `docker inspect supastack-api-1` and ensure `/var/supastack/instances` is mounted in.
- **Container restart timeout**: the deploy succeeded on disk but the per-instance `functions` container didn't come back healthy within 5s. Supastack rolls back automatically and emits `code: deploy_rolled_back`; check that container's logs.

### `Request body does not start with the ESZIP magic header` (`code: invalid_eszip`)

You're hitting a supastack build that pre-dates EZBR support. Update supastack to a current build.

### `unexpected update function status 413: ...`

The bundle exceeds supastack's 50 MB upload cap. Either prune the function's dependencies or, on a fork-y self-host, bump `bodyLimit` in `apps/api/src/server.ts`.

### `This management endpoint is not implemented in supastack` (`code: not_implemented`)

The CLI tried to reach an endpoint that's in the upstream cloud Management API but not in supastack's P0 subset. See "Not yet" above. The error envelope identifies the path in `details.path` so you know which endpoint was hit.

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

| CLI command                               | HTTP request                                                                                                        | Supastack handler                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `supabase login --token <PAT>`            | none (writes PAT to keyring)                                                                                        | —                                                         |
| `supabase projects list`                  | `GET /v1/projects`                                                                                                  | `apps/api/src/routes/management/projects.ts`              |
| `supabase link --project-ref <r>`         | `GET /v1/projects/<r>` + `GET /v1/projects/<r>/api-keys?reveal=true`                                                | projects.ts + api-keys.ts                                 |
| `supabase functions deploy <s>` (default) | `PATCH /v1/projects/<r>/functions/<s>?ezbr_sha256=...` (or `POST` for first deploy), body = `EZBR` + Brotli + eszip | functions.ts → function-deploy.ts (`deployFromEszip`)     |
| `supabase functions deploy <s> --use-api` | `POST /v1/projects/<r>/functions/deploy?slug=<s>`, multipart body                                                   | functions.ts → function-deploy.ts (`deployFromMultipart`) |
| `supabase functions list`                 | `GET /v1/projects/<r>/functions`                                                                                    | functions.ts                                              |
| `supabase functions download <s>`         | `GET /v1/projects/<r>/functions/<s>/body`                                                                           | functions.ts                                              |
| `supabase functions delete <s>`           | `DELETE /v1/projects/<r>/functions/<s>`                                                                             | functions.ts                                              |
| `supabase secrets list`                   | `GET /v1/projects/<r>/secrets`                                                                                      | `apps/api/src/routes/management/secrets.ts`               |
| `supabase secrets set K=V`                | `POST /v1/projects/<r>/secrets` (JSON array)                                                                        | secrets.ts → secret-store.ts (`setSecrets`)               |
| `supabase secrets unset K`                | `DELETE /v1/projects/<r>/secrets` (JSON array of names)                                                             | secrets.ts → secret-store.ts (`deleteSecrets`)            |

All authenticated calls carry `Authorization: Bearer sbp_<40hex>` and `User-Agent: SupabaseCLI/<version>`.

---

## Verifying a deployment

For operators after a fresh deploy or upgrade, two runbook items confirm the CLI surface is working end-to-end. Both require a live supastack deployment with at least one CLI-compatible (letters-only ref) project, a PAT minted from the dashboard, and the upstream `supabase` CLI on the runner. The second one additionally requires Docker on the runner.

### 1. Performance sanity

```bash
# Drive the canonical quickstart sequence, tee CLI output so you can grep
# for shape-mismatch errors (expect zero of these against a healthy
# deployment).
export SUPASTACK_APEX=<your-apex>
export SUPABASE_ACCESS_TOKEN=<your-PAT>
export SUPABASE_PROFILE=$HOME/.supabase/profiles/supastack.toml
export REF=<letters-only-project-ref>

LOG=/tmp/supastack-quickstart.log
mkdir -p /tmp/perf-test && cd /tmp/perf-test
mkdir -p supabase/functions/hello
cat > supabase/functions/hello/index.ts <<'EOF'
Deno.serve(() => new Response(Deno.env.get('PERF_KEY') ?? 'unset'));
EOF
echo 'project_id = "'"$REF"'"' > supabase/config.toml

# First deploy — budget: ≤15s end-to-end
{ time supabase link --project-ref "$REF" 2>&1; } 2>&1 | tee -a "$LOG"
{ time supabase functions deploy hello 2>&1; } 2>&1 | tee -a "$LOG"

# Repeat deploy — budget: ≤10s
{ time supabase functions deploy hello 2>&1; } 2>&1 | tee -a "$LOG"

# Secret propagation — budget: ≤5s for the new value to appear in the env
ANON=$(curl -sS "https://api.${SUPASTACK_APEX}/v1/projects/${REF}/api-keys" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | python3 -c 'import sys,json;k=[x for x in json.load(sys.stdin) if x["name"]=="anon"][0]["api_key"];print(k)')
supabase secrets set PERF_KEY=value-A 2>&1 | tee -a "$LOG"
sleep 5
curl -sS "https://${REF}.${SUPASTACK_APEX}/functions/v1/hello" -H "Authorization: Bearer $ANON"  # expect value-A
supabase secrets unset PERF_KEY 2>&1 | tee -a "$LOG"

# Shape-mismatch check: zero hits is the pass condition.
grep -cE 'Try rerunning the command with --debug|json: cannot unmarshal|Unexpected error' "$LOG"
```

Pass condition: every `time` line ≤ its budget; final `grep -c` returns `0`.

### 2. End-to-end CLI suite

```bash
SUPASTACK_APEX=<apex> \
SUPASTACK_PAT=<sbp_...> \
SUPASTACK_PROJECT_REF=<letters-only-ref> \
SUPASTACK_ANON_KEY=<anon-key-for-that-project> \
pnpm test:cli
```

The script (`tests/cli-e2e/deploy-hello.sh`) runs the full `login → link → deploy → curl → cleanup` flow in **both** the default (eszip + Docker) and `--use-api` (multipart) variants. Exits `0` on success. The eszip variant auto-skips when Docker isn't available on the runner.

## See also

- Your deployment's personalized CLI guide: `https://<apex>/docs/cli` (pre-filled
  with your apex + a shell wrapper that auto-injects the token and profile from a
  per-repo `.supastack` file)
- Upstream CLI source: [github.com/supabase/cli](https://github.com/supabase/cli)
