'use client';

import * as React from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

export interface PdfFrameProps {
  /** Chemin relatif à l'API (ex: `/invoices/abc/pdf`). */
  path: string;
  /** Hauteur (CSS — défaut 600px). */
  height?: number | string;
  className?: string;
  /** Libellé pour le bouton de téléchargement. */
  filename?: string;
}

/**
 * Affiche un PDF en iframe sandboxed. Le PDF est récupéré via fetch
 * authentifié (Bearer token), converti en Blob URL, puis injecté dans
 * un iframe — ainsi on ne fuit pas le token dans l'URL.
 *
 * Plus léger que pdfjs-dist (zero dep, viewer natif du navigateur).
 * Pour zoom/navigation page-par-page, prévoir un upgrade en sprint
 * dédié (F3.y) si nécessaire.
 */
export function PdfFrame({ path, height = 600, className, filename = 'document.pdf' }: PdfFrameProps) {
  const { data: session } = useSession();
  const accessToken = session?.accessToken ?? null;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
        const fullUrl = path.startsWith('http')
          ? path
          : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

        const res = await fetch(fullUrl, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (!res.ok) {
          if (cancelled) return;
          setError(
            res.status === 404
              ? 'PDF indisponible (facture saisie manuellement ?).'
              : `Erreur ${res.status} lors du chargement du PDF.`,
          );
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erreur réseau');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (accessToken) {
      void load();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, accessToken]);

  if (loading) {
    return (
      <div
        data-testid="pdf-frame-loading"
        className={cn(
          'flex items-center justify-center rounded-md border border-slate-200 bg-slate-50',
          className,
        )}
        style={{ height }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-ipd-darker" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div
        data-testid="pdf-frame-error"
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 bg-cream p-6 text-center',
          className,
        )}
        style={{ height }}
      >
        <FileWarning className="h-8 w-8 text-slate-muted" />
        <p className="text-sm text-slate-muted">{error ?? 'PDF non chargé'}</p>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)} style={{ height }}>
      <iframe
        title="Aperçu PDF"
        data-testid="pdf-frame-iframe"
        src={blobUrl}
        className="h-full w-full rounded-md border border-slate-200"
        // sandbox sans allow-scripts — un PDF ne doit pas exécuter de JS
        sandbox=""
      />
      <a
        href={blobUrl}
        download={filename}
        className="absolute right-2 top-2"
      >
        <Button type="button" size="sm" variant="outline">
          Télécharger
        </Button>
      </a>
    </div>
  );
}
