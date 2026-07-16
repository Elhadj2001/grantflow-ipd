import type { Session } from 'next-auth';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { PageTransition } from './PageTransition';

interface AppShellProps {
  session: Session;
  children: React.ReactNode;
}

/**
 * Coquille authentifiée — pattern charte 2025 (cf. app-shell de référence,
 * docs/design/CHARTE_OFFICIELLE_2025.md) :
 *   - `h-screen overflow-hidden` : la sidebar (flex-none, dégradé navy)
 *     reste ANCRÉE ; seule la zone de contenu défile (main overflow-y-auto).
 *   - Header conservé mais aminci et passé au navy charte (choix argumenté :
 *     il porte le logout fédéré OIDC + le badge rôle, et la session serveur
 *     lui est déjà threadée par le layout — le déplacer en bas de sidebar
 *     casserait AppHeader.test + le flux logout sans gain fonctionnel).
 *   - PageTransition (client) rejoue l'animation ipd-page-in à chaque
 *     navigation via key={pathname}, sans re-render de la sidebar.
 */
export function AppShell({ session, children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        <AppHeader session={session} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-background">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
