# @selfbase/docker-control

Per-instance Compose templater + dockerode wrappers.

## `compose-template.ts`

`renderInstanceEnv(inputs)` and `writeInstanceStack(inputs)`:

1. Reads the vendored `infra/supabase-template/.env.example`.
2. Parses every referenced variable.
3. Asserts that the typed input struct supplies a value for **every** one
   (anti-Multibase missing-variables regression).
4. Asserts that no value contains `$`, backtick, backslash, quote, or
   whitespace via `@selfbase/crypto`'s `assertSafeForEnv`
   (anti-Multibase `$GINIWZBA8` substitution regression).
5. Emits a sorted `.env` file.
6. Round-trips via `docker compose --env-file .env config -q` to confirm
   Compose parses it cleanly.

## `dockerode.ts`

Thin wrappers over `docker compose` (`composeUp/Down/Stop/Start/Restart/Pull`)
and dockerode-based inspection (`composePs`, `composeAllHealthy`, `composeExec`,
`composeExecStream`). All scoped to a `ComposeContext = { projectName, dir }`.

## Tests

```sh
pnpm --filter @selfbase/docker-control test
```

Anti-Multibase regression tests live in `tests/compose-template.test.ts`:

- `POSTGRES_PASSWORD` with `$` is rejected.
- Missing variables in the typed inputs (e.g., forgetting
  `DOCKER_SOCKET_LOCATION`) cause `renderInstanceEnv` to throw with a
  listing of missing names.
- Backtick, quote, whitespace in any value are rejected.

The actual `docker compose config -q` round-trip needs Docker available;
when the daemon is absent that test is OS-skipped by the harness, not a
silent fall-through.
