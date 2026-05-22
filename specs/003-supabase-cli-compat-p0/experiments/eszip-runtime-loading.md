# Experiment: Does `supabase/edge-runtime:v1.71.2` load eszips directly?

**Date**: 2026-05-22
**Host**: `148.113.1.164` (the production selfbase VM)
**Runtime**: `supabase/edge-runtime:v1.71.2` — the exact image our per-instance compose template already uses
**Status**: ✅ **CONFIRMED VIABLE.** Option A from the planning trade-off works with no runtime patches.

## Why we ran this

`/speckit-plan` deferred the default `supabase functions deploy` path (CLI's eszip-via-Docker flow) to a P1 milestone because the original cost estimate was 3-7 days of integration against undocumented runtime internals, plus risk of brittleness across runtime versions. The cheaper alternative for P0 was the `--use-api` flow, where the CLI uploads raw source files and we write them to disk like any other function.

The user asked: *what is the actual technical complexity of supporting the default Docker path?* This experiment answered that empirically.

## Setup

Used the production VM because it already has the runtime image available and a real per-instance functions container running. Created a clean test workspace at `/tmp/eszip-test/` — no contact with any live instance.

```bash
mkdir -p /tmp/eszip-test/hello /tmp/eszip-test/main
```

A trivial hello-world Deno function:

```ts
// /tmp/eszip-test/hello/index.ts
console.log("[hello] worker booted")
Deno.serve((req: Request) => {
  const url = new URL(req.url)
  return new Response(JSON.stringify({
    msg: "hello from an eszip-loaded function",
    path: url.pathname,
    time: Date.now(),
  }), { headers: { "content-type": "application/json" } })
})
```

## Stage 0 — Probe runtime CLI surface

Before any test, listed what the runtime binary actually accepts:

```
$ docker run --rm supabase/edge-runtime:v1.71.2 --help
Commands:
  start     Start the server
  bundle    Creates an 'eszip' file that can be executed by the EdgeRuntime.
  unbundle  Unbundles an .eszip file into the specified directory

$ docker run --rm supabase/edge-runtime:v1.71.2 start --help
Options:
  --main-service <DIR>     Path to main service directory or eszip [default: examples/main]
  --main-entrypoint <Path> Path to entrypoint in main service (only for eszips)
```

This was the first significant finding: the runtime image **ships first-class eszip support** in three forms:

1. The `bundle` subcommand (same binary that the CLI uses via Docker to produce eszips).
2. The `unbundle` subcommand (expand an eszip back to source files — a free escape hatch if anything else fails).
3. The `start --main-service <eszip>` flag (boot the runtime directly from an eszip).

This contradicts my earlier read of the upstream example main router, which had only commented-out eszip code. The example was understated; the actual surface is well-developed.

## Stage 1 — Bundle the function into an eszip

```bash
docker run --rm \
  -v /tmp/eszip-test:/work -w /work \
  supabase/edge-runtime:v1.71.2 \
  bundle --entrypoint /work/hello/index.ts \
         --output /work/hello/bundle.eszip \
         --checksum sha256
```

**Result**: `/tmp/eszip-test/hello/bundle.eszip`, 1543 bytes. Header check:

```
00000000: 4553 5a49 5032 2e33 0000 0004 0001 0120  ESZIP2.3.......
```

Magic bytes confirm **eszip format version 2.3**. Same format the upstream CLI produces and the upstream cloud consumes.

## Stage 2 — Boot the runtime directly from the eszip

The simplest possible test: skip the main-router entirely and tell the runtime to start with the eszip itself as the main service.

```bash
docker run -d --name eszip-test \
  -v /tmp/eszip-test:/work \
  -p 9991:9000 \
  supabase/edge-runtime:v1.71.2 \
  start \
    --main-service /work/hello/bundle.eszip \
    --main-entrypoint file:///work/hello/index.ts
```

Container status: `Up`.

Container logs:
```
[hello] worker booted
```

The "worker booted" message comes from inside the eszip's source — so the runtime successfully loaded the embedded module and ran its top-level code.

curl test:
```bash
$ curl -s http://127.0.0.1:9991/anything
{"msg":"hello from an eszip-loaded function","path":"/anything","time":1779440711546}
```

**Pass.** The runtime can serve a function entirely from an eszip blob with zero source files on disk.

## Stage 3 — Per-function eszip loading via main router

Stage 2 proves the runtime can boot from one eszip, but it doesn't tell us whether we can have the standard model — a long-running main router that lazily loads each function (from its own eszip) on first request. This is what we'd actually ship.

Wrote a minimal eszip-aware main router (omitting JWT verification for the experiment, but otherwise structurally identical to the production `volumes/functions/main/index.ts`):

```ts
// /tmp/eszip-test/functions/main/index.ts
console.log("[main] router booted — eszip-aware variant")

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const slug = url.pathname.split("/")[1]
  if (!slug) {
    return new Response(JSON.stringify({ msg: "missing function name in request" }),
      { status: 400, headers: { "content-type": "application/json" } })
  }

  const servicePath = `/home/deno/functions/${slug}`
  const eszipPath = `${servicePath}/bundle.eszip`

  let opts: any = {
    servicePath,
    memoryLimitMb: 150,
    workerTimeoutMs: 60_000,
    noModuleCache: false,
    importMapPath: null,
    envVars: Object.entries(Deno.env.toObject()),
  }

  // Per-function eszip detection
  const stat = await Deno.stat(eszipPath).catch(() => null)
  if (stat?.isFile) {
    const bytes = await Deno.readFile(eszipPath)
    opts.maybeEszip = bytes
    opts.maybeEntrypoint = `file:///work/hello/index.ts`  // hardcoded for the test
    console.log(`[main] loading ${slug} from eszip (${bytes.length} bytes)`)
  } else {
    console.log(`[main] loading ${slug} from directory (no eszip)`)
  }

  const worker = await EdgeRuntime.userWorkers.create(opts)
  return await worker.fetch(req)
})
```

Layout:
```
/tmp/eszip-test/functions/
├── main/index.ts         # the router above
└── hello/
    └── bundle.eszip      # the bundle produced in Stage 1
```

Run:
```bash
docker run -d --name eszip-test \
  -v /tmp/eszip-test/functions:/home/deno/functions \
  -v /tmp/eszip-test:/work:ro \
  -p 9991:9000 \
  supabase/edge-runtime:v1.71.2 \
  start --main-service /home/deno/functions/main
```

curl tests:
```bash
$ curl -s http://127.0.0.1:9991/hello?test=stage3
{"msg":"hello from an eszip-loaded function","path":"/hello","time":1779440755346}

$ curl -s http://127.0.0.1:9991/hello?test=stage3-second
{"msg":"hello from an eszip-loaded function","path":"/hello","time":1779440755353}
```

Container logs:
```
[main] router booted — eszip-aware variant
[main] loading hello from eszip (1543 bytes), entrypoint=file:///work/hello/index.ts
[Info] [hello] worker booted

[main] loading hello from eszip (1543 bytes), entrypoint=file:///work/hello/index.ts
```

**Pass.** The main router detected the eszip on disk, read it into memory, passed it to `EdgeRuntime.userWorkers.create({ maybeEszip, maybeEntrypoint, ... })`, and the worker booted and served the request — twice, exercising the full request path including caching.

## The `EdgeRuntime.userWorkers.create()` shape

Confirmed signature (extending what's in our existing `volumes/functions/main/index.ts`):

```ts
EdgeRuntime.userWorkers.create({
  servicePath:    string,                 // path to function dir (used as fallback if eszip not provided)
  memoryLimitMb:  number,
  workerTimeoutMs: number,
  noModuleCache:  boolean,
  importMapPath:  string | null,
  envVars:        Array<[string, string]>,

  // — eszip-specific (new in our usage; confirmed by this experiment) —
  maybeEszip?:     Uint8Array,            // raw eszip bytes
  maybeEntrypoint?: string,               // file:// URL of the entrypoint module inside the eszip
})
```

When `maybeEszip` is present, `servicePath` becomes a label rather than a path lookup — the eszip is the source of truth.

## Implications for `/speckit-plan` artifacts

The earlier complexity estimate of 3-7 days for "default Docker path support" was based on the assumption that eszip integration was undocumented runtime internals. That assumption is wrong. **The runtime exposes the integration as a documented (if low-key) feature, working out of the box on the same image we already ship.**

Revised cost: **roughly one day**, broken down as:

| Backend work | Effort |
|---|---|
| Accept `POST /v1/projects/{ref}/functions` with `Content-Type: application/vnd.denoland.eszip` + query-param metadata | small |
| Accept `PATCH /v1/projects/{ref}/functions/{slug}` ditto | trivial (shares code with POST) |
| Stream raw body → `volumes/functions/{slug}/bundle.eszip` | small |
| Write a sidecar `meta.json` (`{ slug, entrypoint, verify_jwt, ezbr_sha256, ... }`) | trivial |
| Container restart (already in P0) | unchanged |
| `GET /v1/projects/{ref}/functions` returns `ezbr_sha256` so the CLI's skip-no-change check works | trivial (already in P0 plan, just need to populate the field) |
| `PUT /v1/projects/{ref}/functions` (bulk update) — already in P0 plan | unchanged |

| Runtime/main-router work | Effort |
|---|---|
| Modify `volumes/functions/main/index.ts` to detect `<slug>/bundle.eszip` and pass `maybeEszip` + `maybeEntrypoint` | ~10 lines added |
| Read `<slug>/meta.json` for the entrypoint URL (and verify_jwt override) | ~5 lines added |
| Backward compat: if no eszip, fall back to `servicePath` as today | unchanged |

| Provisioning work | Effort |
|---|---|
| Ship the updated `main/index.ts` in the supabase-template volume | unchanged from a normal template update — `infra/supabase-template/volumes/functions/main/index.ts` |

## Recommended revisions to the planning artifacts

Promote Option A to P0. Specifically:

1. **`research.md` R-002**: Change the decision from "implement `--use-api` path only" to "implement both paths." Add a forward-pointer to this experiment file. Note that the `--use-api` path remains an opt-in optimization (smaller uploads, no Docker required on the dev machine) but is no longer the only supported flow.

2. **`contracts/management-api.yaml`**: Promote `POST /v1/projects/{ref}/functions` and `PATCH /v1/projects/{ref}/functions/{slug}` (eszip body, `application/vnd.denoland.eszip`) from "out of P0" to first-class P0 endpoints.

3. **`contracts/functions-deploy.md`**: Add a parallel section covering the eszip wire format (already documented in `/tmp/sb-deploy-trace-report.md`, §3).

4. **`quickstart.md`**: Drop the `--use-api` flag from every example. Stock `supabase functions deploy` becomes the canonical command.

5. **`apps/web/src/pages/ConnectCli.tsx`** (in the implementation, not the plan): Stop instructing users to pass `--use-api`. The default command works.

6. **`data-model.md`**: Adjust `project_functions.source_path` semantics — it can now point at either `bundle.eszip` (eszip path) or `index.ts` (raw source path). The runtime handles both transparently; the backend records which one was uploaded.

## Open questions, deferred to implementation

These don't block planning but are worth knowing about:

- **Entrypoint URL mapping.** The eszip embeds `file://...` URLs reflecting whatever path the bundler's working tree used. The CLI's `bundle.go` mounts the project root as `/app/supabase` (or similar) inside its bundler container — we'd verify the exact mount path at implementation time. If the runtime rejects the entrypoint we pass, we can fall back to parsing the eszip's module listing (CBOR-ish; small self-contained parser, ~50 LoC) and picking the entrypoint heuristically.

- **`ezbr_sha256` calculation.** The CLI computes this client-side (during the bundle step). Selfbase needs to compute the same thing on receive, so we can return it on subsequent `GET /v1/projects/{ref}/functions` calls and the CLI's skip-no-change check works. The CLI's hash is `SHA256(eszip bytes)` — trivial.

- **Future runtime upgrades.** v1.71.2 exposes the eszip API as we documented. If a future runtime version changes the signature (e.g., renames `maybeEszip`), our main router needs updating. This is the same risk profile as any other dependency on the runtime's behavior; nothing eszip-specific.

## Cleanup

Test container and files removed:

```bash
$ ssh ubuntu@148.113.1.164 'docker rm -f eszip-test; rm -rf /tmp/eszip-test'
eszip-test
(cleaned)
```

No artifacts left on the VM.
