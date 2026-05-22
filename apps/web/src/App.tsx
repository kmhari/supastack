import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context.js';
import { apexApi, setupApi } from './lib/api.js';
import { SetupPage } from './pages/Setup.js';
import { LoginPage } from './pages/Login.js';
import { InstancesPage } from './pages/Instances.js';
import { InstancesNewPage } from './pages/InstancesNew.js';
import { ProjectGeneralPage } from './pages/ProjectGeneral.js';
import { ProjectApiKeysPage } from './pages/ProjectApiKeys.js';
import { ProjectJwtKeysPage } from './pages/ProjectJwtKeys.js';
import { InstanceBackupsPage } from './pages/InstanceBackups.js';
import { ProjectHealthPage } from './pages/ProjectHealth.js';
import { ProjectStudioPage } from './pages/ProjectStudio.js';
import { SettingsOrgPage } from './pages/SettingsOrg.js';
import { SettingsMembersPage } from './pages/SettingsMembers.js';
import { SettingsAuditPage } from './pages/SettingsAudit.js';
import { SettingsTokensPage } from './pages/SettingsTokens.js';
import { ConnectCliPage } from './pages/ConnectCli.js';
import { AcceptInvitePage } from './pages/AcceptInvite.js';
import { SetupGate } from './components/SetupGate.js';
import { Toaster } from './components/ui/sonner.js';

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Toaster richColors closeButton position="bottom-right" theme="dark" />
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route
          path="/login"
          element={
            <SetupGate>
              <LoginPage />
            </SetupGate>
          }
        />
        <Route
          path="/accept-invite"
          element={
            <SetupGate>
              <AcceptInvitePage />
            </SetupGate>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <InstancesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/new"
          element={
            <RequireAuth>
              <InstancesNewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref"
          element={
            <RequireAuth>
              <ProjectStudioPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref/admin"
          element={
            <RequireAuth>
              <ProjectGeneralPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref/admin/api-keys"
          element={
            <RequireAuth>
              <ProjectApiKeysPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref/admin/jwt-keys"
          element={
            <RequireAuth>
              <ProjectJwtKeysPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref/admin/backups"
          element={
            <RequireAuth>
              <InstanceBackupsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/project/:ref/admin/health"
          element={
            <RequireAuth>
              <ProjectHealthPage />
            </RequireAuth>
          }
        />

        {/* Legacy path redirects — keep bookmarks/external links working. */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/instances/new" element={<Navigate to="/dashboard/new" replace />} />
        <Route path="/p/:ref" element={<LegacyProjectRedirect />} />
        <Route path="/p/:ref/:tab" element={<LegacyProjectRedirect />} />
        <Route
          path="/settings/org"
          element={
            <RequireAuth>
              <SettingsOrgPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/members"
          element={
            <RequireAuth>
              <SettingsMembersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/tokens"
          element={
            <RequireAuth>
              <SettingsTokensPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/audit"
          element={
            <RequireAuth>
              <SettingsAuditPage />
            </RequireAuth>
          }
        />
        <Route
          path="/connect-cli"
          element={
            <RequireAuth>
              <ConnectCliPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

/**
 * Auth gate: if setup isn't done, redirect to /setup; if not logged in,
 * redirect to /login; if setup-status is closed but the apex domain
 * isn't fully configured (no apex, or apex without a real cert), redirect
 * back to /setup so the user can finish what they started. Otherwise
 * render children. Stays out of the way of the public /setup and /login
 * routes themselves.
 */
function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const [apexIncomplete, setApexIncomplete] = useState<boolean | null>(null);

  useEffect(() => {
    setupApi
      .status()
      .then((r) => setSetupOpen(r.open))
      .catch(() => setSetupOpen(false));
  }, []);

  // Only probe the apex once we know setup is closed AND the user is
  // authed — /apex requires auth and would 401 otherwise, masking the
  // real state.
  useEffect(() => {
    if (loading || setupOpen !== false || !user) return;
    apexApi
      .status()
      .then((r) => setApexIncomplete(!r.apex || !r.cert?.issued))
      .catch(() => setApexIncomplete(false)); // fail-open: don't trap user if /apex is sick
  }, [loading, setupOpen, user]);

  const waitingForApex =
    setupOpen === false && !!user && apexIncomplete === null;

  if (loading || setupOpen === null || waitingForApex) {
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
  if (apexIncomplete) {
    if (pathname !== '/setup') navigate('/setup', { replace: true });
    return <></>;
  }
  return children;
}

/** Redirect old /p/:ref[/:tab] (settings pages) to /dashboard/project/:ref/admin[/:tab].
 *  The new /dashboard/project/:ref is Studio, not General. */
function LegacyProjectRedirect(): React.ReactElement {
  const { ref = '', tab } = useParams<{ ref: string; tab?: string }>();
  const target = tab
    ? `/dashboard/project/${ref}/admin/${tab}`
    : `/dashboard/project/${ref}/admin`;
  return <Navigate to={target} replace />;
}
