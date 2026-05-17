import type { Session } from 'next-auth';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';

interface AppShellProps {
  session: Session;
  children: React.ReactNode;
}

/**
 * Wrapper layout : Header en haut (rouge IPD), Sidebar à gauche
 * (cream), main à droite. Surface main scrollable, fond bg-background
 * (blanc) pour contraster avec la sidebar cream.
 */
export function AppShell({ session, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader session={session} />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
