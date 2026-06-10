import { NavLink, Outlet } from 'react-router-dom';
import { AdminGuard } from '@/components/AdminGuard';
import { cn } from '@/lib/utils';

/** Admin console layout: guard + sidebar nav + content. Nested in AppShell. Feature 116 (US2). */
const ITEMS = [
  { to: '/admin', label: 'Fleet', end: true },
  { to: '/admin/resources', label: 'Resources', end: false },
  { to: '/admin/queues', label: 'Queues', end: false },
  { to: '/admin/certs', label: 'Cert / DNS', end: false },
  { to: '/admin/system', label: 'System', end: false },
  { to: '/admin/logs', label: 'Logs', end: false },
];

export function AdminLayout(): React.ReactElement {
  return (
    <AdminGuard>
      <div className="flex gap-10">
        <aside className="w-40 shrink-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-lighter">
            Admin
          </div>
          <nav className="flex flex-col gap-0.5 text-sm">
            {ITEMS.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  cn(
                    'rounded px-2 py-1 transition-colors',
                    isActive
                      ? 'bg-surface-200 text-foreground'
                      : 'text-foreground-light hover:text-foreground',
                  )
                }
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </AdminGuard>
  );
}
