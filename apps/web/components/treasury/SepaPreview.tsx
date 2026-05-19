'use client';

import { FileCode2, Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SepaPreviewProps {
  /** XML SEPA pretty-printé (généré par le backend). */
  xml: string;
  /** Numéro du PaymentRun (utilisé pour le filename de download). */
  runNumber: string;
  /** Action download (passe le blob/URL en clic). */
  onDownload?: () => void;
  /** Action "marquer comme envoyé à la banque" (Trésorier). */
  onMarkSent?: () => void;
  /** Date déjà marquée envoyée (cacher le bouton si déjà fait). */
  sentAt?: string | null;
  /** Désactive les actions pendant un fetch. */
  loading?: boolean;
  className?: string;
}

/**
 * Affichage XML SEPA en pre-formatted block (style terminal).
 *
 * Volontairement pas de syntax highlighting (cf. arbitrage F4 : highlight.js
 * pèse 80 kB juste pour du XML — trop pour notre besoin). Si vraiment
 * besoin de coloration syntaxique, créer un sprint F-polish dédié.
 *
 * Le bouton "Télécharger" est délégué via prop `onDownload` (le caller
 * récupère le XML, crée un blob et trigger un anchor download avec
 * filename "GRANTFLOW-pain001-<runNumber>-<date>.xml").
 */
export function SepaPreview({
  xml,
  runNumber,
  onDownload,
  onMarkSent,
  sentAt,
  loading,
  className,
}: SepaPreviewProps) {
  return (
    <div data-testid="sepa-preview" className={cn('overflow-hidden rounded-md border border-slate-200', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <FileCode2 className="h-3.5 w-3.5 text-ipd-darker" />
          <span className="font-medium text-slate-text">pain.001.001.03</span>
          <span className="font-mono text-slate-muted">{runNumber}</span>
          {sentAt && (
            <span className="text-state-success" data-testid="sepa-sent-mark">
              · Envoyé à la banque le {sentAt.slice(0, 10)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onDownload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDownload}
              disabled={loading}
              data-testid="sepa-download-btn"
            >
              <Download className="mr-2 h-4 w-4" /> Télécharger
            </Button>
          )}
          {onMarkSent && !sentAt && (
            <Button
              type="button"
              size="sm"
              onClick={onMarkSent}
              disabled={loading}
              data-testid="sepa-mark-sent-btn"
            >
              <Send className="mr-2 h-4 w-4" /> Marquer comme envoyé
            </Button>
          )}
        </div>
      </div>
      <pre
        data-testid="sepa-preview-xml"
        className="max-h-[60vh] overflow-x-auto whitespace-pre bg-slate-900 px-4 py-3 font-mono text-xs leading-relaxed text-emerald-300"
      >
        {xml}
      </pre>
    </div>
  );
}
