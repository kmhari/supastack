import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context.js';
import { setupApi } from './lib/api.js';
import { SetupPage } from './pages/Setup.js';
import { LoginPage } from './pages/Login.js';
import { InstancesPage } from './pages/Instances.js';
import { InstancesNewPage } from './pages/InstancesNew.js';
import { InstanceDetailPage } from './pages/InstanceDetail.js';
import { InstanceBackupsPage } from './pages/InstanceBackups.js';
import { SettingsOrgPage } from './pages/SettingsOrg.js';

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <InstancesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/instances/new"
          element={
            <RequireAuth>
              <InstancesNewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:ref"
          element={
            <RequireAuth>
              <InstanceDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:ref/backups"
          element={
            <RequireAuth>
              <InstanceBackupsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/org"
          element={
            <RequireAuth>
              <SettingsOrgPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

/**
 * Auth gate: if setup isn't done, redirect to /setup; if not logged in,
 * redirect to /login; otherwise render children. Stays out of the way of
 * the public /setup and /login routes themselves.
 */
function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);

  useEffect(() => {
    setupApi
      .status()
      .then((r) => setSetupOpen(r.open))
      .catch(() => setSetupOpen(false));
  }, []);

  if (loading || setupOpen === null) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0a0a0a',
          color: '#eee',
        }}
      >
        Loading…
      </div>
    );
  }
  if (setupOpen) {
    if (pathname !== '/setup') navigate('/setup', { replace: true });
    return <></>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
