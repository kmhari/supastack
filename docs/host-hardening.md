# Host Hardening

Selfbase runs as a Docker stack on a single Ubuntu VM. The platform secures itself (TLS, RBAC, envelope-encrypted secrets, per-instance Postgres isolation) but it does **not** audit or harden the underlying host — that's the operator's responsibility.

If you're running selfbase on a production VM and care about compliance, the upstream Supabase organization publishes three small standalone tools you can run alongside selfbase. None of them are installed or wrapped by selfbase; you run them at your own discretion, on your own schedule, against your own host.

## Tools

### [supabase/sdaudit](https://github.com/supabase/sdaudit) — general host security audit

Runs a battery of standard security checks against an Ubuntu host (sshd config, kernel params, user accounts, file permissions, etc.). Useful as a first-pass sanity check after spinning up a new VM.

```bash
git clone https://github.com/supabase/sdaudit.git
cd sdaudit
sudo ./sdaudit.sh
```

### [supabase/ubuntu-cis-audit](https://github.com/supabase/ubuntu-cis-audit) — CIS benchmark compliance

Audits the host against the [CIS Ubuntu Benchmark](https://www.cisecurity.org/benchmark/ubuntu_linux) — the standard compliance checklist used by SOC 2 / ISO 27001 audits. Reports per-check pass/fail with remediation guidance.

```bash
git clone https://github.com/supabase/ubuntu-cis-audit.git
cd ubuntu-cis-audit
sudo ./audit.sh
```

### [supabase/ubuntu-nix-sbom](https://github.com/supabase/ubuntu-nix-sbom) — SBOM generation

Generates a Software Bill of Materials — a structured list of every package installed on the host, with versions. Required for many compliance frameworks (Executive Order 14028, EU CRA, etc.).

```bash
git clone https://github.com/supabase/ubuntu-nix-sbom.git
cd ubuntu-nix-sbom
sudo ./generate-sbom.sh > sbom.json
```

## Notes

- These tools operate at the **host OS level**, not against the selfbase stack. They won't audit your provisioned Supabase instances, your Postgres data, or your Caddy config.
- Run them as `root` (or via `sudo`) — they need to read protected files and config.
- They are not on a release cadence tied to selfbase. Check each upstream repo for the latest version before each audit cycle.
- For selfbase-specific operational concerns (wildcard TLS renewal, pooler drift, master-key rotation), see the per-feature runbooks under [`docs/changes/`](./changes).
