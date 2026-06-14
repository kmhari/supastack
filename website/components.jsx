/* Supastack — shadcn-style primitives (exported to window for cross-file use) */
const { useState, useEffect, useRef, useCallback } = React;

function cx(...a) { return a.filter(Boolean).join(' '); }

/* ---------- Icons (simple shapes only) ---------- */
function IconCheck({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrow({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M3 8h9M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCopy({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 2.5H3.6A1.1 1.1 0 0 0 2.5 3.6v6.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconGitHub({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* ---------- Button ---------- */
function Button({ as, href, variant = 'primary', size = 'md', className, children, ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors focus-ring disabled:opacity-50 whitespace-nowrap';
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-[0.95rem]', lg: 'h-12 px-6 text-base' };
  const variants = {
    primary: 'bg-brand text-[#06231a] hover:bg-brand-dark shadow-[0_1px_0_rgba(255,255,255,0.25)_inset]',
    secondary: 'border border-white/14 bg-white/[0.03] text-zinc-100 hover:bg-white/[0.07] hover:border-white/20',
    ghost: 'text-zinc-300 hover:bg-white/[0.06] hover:text-white',
  };
  const cls = cx(base, sizes[size], variants[variant], className);
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>;
  const Tag = as || 'button';
  return <Tag className={cls} {...rest}>{children}</Tag>;
}

/* ---------- Card ---------- */
function Card({ className, children, ...rest }) {
  return <div className={cx('rounded-xl border border-white/[0.08] bg-base-800/70', className)} {...rest}>{children}</div>;
}

/* ---------- Badge ---------- */
function Badge({ variant = 'neutral', className, children }) {
  const variants = {
    brand: 'border-brand/30 bg-brand/10 text-brand',
    road: 'border-road/30 bg-road/10 text-road',
    slate: 'border-white/10 bg-white/[0.04] text-zinc-400',
    neutral: 'border-white/12 bg-white/[0.04] text-zinc-300',
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  );
}

/* ---------- Mono inline (domains, endpoints) ---------- */
function Mono({ children, className }) {
  return <code className={cx('font-mono text-[0.85em] text-brand/95 bg-brand/[0.07] rounded px-1.5 py-0.5', className)}>{children}</code>;
}

/* ---------- Copy-to-clipboard command block ---------- */
function CopyCommand({ command, label, className }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(done, done);
    } else {
      const ta = document.createElement('textarea');
      ta.value = command; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }, [command]);

  return (
    <div className={cx('group rounded-xl border border-white/[0.10] bg-[#0b0d12] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.9)]', className)}>
      {label && (
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15"></span>
            <span className="h-2.5 w-2.5 rounded-full bg-white/15"></span>
            <span className="h-2.5 w-2.5 rounded-full bg-white/15"></span>
          </span>
          <span className="ml-1 font-mono text-xs text-zinc-500">{label}</span>
        </div>
      )}
      <div className="flex items-stretch gap-3 px-4 py-3.5">
        <span className="select-none pt-0.5 font-mono text-sm text-brand/70" aria-hidden="true">$</span>
        <pre className="scroll-x flex-1 overflow-x-auto py-0.5"><code className="font-mono text-[0.86rem] leading-relaxed text-zinc-200">{command}</code></pre>
        <button
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy command'}
          className="focus-ring shrink-0 self-start inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          {copied ? <IconCheck className="h-3.5 w-3.5 text-brand" /> : <IconCopy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Section heading ---------- */
function Eyebrow({ children, className }) {
  return <div className={cx('font-mono text-xs uppercase tracking-[0.18em] text-brand/80', className)}>{children}</div>;
}

Object.assign(window, {
  cx, IconCheck, IconArrow, IconCopy, IconGitHub,
  Button, Card, Badge, Mono, CopyCommand, Eyebrow,
});
