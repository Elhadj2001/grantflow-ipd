'use client';

import * as React from 'react';
import { useSession } from 'next-auth/react';
import { Download, Eye, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DateDisplay } from '@/components/common/DateDisplay';
import {
  ApercuPdf,
  VisionneuseDocument,
  telechargerDocument,
} from '@/components/common/DocumentViewer';
import type { EntityDocument } from '@/lib/api/documents';

export interface DocumentsPanelProps {
  /** Documents à afficher — undefined pendant le chargement. */
  documents: EntityDocument[] | undefined;
  isLoading?: boolean;
  /** true si le listing a échoué (l'état d'erreur charte est rendu). */
  isError?: boolean;
  /** Aperçu inline du premier document (défaut true — pattern facture). */
  inlinePreview?: boolean;
  /** Message d'état vide (défaut « Aucun document archivé… »). */
  emptyMessage?: string;
  className?: string;
}

const KIND_LABELS: Record<EntityDocument['kind'], string> = {
  invoice_pdf: 'Facture fournisseur (PDF)',
  po_pdf: 'Bon de commande (PDF)',
};

function formatTaille(sizeBytes: number | null): string | null {
  if (sizeBytes == null) return null;
  if (sizeBytes < 1024) return `${sizeBytes} o`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} Ko`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * US-069 — panneau Documents généralisé (pattern porté du projet frère,
 * charte GRANTFLOW) : liste des documents d'une entité (nom, type, date,
 * taille si disponible) + Aperçu (visionneuse plein écran) + Télécharger,
 * avec aperçu inline optionnel du premier document.
 *
 * Une entité sans document stocké (DA, BL/GR aujourd'hui) affiche l'état
 * vide charte — jamais d'icône cassée.
 */
export function DocumentsPanel({
  documents,
  isLoading = false,
  isError = false,
  inlinePreview = true,
  emptyMessage = 'Aucun document archivé pour cet élément.',
  className,
}: DocumentsPanelProps) {
  const { data: session } = useSession();
  const [visionneuse, setVisionneuse] = React.useState<EntityDocument | null>(null);

  const docs = documents ?? [];
  const premier = docs[0] ?? null;

  return (
    <Card className={className} data-testid="documents-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-ipd-bleu" /> Documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="space-y-2" data-testid="documents-panel-chargement">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!isLoading && isError && (
          <p className="text-sm text-slate-muted" data-testid="documents-panel-erreur">
            Impossible de lister les documents (réessayez plus tard).
          </p>
        )}

        {!isLoading && !isError && docs.length === 0 && (
          <div
            data-testid="documents-panel-vide"
            className="grid place-items-center rounded-md bg-ipd-gris-clair px-4 py-8 text-center"
          >
            <div className="text-sm text-slate-muted">
              <FileText className="mx-auto mb-2 h-8 w-8" />
              {emptyMessage}
            </div>
          </div>
        )}

        {!isLoading && !isError && docs.length > 0 && (
          <>
            <ul className="divide-y divide-ipd-bordure-carte" data-testid="documents-panel-liste">
              {docs.map((doc) => {
                const taille = formatTaille(doc.sizeBytes);
                return (
                  <li key={doc.objectKey} className="flex items-center gap-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{doc.label}</p>
                      <p className="text-xs text-slate-muted">
                        {KIND_LABELS[doc.kind]}
                        {doc.storedAt && (
                          <>
                            {' · '}
                            <DateDisplay value={doc.storedAt} format="short" />
                          </>
                        )}
                        {taille && ` · ${taille}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisionneuse(doc)}
                      data-testid={`document-apercu-${doc.kind}`}
                    >
                      <Eye className="mr-1 h-4 w-4" /> Aperçu
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void telechargerDocument(
                          doc.downloadPath,
                          session?.accessToken ?? null,
                          doc.label,
                        )
                      }
                      data-testid={`document-telecharger-${doc.kind}`}
                    >
                      <Download className="mr-1 h-4 w-4" /> Télécharger
                    </Button>
                  </li>
                );
              })}
            </ul>

            {inlinePreview && premier && (
              <ApercuPdf path={premier.downloadPath} titre={premier.label} />
            )}
          </>
        )}
      </CardContent>

      {visionneuse && (
        <VisionneuseDocument
          ouvert
          titre={visionneuse.label}
          path={visionneuse.downloadPath}
          filename={visionneuse.label}
          onFermer={() => setVisionneuse(null)}
        />
      )}
    </Card>
  );
}
