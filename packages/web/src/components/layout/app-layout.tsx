import { FileText, MessageSquare, Scale } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { HealthStatus } from '@/features/health/health-status';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Chat', icon: MessageSquare, end: true },
  { to: '/documents', label: 'Documents', icon: FileText, end: false },
];

export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <Scale className="size-5" aria-hidden />
            Lexica
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <HealthStatus />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
