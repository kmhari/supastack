import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context.js';
import { SetupPage } from './pages/Setup.js';
import { AppShell } from './components/AppShell.js';
import { DocsLayout } from './components/docs/DocsLayout.js';
import { DocsIndex } from './pages/docs/Index.js';
import { DocsCli } from './pages/docs/Cli.js';
import { DocsMcp } from './pages/docs/Mcp.js';

/**
 * Feature 086 retired the legacy SPA to the `/setup` wizard. Feature 116 (US1)
 * adds a shared shell (`AppShell`) + public `/docs/*` pages; the future `/admin`
 * console nests under the same shell. The wizard keeps its own full-screen layout.
 */
export function App(): ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<AppShell />}>
          <Route path="/docs" element={<DocsLayout />}>
            <Route index element={<DocsIndex />} />
            <Route path="cli" element={<DocsCli />} />
            <Route path="mcp" element={<DocsMcp />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </AuthProvider>
  );
}
