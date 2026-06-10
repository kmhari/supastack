# CLI Setup

The unmodified upstream **`supabase` CLI** (≥ 2.72.7) works against supastack —
`login`, `link`, `db push/pull/diff`, `functions deploy`, `secrets set`,
`gen types`, `migration list/repair/fetch`, and more. No fork, no patch.

## Get a token

Use the master PAT from [First-Time Setup](First-Time-Setup), or mint one at
`https://<apex>/settings/tokens`. You can also run `supabase login` (device-code
flow) and authorize in the browser.

## Point the CLI at your apex (profile)

The CLI selects a deployment with a **profile** that points `api_url` at
`api.<apex>`:

```toml
# ~/.config/supastack/supastack.example.com.toml
name          = "supastack"
api_url       = "https://api.supastack.example.com"
dashboard_url = "https://supastack.example.com/dashboard"
project_host  = "supastack.example.com"
```

Then pass `--profile ~/.config/supastack/<apex>.toml` and
`SUPABASE_ACCESS_TOKEN=<pat>` on each command.

## Recommended: the zsh/bash wrapper

Drop a `.supastack` file at your project's git root (gitignore it):

```
token=sbp_your_pat_here
domain=supastack.example.com
```

Add the wrapper to `~/.zshrc` (full version in the repo `README.md` →
**CLI setup**). It auto-injects the token and auto-generates the profile on
first use, passing `--profile` automatically. Then just run `supabase …`
normally from inside the project.

## Example flow

```sh
cd my-project              # has a .supastack file at git root
supabase link --project-ref <ref>
supabase db push           # passwordless — PAT-authenticated
supabase functions deploy my-fn
supabase secrets set FOO=bar
supabase gen types typescript --linked > types.ts
```

## Switching back to Supabase Cloud

`cd` out of any directory containing a `.supastack` file, or pass
`--profile supabase` explicitly. If `~/.supabase/profile` is set as a global
default, delete it to switch deployments freely.

See [`docs/supabase-cli.md`](https://github.com/kmhari/selfbase/blob/main/docs/supabase-cli.md)
for the full connect-and-go guide.
