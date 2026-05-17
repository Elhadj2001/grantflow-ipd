/**
 * Helpers de rendu pour les tests RTL des composants client (pickers,
 * formulaires) qui dépendent de TanStack Query et d'une session
 * authentifiée. Les tests passent le `fetchMock` qu'ils veulent utiliser
 * (via `installReferentialFetchMock()` du sibling `referential.ts`),
 * ce module se contente du wrapper.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithQuery(
  ui: React.ReactElement,
  options?: RenderOptions,
): RenderResult & { qc: QueryClient } {
  const qc = makeQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return {
    qc,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}
