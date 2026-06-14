/* Supastack — feature map (the important page) */

const GROUP_A = [
  ['Multi-project provisioning', 'N isolated projects per host, dashboard-driven, ~60–90s'],
  ['Shared Studio dashboard', 'Platform mode, project list, org switcher, Cloud-parity URLs'],
  ['Accounts, organizations & RBAC', 'GoTrue auth; Owner / Administrator / Developer / Read-only; email invites'],
  ['Wildcard HTTPS + per-project subdomains', 'DNS-01 Let’s Encrypt *.<domain>; https://<ref>.<domain>'],
  ['Direct Postgres', 'db.<ref>.<domain>:5432 — SNI-multiplexed; per-project cert for strict-TLS clients'],
  ['Pooled Postgres', 'pooler.<domain>:6543 — Supavisor, Cloud’s postgres.<ref> username convention'],
  ['Supabase CLI compatibility', 'login, link, db push, db pull/diff, functions deploy, secrets set, gen types, migration list/repair/fetch'],
  ['Management API (/v1/*)', 'Wire-compatible subset, served at api.<domain>'],
  ['Hosted MCP server', 'mcp.<domain>/mcp + OAuth 2.1/PKCE; execute_sql, apply_migration, deploy_edge_function, get_logs, …'],
  ['Edge function deploys', 'Via CLI + MCP'],
  ['Edge function secrets', 'Vault-backed, ~5s live propagation, no container restart; dashboard + CLI'],
  ['Auth (GoTrue) configuration', '169 settings honored through dashboard / Management API, validated'],
  ['Auth providers UI', 'Email/phone + 21 OAuth provider configs in the dashboard'],
  ['Backups', 'On-demand + daily automatic, per-project retention, local disk or S3-compatible'],
  ['Restore', 'From the dashboard'],
  ['Project lifecycle', 'Pause / resume / restart / upgrade / delete, health-gated, audited'],
  ['Admin / ops console', 'Fleet, per-project resources, job queues, cert status, log access (read-only)'],
  ['Connection-pooler self-healing', 'Daily reconciler, 7 drift classes incl. PG password drift recovery'],
  ['Cert renewal alerts', 'Dashboard alert at 30 days'],
  ['Audit log', 'Destructive actions logged'],
  ['One-command install', 'Docker + secrets + image prewarm + guided DNS/TLS wizard'],
];

const GROUP_B = [
  ['Preview branches', 'Not yet'],
  ['Custom vanity domains per project', 'Planned'],
  ['supabase domains (custom hostnames CLI)', 'Planned'],
  ['postgres-config / auth-config CLI tunables', 'Partial / planned'],
  ['SSL-enforcement toggle', 'Planned'],
  ['Advisors (security / performance lint)', 'Not yet'],
  ['SQL snippets store + snippets list/download', 'Needs server-side store first'],
  ['Async backup list / restore worker', 'Planned (heavier)'],
  ['Auto wildcard-cert renewal (Cloudflare DNS API)', 'Spec’d, not implemented'],
  ['SAML SSO, CAPTCHA, MFA, SMS providers, custom OAuth server', 'Auth follow-ups, planned'],
];

const GROUP_C = [
  ['Billing, subscriptions & payment processing', 'It’s your hardware. There’s no one to pay.'],
  ['Usage metering & quotas', 'Nothing to meter for invoicing; the only limit is your VM.'],
  ['Plan tiers / seat-based pricing', 'No plans. AGPL, all features, every install.'],
  ['Spend caps & compute/disk add-on purchasing', 'You add compute by resizing your box, not buying a SKU.'],
  ['Org credits, invoices, payment methods', 'No commerce layer, ever.'],
  ['Vendor telemetry / phone-home analytics', 'Supastack never reports your usage anywhere.'],
  ['Billing-driven abuse/fraud detection', 'A pure-hosting-vendor concern; irrelevant self-hosted.'],
  ['Paid support tiers / marketplace', 'Not a vendor. The repo is the product.'],
];

/* render a notes string, rendering bare domains/endpoints/commands in mono */
const MONO_RE = /([a-z0-9._<>/*:-]*(?:<(?:ref|domain)>|\.<domain>|supabase |\/v1\/\*|\/mcp)[a-z0-9._<>/*:?-]*)/gi;
function NotesText({ text }) {
  // Highlight obvious endpoint/command fragments without overdoing it.
  const parts = String(text).split(/(\b[a-z0-9_]+\.<[a-z]+>(?::\d+)?(?:\/[a-z*]+)?|\*?\.?<[a-z]+>(?::\d+)?|https:\/\/[^\s;]+|\/v1\/\*|[a-z]+\.<ref>)/gi);
  return <span>{parts.map((p, i) => (/(<[a-z]+>|https:\/\/|\/v1\/\*|\.<ref>)/i.test(p)
    ? <code key={i} className="font-mono text-[0.82em] text-zinc-300">{p}</code>
    : <React.Fragment key={i}>{p}</React.Fragment>))}</span>;
}

function GroupHeader({ id, badge, badgeVariant, marker, markerCls, title, count, blurb }) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-base', markerCls)}>{marker}</span>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <Badge variant={badgeVariant}>{count} {count === 1 ? 'item' : 'items'}</Badge>
      </div>
      <p className="mt-3 max-w-3xl text-pretty leading-relaxed text-zinc-400">{blurb}</p>
    </div>
  );
}

function Row({ name, notes, tone }) {
  const dot = { brand: 'bg-brand', road: 'bg-road', slate: 'bg-zinc-600' }[tone];
  return (
    <div className="grid grid-cols-1 gap-1 px-5 py-4 transition-colors hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:gap-6">
      <div className="flex items-start gap-3">
        <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)}></span>
        <span className="font-medium leading-snug text-zinc-100">{name}</span>
      </div>
      <div className="pl-6 text-sm leading-relaxed text-zinc-400 sm:pl-0">
        <NotesText text={notes} />
      </div>
    </div>
  );
}

function GroupTable({ rows, tone }) {
  return (
    <Card className="mt-6 divide-y divide-white/[0.06] overflow-hidden p-0">
      {rows.map((r, i) => <Row key={i} name={r[0]} notes={r[1]} tone={tone} />)}
    </Card>
  );
}

function JumpNav() {
  const items = [
    { id: 'available', label: 'Available', cls: 'text-brand', dot: 'bg-brand' },
    { id: 'roadmap', label: 'Roadmap', cls: 'text-road', dot: 'bg-road' },
    { id: 'never', label: 'Never', cls: 'text-zinc-400', dot: 'bg-zinc-600' },
  ];
  const jump = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };
  return (
    <div className="sticky top-16 z-30 -mx-5 mb-2 border-y border-white/[0.07] bg-base/85 px-5 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-xl sm:border">
      <div className="flex items-center gap-2 overflow-x-auto sm:justify-center sm:overflow-visible">
        <span className="mr-1 hidden whitespace-nowrap font-mono text-[11px] uppercase tracking-widest text-zinc-500 sm:inline">Jump to</span>
        {items.map(it => (
          <button key={it.id} onClick={() => jump(it.id)}
            className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.07]">
            <span className={cx('h-1.5 w-1.5 rounded-full', it.dot)}></span>
            <span className={it.cls}>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FeaturesPage({ go }) {
  return (
    <main className="bg-atmos">
      <SectionWrap className="pt-14">
        <div className="rise mx-auto max-w-3xl text-center">
          <Eyebrow>The feature map</Eyebrow>
          <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            Supabase Cloud, <span className="text-brand">feature by feature.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-400">
            Supastack aims for Cloud parity on everything that makes sense to self-host. Here’s exactly where it stands — and what it will deliberately never become.
          </p>
        </div>

        <div className="mt-10">
          <JumpNav />
        </div>

        {/* GROUP A */}
        <div className="mt-10">
          <GroupHeader
            id="available"
            title="Available in Supastack"
            badgeVariant="brand" count={GROUP_A.length}
            marker={<IconCheck className="h-4 w-4" />}
            markerCls="border-brand/30 bg-brand/10 text-brand"
            blurb="Cloud parity, shipped. These work today on a stock install." />
          <GroupTable rows={GROUP_A} tone="brand" />
        </div>

        {/* GROUP B */}
        <div className="mt-16">
          <GroupHeader
            id="roadmap"
            title="Not yet — on the roadmap"
            badgeVariant="road" count={GROUP_B.length}
            marker={<span className="font-mono text-sm font-bold">…</span>}
            markerCls="border-road/30 bg-road/10 text-road"
            blurb="Parity intended, not done. This list is deliberately thinner on detail than the one above — that’s the honest signal." />
          <GroupTable rows={GROUP_B} tone="road" />
        </div>

        {/* GROUP C */}
        <div className="mt-16">
          <GroupHeader
            id="never"
            title="Deliberately never"
            badgeVariant="slate" count={GROUP_C.length}
            marker={<span className="text-lg leading-none">∅</span>}
            markerCls="border-white/12 bg-white/[0.04] text-zinc-400"
            blurb="" />
          <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 text-pretty leading-relaxed text-zinc-300">
            These only make sense for a hosting company billing you for someone else’s hardware. Supastack runs on yours — so it will never grow a billing department.
          </div>
          <GroupTable rows={GROUP_C} tone="slate" />
          <p className="mt-4 text-sm leading-relaxed text-zinc-500">
            <span className="text-zinc-400">By design, not forever:</span> Supastack is single-host today — one VM runs the control plane and all project stacks. That’s an architectural choice, not a billing one; multi-host is a possible future, unlike the items above.
          </p>
        </div>

        {/* end */}
        <div className="mt-16 rounded-2xl border border-white/[0.08] bg-base-800/70 p-8 text-center">
          <h3 className="text-xl font-semibold tracking-tight">Found something missing that <span className="text-brand">should</span> be parity?</h3>
          <p className="mt-2 text-zinc-400">Open an issue — accuracy on this page is the entire point.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button href={ISSUES} target="_blank" rel="noopener noreferrer" variant="primary">
              <IconGitHub className="h-4 w-4" /> Open an issue
            </Button>
            <Button as="button" onClick={() => go('home')} variant="ghost">← Back to home</Button>
          </div>
        </div>
      </SectionWrap>
    </main>
  );
}

Object.assign(window, { FeaturesPage });
