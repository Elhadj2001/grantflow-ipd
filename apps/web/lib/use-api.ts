'use client';

import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { signOut, useSession } from 'next-auth/react';
import { useCallback } from 'react';
import { apiFetch, ApiError, type ApiFetchOptions } from './api-client';
import { toast } from '@/hooks/use-toast';

/**
 * Map d'une ApiError sur une action UI :
 *  - 401 → signOut() + toast info (redirige vers /login configuré dans next-auth.pages)
 *  - 403 → toast erreur permission (sans signOut, l'utilisateur reste connecté)
 *  - 5xx → toast erreur générique + console.error (audit)
 *  - autres 4xx → silencieux côté hook, le caller décide (validation, etc.)
 */
export function mapApiErrorToToast(err: unknown): void {
  if (!(err instanceof ApiError)) {
    toast({
      variant: 'destructive',
      title: 'Erreur inattendue',
      description: err instanceof Error ? err.message : 'Une erreur est survenue',
    });
    return;
  }
  if (err.status === 401) {
    toast({
      title: 'Session expirée',
      description: 'Veuillez vous reconnecter.',
    });
    void signOut({ callbackUrl: '/login' });
    return;
  }
  if (err.status === 403) {
    toast({
      variant: 'destructive',
      title: 'Permission refusée',
      description: err.body.message ?? "Vous n'avez pas les droits pour cette action.",
    });
    return;
  }
  if (err.status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[useApi] 5xx', err.status, err.body);
    toast({
      variant: 'destructive',
      title: 'Erreur serveur',
      description: 'Réessayez dans un instant ou contactez votre administrateur.',
    });
  }
}

export interface UseApiQueryArgs<T> {
  queryKey: readonly unknown[];
  /** Chemin (relatif à NEXT_PUBLIC_API_URL) ou URL absolue. */
  path: string;
  /** Options fetch — accessToken injecté automatiquement par le hook. */
  fetchOptions?: Omit<ApiFetchOptions, 'accessToken'>;
  /** Options TanStack Query supplémentaires (enabled, staleTime, …). */
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;
}

/**
 * Hook React Query autour de `apiFetch`. Injecte automatiquement le
 * Bearer token de la session next-auth. Map les erreurs critiques
 * (401/403/5xx) sur le toast global et déconnecte l'utilisateur en
 * cas de 401.
 */
export function useApiQuery<T>({
  queryKey,
  path,
  fetchOptions,
  options,
}: UseApiQueryArgs<T>): UseQueryResult<T, ApiError> {
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken ?? null;

  return useQuery<T, ApiError>({
    queryKey,
    queryFn: async () => {
      try {
        return await apiFetch<T>(path, { ...fetchOptions, accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
    // Pas de fetch tant que la session n'est pas chargée (évite 401 inutile)
    enabled: status === 'authenticated' && (options?.enabled ?? true),
    ...options,
  });
}

export interface UseApiMutationArgs<TInput, TResult> {
  /** Construit le chemin à partir de l'input (utile pour /resource/:id). */
  path: string | ((input: TInput) => string);
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  options?: Omit<UseMutationOptions<TResult, ApiError, TInput>, 'mutationFn'>;
}

/**
 * Variante mutation : POST/PUT/PATCH/DELETE avec body JSON
 * automatiquement encodé. Même mapping d'erreurs que useApiQuery.
 */
export function useApiMutation<TInput, TResult = unknown>({
  path,
  method = 'POST',
  options,
}: UseApiMutationArgs<TInput, TResult>): UseMutationResult<TResult, ApiError, TInput> {
  const { data: session } = useSession();
  const accessToken = session?.accessToken ?? null;

  const mutate = useCallback(
    async (input: TInput) => {
      const resolvedPath = typeof path === 'function' ? path(input) : path;
      try {
        return await apiFetch<TResult>(resolvedPath, {
          method,
          accessToken,
          json: input,
        });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
    [path, method, accessToken],
  );

  return useMutation<TResult, ApiError, TInput>({
    mutationFn: mutate,
    ...options,
  });
}
