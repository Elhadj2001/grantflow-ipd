'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface HealthResponse {
  status: string;
  ts: string;
}

/**
 * Mini bloc "Statut système" affiché en bas de la sidebar.
 * Ping `/health` toutes les 30 s. 3 états visuels :
 *   - vert + "API en ligne" si 200 OK
 *   - ambre + "Connexion lente" pendant le 1er chargement
 *   - rouge + "API hors ligne" si erreur
 *
 * `/health` est PUBLIC côté API (cf. apps/api/src/health) — pas
 * besoin d'access token.
 */
export function SystemStatus() {
  const { data, isLoading, isError } = useQuery<HealthResponse, ApiError>({
    queryKey: ['system', 'health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    // Pas de retry : si /health échoue on bascule directement sur "offline"
    // (le polling toutes les 30 s tentera à nouveau, inutile de spammer).
    retry: false,
    staleTime: 25_000,
  });

  const status: 'online' | 'loading' | 'offline' = isLoading
    ? 'loading'
    : isError || data?.status !== 'ok'
      ? 'offline'
      : 'online';

  const config = {
    online: {
      dot: 'bg-state-success',
      ring: 'ring-state-success/30',
      label: 'API en ligne',
      labelClass: 'text-slate-muted',
    },
    loading: {
      dot: 'bg-state-warning',
      ring: 'ring-state-warning/30',
      label: 'Connexion…',
      labelClass: 'text-slate-muted',
    },
    offline: {
      dot: 'bg-state-error',
      ring: 'ring-state-error/30',
      label: 'API hors ligne',
      labelClass: 'text-state-error',
    },
  } as const;
  const c = config[status];

  return (
    <div
      data-testid="system-status"
      data-status={status}
      className="flex items-center gap-2 text-xs"
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-2 w-2 rounded-full ring-2',
          c.dot,
          c.ring,
          status === 'loading' && 'animate-pulse',
        )}
      />
      <span className={cn('font-medium', c.labelClass)}>{c.label}</span>
    </div>
  );
}
