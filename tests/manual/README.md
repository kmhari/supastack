# Manual tests

Browser-driven tests that require an operator's hands and eyes — flows
that need real OAuth provider consent, real email/SMS deliverability,
real CLI device approval, etc. Not runnable in CI.

Each subdirectory ships a single-file harness (HTML / shell script) plus
documented usage so the operator can spin it up against a live selfbase
project without standing up extra scaffolding.

## Index

| Tool | Purpose |
|---|---|
| [`oauth-test/`](./oauth-test/) | Single-page `supabase-js` harness for verifying a project's OAuth provider configuration end-to-end. Pre-filled for the current default test project; localStorage purged on cold load so stale PKCE state doesn't poison the run. Used during the live-VM smoke for feature 022 (URL Configuration page) to confirm a `redirect_to` of `http://localhost:8765/` is honored once it's in the allow-list. |
