/**
 * Design tokens lifted from supabase.com/dashboard/sign-in (rendered values
 * inspected live, not from npm). Intentionally a minimum-viable shared
 * tokens object — switch to Tailwind v4 + the vendored
 * `apps/web/src/theme/tailwind/` config once the build is wired.
 *
 * Key calibration notes:
 *   - Brand button is DARK forest green (#006239), not the bright #3ECF8E
 *     used for accent strokes/logos. Most of our prior pages used the bright
 *     green which doesn't match the actual sign-in experience.
 *   - All weights are 400 — no bold headings, no semibold buttons.
 *   - The page is single-column without a visible "card" — form sits
 *     directly on the page background with only border/spacing.
 */
export const theme = {
  color: {
    pageBg: '#171717', // zinc-900 — body background
    cardBg: '#1f1f1f', // very subtle card lift when we DO want a card (settings pages)
    inputBg: 'rgba(255, 255, 255, 0.026)', // near-transparent overlay on dark bg
    secondaryBg: '#242424', // SSO / secondary buttons
    border: '#393939',
    borderSoft: '#2a2a2a',
    text: '#fafafa',
    textMuted: '#898989',
    textLight: '#b4b4b4',
    brandBg: '#006239', // primary button background
    brandBgHover: '#007a48',
    brandBorder: 'rgba(62, 207, 142, 0.3)', // subtle bright-green ring on primary button
    danger: '#f87171',
    dangerBg: '#3a1717',
    success: '#3ECF8E', // bright accent (logos, status pills, links)
    warn: '#fadc6b',
    warnBg: '#3a3a17',
    info: '#7ab8f5',
    infoBg: '#1f2a3a',
  },
  font: {
    // Match supabase.com's stack: Circular first (if the local OS has it —
    // their staff machines do, via next/font's bundled `customFont`), then
    // Inter as the loaded web fallback, then system stacks. We can't ship
    // Circular ourselves (Lineto-licensed); we just reference it.
    family:
      "Circular, 'Circular Std', 'TT Commons Pro', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, sans-serif",
    sizeBase: '14px',
    sizeSm: '13px',
    sizeXs: '12px',
    sizeButton: '14px',
    sizeHeading: '30px',
    sizeSubheading: '16px',
    weightRegular: 400,
    weightMedium: 500,
  },
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '999px',
  },
  spacing: {
    formWidth: 384, // 24rem — the column width on supabase.com sign-in
    inputHeight: '34px',
    buttonHeight: '38px', // a notch shorter than supabase's 42 to feel a little snappier
    inputPadding: '8px 12px',
    buttonPadding: '8px 16px',
  },
} as const;

// ─── Reusable style objects ─────────────────────────────────────────────────
// Each component reaches for these via `style={s.input}` etc. Saves passing
// the whole theme around and keeps consistency.

export const s = {
  pageShell: {
    minHeight: '100vh',
    background: theme.color.pageBg,
    color: theme.color.text,
    fontFamily: theme.font.family,
    fontSize: theme.font.sizeBase,
    fontWeight: theme.font.weightRegular,
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  } as React.CSSProperties,
  centeredColumn: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    background: theme.color.pageBg,
    color: theme.color.text,
    fontFamily: theme.font.family,
  } as React.CSSProperties,
  form: {
    width: theme.spacing.formWidth,
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as React.CSSProperties,
  formHeading: {
    fontSize: theme.font.sizeHeading,
    fontWeight: theme.font.weightRegular,
    margin: 0,
    color: theme.color.text,
    letterSpacing: '-0.02em',
  } as React.CSSProperties,
  formSub: {
    color: theme.color.textMuted,
    fontSize: theme.font.sizeBase,
    margin: 0,
  } as React.CSSProperties,
  label: {
    fontSize: theme.font.sizeSm,
    color: theme.color.textLight,
    display: 'block',
    marginBottom: 6,
  } as React.CSSProperties,
  input: {
    width: '100%',
    height: theme.spacing.inputHeight,
    padding: theme.spacing.inputPadding,
    background: theme.color.inputBg,
    color: theme.color.text,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.md,
    fontSize: theme.font.sizeBase,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  } as React.CSSProperties,
  buttonPrimary: {
    width: '100%',
    height: theme.spacing.buttonHeight,
    padding: theme.spacing.buttonPadding,
    background: theme.color.brandBg,
    color: theme.color.text,
    border: `1px solid ${theme.color.brandBorder}`,
    borderRadius: theme.radius.md,
    fontSize: theme.font.sizeButton,
    fontWeight: theme.font.weightRegular,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'background 120ms ease',
  } as React.CSSProperties,
  buttonSecondary: {
    width: '100%',
    height: theme.spacing.buttonHeight,
    padding: theme.spacing.buttonPadding,
    background: theme.color.secondaryBg,
    color: theme.color.text,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.md,
    fontSize: theme.font.sizeButton,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'background 120ms ease',
  } as React.CSSProperties,
  buttonGhost: {
    height: theme.spacing.buttonHeight,
    padding: theme.spacing.buttonPadding,
    background: 'transparent',
    color: theme.color.text,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.md,
    fontSize: theme.font.sizeButton,
    fontFamily: 'inherit',
    cursor: 'pointer',
  } as React.CSSProperties,
  buttonLink: {
    background: 'transparent',
    border: 0,
    color: theme.color.textMuted,
    fontSize: theme.font.sizeSm,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'none',
  } as React.CSSProperties,
  errorBox: {
    background: theme.color.dangerBg,
    color: theme.color.danger,
    fontSize: theme.font.sizeSm,
    padding: '8px 12px',
    borderRadius: theme.radius.md,
    border: `1px solid #5a1a1a`,
  } as React.CSSProperties,
} as const;
