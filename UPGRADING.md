# Upgrading the vendored Supabase template

Selfbase pins to a specific commit of `supabase/supabase` for two artifacts:

1. **The per-instance Docker Compose template** at `infra/supabase-template/`
   (the upstream `docker/` directory at that commit).
2. **The Studio image** built from `apps/studio/` at the _same_ commit, with
   `NEXT_PUBLIC_BASE_PATH=/studio` baked in. See `infra/studio/Dockerfile`.

The pin is recorded in `infra/supabase-template/COMMIT` (just the SHA).

## When to upgrade

- A Supabase release fixes a CVE.
- A Supabase release adds a feature you want.
- You hit a bug already fixed upstream.

## Steps

1. **Pick a target commit.** Browse releases at
   <https://github.com/supabase/supabase/releases>. Use the merge commit SHA
   for a tagged release.

2. **Bump the pin.**

   ```sh
   echo <new-commit-sha> > infra/supabase-template/COMMIT
   ```

3. **Re-vendor the docker template.**

   ```sh
   # sparse-clone — only the bits we need
   rm -rf /tmp/sb && git clone --depth=1 --filter=blob:none --sparse \
     https://github.com/supabase/supabase.git /tmp/sb
   cd /tmp/sb && git checkout $(cat $REPO/infra/supabase-template/COMMIT) \
     && git sparse-checkout set docker apps/studio packages/config packages/ui-patterns

   # Replace the vendored docker template
   rm -rf $REPO/infra/supabase-template/{docker-compose*,kong.yml,vector.yml,volumes,.env.example,dev,tests,utils,reset.sh}
   cp -r /tmp/sb/docker/. $REPO/infra/supabase-template/
   ```

4. **Sync the theme** (optional but recommended).

   See `apps/web/src/theme/README.md` for the lift list. Re-copy whichever
   bits you depend on from `/tmp/sb/packages/{config,ui-patterns}/`.

5. **Rebuild the Studio image** on every host:

   ```sh
   docker build \
     --build-arg SUPABASE_COMMIT="$(cat infra/supabase-template/COMMIT)" \
     -t selfbase/studio:$(cat infra/supabase-template/COMMIT) \
     -f infra/studio/Dockerfile \
     infra/studio/
   ```

   Update `STUDIO_IMAGE` in `/opt/selfbase/.env` to the new tag.

6. **Run the compose templater tests.** These catch upstream changes that
   add new required variables (the Multibase failure mode):

   ```sh
   pnpm --filter @selfbase/docker-control test
   ```

   If the test fails with `compose-template: N variable(s) referenced by the
upstream template have no value`, add the new vars to
   `packages/docker-control/src/compose-template.ts` (typically empty-string
   defaults are fine).

7. **Upgrade existing instances.** From the dashboard, click each
   instance's **Upgrade** button and supply the new commit SHA as the
   `supabaseVersion`. Toggle **Backup first** when the upgrade is risky.

   Or via API:

   ```sh
   curl -X POST https://<apex>/api/v1/instances/<ref>/upgrade \
     -H "authorization: Bearer $TOKEN" \
     -H "content-type: application/json" \
     -d '{"supabaseVersion":"<new-commit-sha>","backupFirst":true}'
   ```

   The worker:
   - (optional) enqueues a pre-upgrade backup
   - `docker compose pull` the per-instance project
   - `docker compose up -d` recreates the containers
   - polls until all containers are healthy (3-min cap)
   - updates `supabase_instances.supabase_version` to the new pin

## Rollback

Re-bump `COMMIT` to the previous SHA, rebuild Studio, and re-run upgrade on
the affected instances. The instance data is unchanged across upgrades
(volumes are preserved), so rolling forward and back is safe except across
Postgres major-version boundaries.

## Tests that catch upgrade breakage

- `packages/docker-control/tests/compose-template.test.ts` — completeness +
  $-rejection. Run on every PR.
- `tests/integration/provision-instance.test.ts` — the SupaConsole regression
  check. If a new Supabase release changes the auth or REST contract, this
  test will fail (the generated `anon_key` won't return 200).

Always run both suites before pushing a `COMMIT` bump to main.
