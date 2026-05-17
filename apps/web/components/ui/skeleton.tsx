import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder pendant le chargement d'un fetch.
 * Pulse animation Tailwind, fond muted.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
