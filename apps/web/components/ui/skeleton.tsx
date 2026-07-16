import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder pendant le chargement d'un fetch.
 * Pulse animation Tailwind, fond muted.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Shimmer doux charte : pulse sur gris-clair (fond body) — plus discret
  // que bg-muted par défaut et cohérent avec les loading.tsx segmentés.
  return <div className={cn('animate-pulse rounded-md bg-ipd-gris-clair', className)} {...props} />;
}

export { Skeleton };
