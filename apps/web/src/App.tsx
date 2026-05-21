import { Route, Routes, Navigate } from 'react-router-dom';

/**
 * Placeholder router. Real routes (Setup, Login, Instances, etc.) land in
 * Phase 3 (US1). For now we render a tiny diagnostic banner so `pnpm dev`
 * shows that the bundle wired up correctly.
 */
export function App(): React.ReactElement {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
            <h1>Selfbase (scaffold)</h1>
            <p>Phase 2 foundational scaffold is loaded. Phase 3 will wire up the real pages.</p>
            <p>
              API:&nbsp;
              <code>
                {(import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env.VITE_API_URL ||
                  '(relative /api)'}
              </code>
            </p>
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
