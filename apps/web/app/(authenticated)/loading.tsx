import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton de segment (Phase 4 refonte 2025) : feedback INSTANTANÉ à la
 * navigation pendant le rendu serveur / chargement du segment — avant ce
 * fichier, l'écran restait figé sur la page précédente (aucun loading.tsx
 * dans l'app). Gabarit générique : titre + rangée de cartes + tableau.
 */
export default function AuthenticatedLoading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="Chargement de la page">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-carte" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-carte" />
    </div>
  );
}
