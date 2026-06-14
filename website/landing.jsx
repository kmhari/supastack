/* Supastack — landing page */
const REPO = 'https://github.com/kmhari/supastack';
const ISSUES = 'https://github.com/kmhari/supastack/issues';
const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/kmhari/supastack/main/install.sh | bash -s -- your-domain.com';

/* ---- The gap: spectrum columns ---- */
const SPECTRUM = [
  {
    title: 'Supabase Cloud',
    tag: 'fully managed',
    body: 'Multi-project, great UX, zero ops.',
    foot: 'But it’s their servers and their bill.',
    accent: false,
  },
  {
    title: 'Vanilla self-host',
    tag: 'docker compose',
    body: 'One hand-wired project per VM.',
    foot: 'No dashboard auth, no CLI, no backups, no lifecycle.',
    accent: false,
  },
  {
    title: 'Supastack',
    tag: 'control plane',
    body: 'Your servers and the Cloud experience.',
    foot: 'Multi-project, Studio, orgs, HTTPS, backups, CLI, MCP.',
    accent: true,
  },
];

/* ---- What you get ---- */
const FEATURES = [
  { t: 'Multi-project on one host', d: 'Provision N isolated full-stack projects from the dashboard in ~60–90s — each with its own Postgres, Auth, Storage, Realtime and Edge Functions.' },
  { t: 'The real Supabase Studio', d: 'One shared Studio in platform mode (the same build Cloud uses): project list, org switcher and Cloud-parity URLs.' },
  { t: 'Real accounts, orgs & RBAC', d: 'Control-plane auth with organizations, Owner / Administrator / Developer / Read-only roles and email invites — not one shared password.' },
  { t: 'HTTPS everywhere', d: 'A guided DNS wizard issues a wildcard Let’s Encrypt cert; every project lives at its own HTTPS subdomain automatically.', mono: '*.<domain>' },
  { t: 'The supabase CLI actually works', d: 'Unmodified upstream CLI: login, link, db push, functions deploy, secrets set, gen types, migration. No fork, no shim.', mono: 'supabase' },
  { t: 'Hosted MCP server', d: 'Paste the endpoint into Claude Code, Cursor or Windsurf, authorize in the browser (OAuth 2.1 + PKCE) and drive every project via tool calls.', mono: 'mcp.<domain>/mcp' },
  { t: 'Backups & lifecycle', d: 'On-demand and daily backups (local or S3), dashboard restore, and pause / resume / restart / upgrade / delete per project.' },
  { t: 'Public Postgres', d: 'Direct SNI-multiplexed access over one port plus a pooled connection via Supavisor.', mono: 'db.<ref>.<domain>:5432' },
];

function Nav({ route, go }) {
  const [open, setOpen] = useState(false);
  const link = (label, target) => (
    <button onClick={() => { go(target); setOpen(false); }}
      className={cx('focus-ring rounded-md px-2 py-1 text-sm transition-colors',
        route === target ? 'text-white' : 'text-zinc-400 hover:text-white')}>
      {label}
    </button>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-5 sm:px-6">
        <button onClick={() => go('home')} className="focus-ring flex items-center gap-2.5 rounded-md">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-[#06231a]">
            <span className="font-mono text-[15px] font-bold leading-none">S</span>
          </span>
          <span className="text-[0.95rem] font-semibold tracking-tight">Supastack</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 sm:inline">v0 · OSS</span>
        </button>

        <nav className="hidden items-center gap-1.5 md:flex">
          {link('Home', 'home')}
          {link('Feature map', 'features')}
          {link('Docs', 'docs')}
          <a href={REPO} target="_blank" rel="noopener noreferrer"
            className="focus-ring rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:text-white">GitHub</a>
          <Button href={REPO} target="_blank" rel="noopener noreferrer" size="sm" variant="primary" className="ml-2">
            <IconGitHub className="h-4 w-4" /> Star
          </Button>
        </nav>

        <button onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}
          className="focus-ring grid h-9 w-9 place-items-center rounded-md border border-white/12 text-zinc-300 md:hidden">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-white/[0.07] px-5 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {link('Home', 'home')}
            {link('Feature map', 'features')}
            {link('Docs', 'docs')}
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="rounded-md px-2 py-1 text-sm text-zinc-400">GitHub repo</a>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero({ go }) {
  return (
    <section className="relative overflow-hidden bg-atmos">
      <div className="pointer-events-none absolute inset-0 bg-grid"></div>
      <div className="relative mx-auto max-w-content px-5 pb-20 pt-16 sm:px-6 sm:pt-24">
        <div className="rise mx-auto max-w-3xl text-center">
          <Badge variant="brand" className="mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-brand"></span>
            Open source · AGPL-3.0 · self-hosted
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-[1.07] tracking-tight sm:text-5xl md:text-6xl">
            The control plane self-hosted<br className="hidden sm:block" /> Supabase is <span className="text-brand">missing.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-400">
            Supabase ships a paid Cloud and a bag of Docker containers you wire up by hand. Supastack is the in-between: an open-source control plane that gives you the Supabase <span className="text-zinc-200">Cloud experience</span> on hardware you own — no vendor, no bill.
          </p>

          <div className="mx-auto mt-9 max-w-2xl text-left">
            <CopyCommand command={INSTALL} label="one-command install" />
            <p className="mt-3 text-center font-mono text-xs text-zinc-500">
              AGPL-3.0 · self-hosted · no telemetry, no billing, no vendor.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={REPO} target="_blank" rel="noopener noreferrer" size="lg" variant="primary">
              <IconGitHub className="h-4 w-4" /> Get started
            </Button>
            <Button as="button" onClick={() => go('features')} size="lg" variant="secondary">
              See the feature map <IconArrow className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TheGap() {
  return (
    <SectionWrap id="gap">
      <SectionHead eyebrow="The gap" title="There was nothing in between.">
        Supabase gives you a fully-managed Cloud or a pile of containers. Supastack is the missing middle.
      </SectionHead>
      <div className="mt-10 grid items-stretch gap-4 md:grid-cols-3">
        {SPECTRUM.map((c, i) => (
          <div key={i} className="relative">
            <Card className={cx('flex h-full flex-col p-6',
              c.accent && 'border-brand/40 bg-brand/[0.06] ring-1 ring-brand/20')}>
              <div className="flex items-center justify-between">
                <h3 className={cx('text-lg font-semibold tracking-tight', c.accent ? 'text-brand' : 'text-white')}>{c.title}</h3>
                <span className={cx('font-mono text-[10px] uppercase tracking-wider', c.accent ? 'text-brand/80' : 'text-zinc-500')}>{c.tag}</span>
              </div>
              <p className="mt-3 text-[0.95rem] text-zinc-300">{c.body}</p>
              <p className={cx('mt-auto pt-4 text-sm', c.accent ? 'text-brand/90' : 'text-zinc-500')}>{c.foot}</p>
              {c.accent && (
                <span className="absolute -top-3 left-6 whitespace-nowrap rounded-full border border-brand/40 bg-base px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand">you are here</span>
              )}
            </Card>
          </div>
        ))}
      </div>
    </SectionWrap>
  );
}

function WhatYouGet() {
  return (
    <SectionWrap id="features">
      <SectionHead eyebrow="What you get" title="The Cloud parts, on your box.">
        Everything that makes Supabase Cloud pleasant to use — reimplemented as a control plane around the stock data plane.
      </SectionHead>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Card key={i} className="group flex flex-col p-5 transition-colors hover:border-white/[0.16] hover:bg-base-700/70">
            <div className="mb-3 grid h-8 w-8 place-items-center rounded-md border border-brand/25 bg-brand/10 text-brand">
              <IconCheck className="h-4 w-4" />
            </div>
            <h3 className="text-[0.98rem] font-semibold tracking-tight text-white">{f.t}</h3>
            {f.mono && <div className="mt-2"><Mono>{f.mono}</Mono></div>}
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.d}</p>
          </Card>
        ))}
      </div>
    </SectionWrap>
  );
}

function DataPlane() {
  return (
    <SectionWrap id="lockin">
      <Card className="overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[1.4fr_1fr] md:p-10">
          <div>
            <Eyebrow>Same data plane · zero lock-in</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Leaving is <span className="text-brand">pg_dump.</span></h2>
            <p className="mt-4 max-w-xl text-pretty leading-relaxed text-zinc-400">
              Your projects run the <span className="text-zinc-200">stock upstream <Mono>supabase/*</Mono> images</span>, pinned and upgradeable. Your app code, client libraries and data are exactly as portable as any Supabase deployment. Supastack only adds the control plane <span className="italic text-zinc-300">around</span> them — nothing about your stack is proprietary.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 rounded-lg border border-white/[0.07] bg-[#0b0d12] p-5">
            <div className="flex items-center gap-3 text-sm"><span className="h-2 w-2 rounded-full bg-brand"></span><span className="text-zinc-300">Stock <Mono>supabase/postgres</Mono>, Studio, GoTrue, Realtime, Storage</span></div>
            <div className="flex items-center gap-3 text-sm"><span className="h-2 w-2 rounded-full bg-brand"></span><span className="text-zinc-300">Pinned image tags, upgrade on your schedule</span></div>
            <div className="flex items-center gap-3 text-sm"><span className="h-2 w-2 rounded-full bg-brand"></span><span className="text-zinc-300">Control plane is additive — remove it, keep your data</span></div>
          </div>
        </div>
      </Card>
    </SectionWrap>
  );
}

function CTAStrip() {
  return (
    <SectionWrap id="cta">
      <div className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-b from-brand/[0.10] to-brand/[0.02] p-8 text-center sm:p-12">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60"></div>
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Run your own Supabase Cloud.</h2>
          <p className="mt-3 text-zinc-400">A fresh Ubuntu 22.04+ VM with a public IP is all it takes. ~1 GB RAM per project.</p>
          <div className="mx-auto mt-7 max-w-xl text-left">
            <CopyCommand command={INSTALL} />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button href={REPO} target="_blank" rel="noopener noreferrer" size="lg" variant="primary">
              <IconGitHub className="h-4 w-4" /> View on GitHub
            </Button>
          </div>
          <p className="mt-5 font-mono text-xs text-zinc-500">AGPL-3.0-only · github.com/kmhari/supastack</p>
        </div>
      </div>
    </SectionWrap>
  );
}

function Landing({ go }) {
  return (
    <main>
      <Hero go={go} />
      <TheGap />
      <WhatYouGet />
      <DataPlane />
      <CTAStrip />
    </main>
  );
}

Object.assign(window, { Landing, Nav, REPO, ISSUES, INSTALL });
