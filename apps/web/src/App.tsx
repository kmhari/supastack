import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context.js';
import { SetupPage } from './pages/Setup.js';

/**
 * Feature 086 — the legacy supastack studio is retired to the `/setup` install
 * wizard only; the platform studio (IS_PLATFORM) owns the dashboard. This SPA
 * therefore mounts a single route; any other path redirects to `/setup`.
 */
export function App(): ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </AuthProvider>
  );
}
