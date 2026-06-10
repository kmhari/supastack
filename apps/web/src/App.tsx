import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context.js';
import { SetupPage } from './pages/Setup.js';
import { AppShell } from './components/AppShell.js';
import { DocsLayout } from './components/docs/DocsLayout.js';
import { DocsIndex } from './pages/docs/Index.js';
import { DocsCli } from './pages/docs/Cli.js';
import { DocsMcp } from './pages/docs/Mcp.js';
import { AdminLayout } from './components/admin/AdminLayout.js';
import { AdminFleet } from './pages/admin/Fleet.js';
import { AdminProjectDetail } from './pages/admin/ProjectDetail.js';
import { AdminSystem } from './pages/admin/System.js';
import { AdminLogs } from './pages/admin/Logs.js';
import { AdminResources } from './pages/admin/Resources.js';
import { AdminQueues } from './pages/admin/Queues.js';
import { AdminCerts } from './pages/admin/Certs.js';

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
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminFleet />} />
            <Route path="projects/:ref" element={<AdminProjectDetail />} />
            <Route path="resources" element={<AdminResources />} />
            <Route path="queues" element={<AdminQueues />} />
            <Route path="certs" element={<AdminCerts />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="logs" element={<AdminLogs />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </AuthProvider>
  );
}
