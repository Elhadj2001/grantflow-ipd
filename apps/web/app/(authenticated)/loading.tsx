import { ListPageSkeleton } from '@/components/layout/PageSkeletons';

/**
 * Skeleton de segment par défaut : feedback INSTANTANÉ à la navigation
 * pendant le rendu serveur du segment. Forme « liste » (la majorité des
 * pages) ; le dashboard et les pages détail ont leur propre loading.tsx
 * plus fidèle (KPI / deux colonnes).
 */
export default function AuthenticatedLoading() {
  return <ListPageSkeleton />;
}
