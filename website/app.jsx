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
const ROUTES = { '': 'home', '#/': 'home', '#/features': 'features', '#features': 'features' };

function routeFromHash() {
  const h = window.location.hash;
  if (ROUTES[h]) return ROUTES[h];
  if (h.indexOf('features') !== -1) return 'features';
  return 'home';
}

function App() {
  const [route, setRoute] = useState(routeFromHash());

  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); };
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

  const go = useCallback((target) => {
    const hash = target === 'features' ? '#/features' : '#/';
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(target);
    // jump to top on route change (not scrollIntoView)
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <div className="min-h-screen">
      <Nav route={route} go={go} />
      {route === 'features' ? <FeaturesPage go={go} /> : <Landing go={go} />}
      <Footer go={go} />
    </div>
  );
}

Object.assign(window, { SectionWrap, SectionHead, Footer, App });

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
