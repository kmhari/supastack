# tests/cli-e2e/helpers

Shared bash libraries sourced by `tests/cli-e2e/*.sh` scripts. Each helper file exports functions; consumers `source` the file at the top of their script.

## Convention

Functions are named `<area>_<verb>_<noun>` (e.g. `auth_config_assert_jwt_exp`, `auth_config_assert_oauth_authorize_302`). Each helper file has a leading docblock that lists the functions it exports and the env vars they require.

The harness for feature 020 introduces `auth-config-assertions.sh` — a dispatch table of per-field behavioral assertions used by `auth-config-behavioral-parity.sh` (one assertion per honored auth-config field). See `specs/020-auth-providers-dashboard/data-model.md` §5 for the canonical assertion list.
