-- 0025 — create the `postgres` role GoTrue's upstream migrations GRANT to.
--
-- GoTrue (control-plane auth, feature 084) runs its own internal migrations at
-- boot; 20240612123726_enable_rls_update_grants does `GRANT SELECT ... TO
-- postgres WITH GRANT OPTION` — an upstream assumption that the superuser is
-- named `postgres`. Our control-plane DB is created with POSTGRES_USER=
-- supastack, so a fresh database has no `postgres` role and auth crash-loops
-- (caught on the first pull-mode install, shipfan.xyz 2026-06-11; the
-- supaviser.dev VM was masked by a hand-created role). NOLOGIN — it exists
-- only to receive GoTrue's grants. Idempotent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
end
$$;
