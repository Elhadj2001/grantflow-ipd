import { Suspense } from 'react';
import { AppSidebar } from './AppSidebar';
import { NavigationProgress } from './NavigationProgress';
import { PageTransition } from './PageTransition';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Coquille authentifiée — pattern charte 2025 (référence Fact & Paie) :
 *   - `h-screen overflow-hidden` : la sidebar (flex-none, dégradé navy)
 *     reste ANCRÉE ; seule la zone de contenu défile.
 *   - Plus de header : la marque vit dans la sidebar (logo blanc) et le
 *     bloc profil + déconnexion fédérée OIDC vit EN BAS de sidebar
 *     (correctif retour user post-preview). Le main récupère toute la
 *     hauteur.
 *   - PageTransition rejoue l'animation ipd-page-in à chaque navigation
 *     (key={pathname}) sans re-render de la sidebar.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      {/* Colonne contenu `relative` : la barre de progression est ancrée en
          haut de la ZONE CONTENU (hors du conteneur scrollable → ne défile
          pas). Suspense requis par useSearchParams (Next 14). */}
      <div className="relative flex h-screen min-w-0 flex-1 flex-col">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-y-auto bg-background">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
