# Contract — Apex source accessor + single-source invariant

## `@supastack/shared` accessor (new)

```ts
// packages/shared/src/apex.ts
export function getApex(): string | null;       // process.env.SUPASTACK_APEX ?? null
export function getApexOrThrow(): string;        // throws if unset/empty — for required paths
export function isRealApex(apex: string | null | undefined): boolean;
// true iff apex is set, !== 'localhost', and contains a '.'
```

**Behavioral contract**:
- `getApex()` returns the env value verbatim, or `null` when unset/empty.
- `getApexOrThrow()` throws a clear error when unset (used where a missing apex is a boot-time defect).
- `isRealApex('supaviser.dev') === true`; `isRealApex('localhost') === false`; `isRealApex('') === false`; `isRealApex(null) === false`; `isRealApex('myhost') === false` (no dot).

## Single-source invariant (contract test)

`apps/api/tests/contract/no-apex-domain-reader.test.ts` MUST fail if any production source (under `apps/*/src`, `packages/*/src`) references `installation.apexDomain` or `apex_domain` as a column, or imports the deleted `apex-resolver`. Allowed references: the migration SQL, this spec, and test files.

- **Pass condition**: zero matches of `installation.apexDomain` / `schema.installation.apexDomain` / `apex_domain` in production source; `apex-resolver` file does not exist.
- **Rationale**: structurally guarantees #110 cannot recur — there is exactly one source (env), greppably enforced.

## Reader behavior (unchanged outputs)

Every repointed reader MUST produce the **same** value it did when the DB and env agreed (which is the live state today). E.g. `buildCaddyConfig()` emits the same routes for `supaviser.dev`; `provision.ts` builds the same `<ref>.<apex>` hostnames. The change is the source, not the value.
