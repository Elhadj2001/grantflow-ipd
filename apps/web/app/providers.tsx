'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { SessionProvider } from 'next-auth/react';
import { useState } from 'react';
import { Toaster } from '@/components/ui/toaster';

/**
 * Providers globaux montés une seule fois dans le RootLayout.
 *  - SessionProvider : expose useSession() partout côté client
 *  - QueryClientProvider : TanStack Query (avec staleTime 30 s)
 *  - ReactQueryDevtools : panneau debug (dev seulement, auto-stripped en prod)
 *  - Toaster : système de toast global (cf. hooks/use-toast.ts)
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    <SessionProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
        {process.env.NODE_ENV !== 'production' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  );
}
