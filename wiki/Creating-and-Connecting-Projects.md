# Creating & Connecting Projects

## Create a project

1. Open `https://<apex>/dashboard` and sign in.
2. **New project** → give it a name (optionally SMTP).
3. Wait ~60–90 s for status to reach **running**. Supastack provisions a full
   isolated stack (`supastack-<ref>-*`): Postgres, Auth, REST, Storage,
   Realtime, Edge Functions, Studio, Kong.

Each project gets a unique `<ref>` and real, working `anon` / `service_role`
keys (they authenticate on the first try).

## Connect to a project

Replace `<ref>` and `<apex>` accordingly.

| What | URL / DSN |
|---|---|
| **Project API (Kong)** | `https://<ref>.<apex>` |
| **REST** | `https://<ref>.<apex>/rest/v1/` |
| **Auth** | `https://<ref>.<apex>/auth/v1/` |
| **Storage** | `https://<ref>.<apex>/storage/v1/` |
| **Realtime** | `wss://<ref>.<apex>/realtime/v1/` |
| **Studio** | `https://<ref>.<apex>/studio` |
| **Postgres (direct)** | `postgresql://postgres:<pw>@db.<ref>.<apex>:5432/postgres` |
| **Postgres (pooled)** | `postgresql://postgres.<ref>:<pw>@pooler.<apex>:6543/postgres` |

Find the project's API keys and DB password on the project's dashboard pages.

### supabase-js

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://<ref>.<apex>',
  '<anon_key>'
)
```

## Lifecycle

From the dashboard you can **pause / resume / restart / upgrade / delete** a
project. Pausing stops the containers (frees RAM) and keeps data; resume brings
it back. Delete removes the stack and data (audited).

## Backups

- On-demand and daily automatic backups, per-project retention.
- Local disk by default; configure an S3-compatible store (MinIO / R2 / B2) in
  project settings.
- Restore from the dashboard (async `pg_restore` worker).

## Next

- [CLI Setup](CLI-Setup) — drive projects with the `supabase` CLI.
- [MCP Server](MCP-Server) — drive projects from your LLM editor.
