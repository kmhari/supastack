# Contract — installer domain capture (`install.sh`)

## Resolution order (priority, first non-empty wins)

1. **Positional argument** — `./install.sh supaviser.dev` → `$1`.
2. **Environment** — `SUPASTACK_APEX=supaviser.dev ./install.sh` (and `curl … | SUPASTACK_APEX=… bash`).
3. **Existing `.env`** — a `SUPASTACK_APEX=` line already in `$INSTALL_DIR/.env` (re-run path; never re-prompts).
4. **Interactive prompt** — read from **`/dev/tty`** (NOT stdin), so `curl … | bash` still prompts:
   ```sh
   if [ -r /dev/tty ]; then
     read -rp "Apex domain (e.g. supastack.example.com) [localhost]: " SUPASTACK_APEX < /dev/tty || true
   fi
   ```
5. **Warned fallback** — `localhost`, only when no domain supplied AND no readable `/dev/tty`. MUST emit a visible warning (e.g. "SUPASTACK_APEX defaulted to localhost — set a real domain for a public deployment").

## Persistence

- The resolved value MUST be written to `$INSTALL_DIR/.env` (the file compose reads via `${SUPASTACK_APEX}`), idempotently (back-fill if absent; keep existing). MUST NOT write to `~/.bashrc` or any shell rc.

## Testability

- Factor the priority logic into a pure helper (e.g. `resolve_apex "$ARG" "$ENV" "$DOTENV" "$TTY_INPUT"`) so a unit test asserts ordering without real I/O:
  - arg wins over env/dotenv/prompt; env wins over dotenv/prompt; dotenv wins over prompt; prompt wins over localhost; localhost only when all empty.
- A regression assertion MUST cover the `curl | bash` case: stdin is not a TTY but `/dev/tty` is readable → prompt still fires (no silent localhost).

## Non-goals

- No change to what the stack does with the domain after capture (boot model unchanged). The installer still performs a single `docker compose up` with the domain present in `.env`.
