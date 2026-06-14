/* Supastack — docs (client-side markdown render of docs/*.md) */
/* global marked, DOMPurify */

// Slugs are kebab filenames; reject anything else (path-traversal / junk).
const SLUG_RE = /^[a-z0-9._-]+$/i;

function renderMarkdown(md) {
  const raw = window.marked.parse(md, { gfm: true, breaks: false });
  return window.DOMPurify.sanitize(raw);
}

function DocsIndex({ go }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('docs/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index ' + r.status))))
      .then(setItems)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <SectionWrap className="pt-14">
      <div className="rise mx-auto max-w-3xl">
        <Eyebrow>Documentation</Eyebrow>
        <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
          Operator <span className="text-brand">docs.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-400">
          Runbooks and guides for installing, operating, and troubleshooting a Supastack host.
        </p>

        {err && (
          <Card className="mt-8 p-5 text-sm text-road">Couldn’t load the docs index ({err}).</Card>
        )}
        {!items && !err && <p className="mt-8 text-sm text-zinc-500">Loading…</p>}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {(items || []).map((d) => (
            <button
              key={d.slug}
              onClick={() => go('docs/' + d.slug)}
              className="focus-ring group flex flex-col rounded-xl border border-white/[0.08] bg-base-800/70 p-5 text-left transition-colors hover:border-white/[0.16] hover:bg-base-700/70"
            >
              <h3 className="text-[0.98rem] font-semibold tracking-tight text-white">{d.title}</h3>
              <p className="mt-1.5 font-mono text-xs text-zinc-500">{d.slug}.md</p>
            </button>
          ))}
        </div>
      </div>
    </SectionWrap>
  );
}

function DocViewer({ go, slug }) {
  const [html, setHtml] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!SLUG_RE.test(slug)) {
      setErr('invalid document');
      return;
    }
    let cancelled = false;
    setHtml(null);
    setErr(null);
    fetch('docs/' + slug + '.md')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('doc ' + r.status))))
      .then((md) => {
        if (!cancelled) setHtml(renderMarkdown(md));
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <SectionWrap className="pt-14">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => go('docs')}
          className="focus-ring mb-8 inline-flex items-center gap-1.5 rounded-md text-sm text-zinc-400 transition-colors hover:text-white"
        >
          ← All docs
        </button>
        {err && (
          <Card className="p-5 text-sm text-road">
            Couldn’t load <span className="font-mono">{slug}.md</span> ({err}).
          </Card>
        )}
        {!html && !err && <p className="text-sm text-zinc-500">Loading…</p>}
        {html && (
          <article
            className="prose prose-invert max-w-none prose-headings:tracking-tight prose-a:text-brand prose-a:no-underline hover:prose-a:underline prose-code:text-brand prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-white/10 prose-pre:bg-[#0b0d12] prose-th:text-left"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </SectionWrap>
  );
}

function DocsPage({ go, slug }) {
  return <main className="bg-atmos">{slug ? <DocViewer go={go} slug={slug} /> : <DocsIndex go={go} />}</main>;
}

Object.assign(window, { DocsPage });
