/* Supastack — app shell, layout helpers, routing */

function SectionWrap({ id, className, children }) {
  return (
    <section id={id} className={cx('mx-auto max-w-content px-5 py-16 sm:px-6 sm:py-20', className)}>
      {children}
    </section>
  );
}

function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-pretty text-lg leading-relaxed text-zinc-400">{children}</p>}
    </div>
  );
}

function Footer({ go }) {
  return (
    <footer className="border-t border-white/[0.07] bg-base-800/40">
      <div className="mx-auto max-w-content px-5 py-12 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-[#06231a]">
                <span className="font-mono text-[15px] font-bold leading-none">S</span>
              </span>
              <span className="text-[0.95rem] font-semibold tracking-tight">Supastack</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              The open-source control plane for self-hosted Supabase. Run your own Supabase Cloud on hardware you own.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">Project</div>
              <ul className="mt-3 space-y-2 text-sm">
                <li><button onClick={() => go('home')} className="focus-ring rounded text-zinc-400 hover:text-white">Home</button></li>
                <li><button onClick={() => go('features')} className="focus-ring rounded text-zinc-400 hover:text-white">Feature map</button></li>
                <li><button onClick={() => go('docs')} className="focus-ring rounded text-zinc-400 hover:text-white">Docs</button></li>
              </ul>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">Source</div>
              <ul className="mt-3 space-y-2 text-sm">
                <li><a href={REPO} target="_blank" rel="noopener noreferrer" className="focus-ring rounded text-zinc-400 hover:text-white">GitHub repo</a></li>
                <li><a href={ISSUES} target="_blank" rel="noopener noreferrer" className="focus-ring rounded text-zinc-400 hover:text-white">Issues</a></li>
              </ul>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">License</div>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="font-mono text-zinc-400">AGPL-3.0-only</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/[0.06] pt-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono">github.com/kmhari/supastack · no telemetry · no billing · no vendor</p>
          <p>Community project. Not affiliated with Supabase Inc.</p>
        </div>
      </div>
    </footer>
  );
}

/* ---------- Routing (hash-based, GitHub-Pages safe) ---------- */
// Returns { name, slug }. Docs carry an optional slug: #/docs/<slug>.
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw === 'features') return { name: 'features' };
  if (raw === 'docs') return { name: 'docs' };
  if (raw.indexOf('docs/') === 0) return { name: 'docs', slug: raw.slice(5) || undefined };
  return { name: 'home' };
}

function App() {
  const init = parseHash();
  const [route, setRoute] = useState(init.name);
  const [docSlug, setDocSlug] = useState(init.slug);

  useEffect(() => {
    const onHash = () => { const p = parseHash(); setRoute(p.name); setDocSlug(p.slug); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Arm entrance animations only when the document is actually visible, so that
  // .rise content is never frozen at opacity:0 in a hidden/background tab.
  useEffect(() => {
    const arm = () => {
      if (document.visibilityState !== 'visible') return;
      document.querySelectorAll('.rise:not([data-animate])').forEach(el => el.setAttribute('data-animate', '1'));
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => document.removeEventListener('visibilitychange', arm);
  });

  // target: 'home' | 'features' | 'docs' | 'docs/<slug>'
  const go = useCallback((target) => {
    const hash = target === 'home' ? '#/' : `#/${target}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(target.split('/')[0] || 'home');
    setDocSlug(target.indexOf('docs/') === 0 ? target.slice(5) : undefined);
    // jump to top on route change (not scrollIntoView)
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <div className="min-h-screen">
      <Nav route={route} go={go} />
      {route === 'docs' ? (
        <DocsPage go={go} slug={docSlug} />
      ) : route === 'features' ? (
        <FeaturesPage go={go} />
      ) : (
        <Landing go={go} />
      )}
      <Footer go={go} />
    </div>
  );
}

Object.assign(window, { SectionWrap, SectionHead, Footer, App });

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
