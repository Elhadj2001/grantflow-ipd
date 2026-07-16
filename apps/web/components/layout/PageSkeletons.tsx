import { Skeleton } from '@/components/ui/skeleton';

/**
 * Gabarits de skeleton par TYPE de page (polish transitions) : les formes
 * préfigurent le layout réel au lieu d'un spinner central. Les blocs sont
 * des cartes BLANCHES (comme les vraies cartes) contenant des barres
 * gris-clair pulsées — le fond body étant lui-même gris-clair, un skeleton
 * nu y serait invisible.
 *
 *   - KpiPageSkeleton    → dashboard (rangée de cartes KPI + graphique)
 *   - ListPageSkeleton   → pages liste (titre + toolbar + lignes de tableau)
 *   - DetailPageSkeleton → pages détail (deux colonnes 2/3 – 1/3)
 */

function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-carte border border-ipd-bordure-carte bg-white p-4 shadow-douce ${className}`}>
      {children}
    </div>
  );
}

function PageTitle() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

export function KpiPageSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="Chargement de la page">
      <PageTitle />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardShell key={i}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
          </CardShell>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <CardShell key={i}>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-4 h-56 w-full" />
          </CardShell>
        ))}
      </div>
    </div>
  );
}

export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="Chargement de la page">
      <div className="flex items-start justify-between gap-4">
        <PageTitle />
        <Skeleton className="h-10 w-40 rounded-btn" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-40" />
      </div>
      <CardShell className="p-0">
        <div className="border-b border-ipd-bordure-carte px-4 py-3">
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-ipd-bordure-carte px-4 py-3 last:border-b-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </CardShell>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="Chargement de la page">
      <div className="flex items-start justify-between gap-4">
        <PageTitle />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-btn" />
          <Skeleton className="h-10 w-28 rounded-btn" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <CardShell>
            <Skeleton className="h-5 w-48" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          </CardShell>
          <CardShell>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-40 w-full" />
          </CardShell>
        </div>
        <div className="space-y-4">
          <CardShell>
            <Skeleton className="h-5 w-32" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </CardShell>
          <CardShell>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mt-4 h-24 w-full" />
          </CardShell>
        </div>
      </div>
    </div>
  );
}
