'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetchBlob } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * US-069 — visualisation de documents, pattern porté du projet frère
 * « Enregistrement Fact et Paie » (apercu-pdf.tsx / visionneuse.tsx),
 * adapté charte GRANTFLOW + auth Bearer cross-origin :
 *
 *  - le document est TOUJOURS récupéré via apiFetchBlob (Authorization en
 *    header) puis affiché depuis un blob: local — plus aucun embed direct
 *    d'URL API (règle CSP + token + fiabilité) ;
 *  - `ApercuPdf` : aperçu inline (iframe #view=FitH) avec états charte
 *    chargement / vide (« Aucun document archivé ») / erreur — jamais
 *    d'icône cassée ;
 *  - `VisionneuseDocument` : plein écran (portal, aria-modal, Échap,
 *    verrouillage du scroll) avec Télécharger ;
 *  - Télécharger = même flux blob + attribut download.
 */

type EtatChargement =
  | { etat: 'chargement' }
  | { etat: 'ok'; src: string; mime: string }
  | { etat: 'absent' } // 404 BUSINESS.DOCUMENT_NOT_FOUND → état vide charte
  | { etat: 'erreur'; message: string };

/** Charge le document en blob URL (révoqué automatiquement à l'unmount). */
function useDocumentBlob(path: string | null): EtatChargement {
  const { data: session } = useSession();
  const accessToken = session?.accessToken ?? null;
  const [etat, setEtat] = React.useState<EtatChargement>({ etat: 'chargement' });

  React.useEffect(() => {
    if (!path || !accessToken) return;
    let annule = false;
    let revoque: string | null = null;
    setEtat({ etat: 'chargement' });
    apiFetchBlob(path, { accessToken })
      .then(({ blob, contentType }) => {
        if (annule) return;
        const src = URL.createObjectURL(blob);
        revoque = src;
        setEtat({ etat: 'ok', src, mime: contentType });
      })
      .catch((err: unknown) => {
        if (annule) return;
        if (err instanceof ApiError && err.status === 404) {
          setEtat({ etat: 'absent' });
        } else if (err instanceof ApiError && err.status === 503) {
          setEtat({ etat: 'erreur', message: 'Stockage documentaire momentanément indisponible.' });
        } else {
          setEtat({ etat: 'erreur', message: 'Erreur lors du chargement du document.' });
        }
      });
    return () => {
      annule = true;
      if (revoque) URL.revokeObjectURL(revoque);
    };
  }, [path, accessToken]);

  return path ? etat : { etat: 'absent' };
}

/** Télécharge un document via le flux blob authentifié (attribut download). */
export async function telechargerDocument(
  path: string,
  accessToken: string | null,
  filename: string,
): Promise<void> {
  const { blob, filename: serverName } = await apiFetchBlob(path, { accessToken });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = serverName ?? filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function EtatVide({ hauteur, message }: { hauteur: string; message: string }) {
  return (
    <div
      data-testid="document-etat-vide"
      className={cn('grid place-items-center rounded-md bg-ipd-gris-clair px-4 text-center', hauteur)}
    >
      <div className="text-sm text-slate-muted">
        <FileText className="mx-auto mb-2 h-8 w-8" />
        {message}
      </div>
    </div>
  );
}

export interface ApercuPdfProps {
  /** Chemin API relatif (ex. `/invoices/:id/pdf`) — null = aucun document. */
  path: string | null;
  titre: string;
  /** Classe de hauteur (défaut h-[460px], pattern référence). */
  hauteur?: string;
  className?: string;
}

/** Aperçu inline d'un document PDF/image, états charte. */
export function ApercuPdf({ path, titre, hauteur = 'h-[460px]', className }: ApercuPdfProps) {
  const chargement = useDocumentBlob(path);

  return (
    <div className={className}>
      {chargement.etat === 'chargement' && (
        <div
          data-testid="document-apercu-chargement"
          className={cn('grid place-items-center rounded-md bg-ipd-gris-clair', hauteur)}
        >
          <Loader2 className="h-6 w-6 animate-spin text-ipd-bleu" />
        </div>
      )}
      {chargement.etat === 'absent' && (
        <EtatVide hauteur={hauteur} message="Aucun document archivé." />
      )}
      {chargement.etat === 'erreur' && (
        <EtatVide hauteur={hauteur} message={chargement.message} />
      )}
      {chargement.etat === 'ok' &&
        (chargement.mime.includes('pdf') ? (
          <iframe
            data-testid="document-apercu-iframe"
            // Fragment de vue : lecteur ajusté à la largeur (Chromium/Edge),
            // côté client uniquement (le « # » ne change pas la requête).
            src={`${chargement.src}#view=FitH&toolbar=1`}
            title={titre}
            sandbox="allow-same-origin"
            className={cn('block w-full rounded-md border border-ipd-bordure-carte bg-ipd-gris-clair', hauteur)}
          />
        ) : (
          <div className={cn('grid place-items-center overflow-auto rounded-md bg-ipd-gris-clair p-2', hauteur)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chargement.src} alt={titre} className="max-h-full max-w-full object-contain" />
          </div>
        ))}
    </div>
  );
}

export interface VisionneuseDocumentProps {
  ouvert: boolean;
  titre: string;
  /** Chemin API relatif du document. */
  path: string;
  filename: string;
  onFermer: () => void;
}

/** Visionneuse plein écran (portal, aria-modal, Échap, Télécharger). */
export function VisionneuseDocument({
  ouvert,
  titre,
  path,
  filename,
  onFermer,
}: VisionneuseDocumentProps) {
  const { data: session } = useSession();
  const [monte, setMonte] = React.useState(false);

  React.useEffect(() => {
    setMonte(true);
  }, []);

  React.useEffect(() => {
    if (!ouvert) return;
    const ancien = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFermer();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = ancien;
    };
  }, [ouvert, onFermer]);

  if (!ouvert || !monte) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      data-testid="document-visionneuse"
      onClick={onFermer}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-[92vw] max-w-[900px] flex-col overflow-hidden rounded-carte border border-ipd-bordure-carte bg-white shadow-carte"
      >
        <div className="flex items-center gap-3 border-b border-ipd-bordure-carte px-4 py-2.5">
          <span className="font-titre text-sm font-semibold text-ipd-navy">{titre}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void telechargerDocument(path, session?.accessToken ?? null, filename)
              }
            >
              Télécharger
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onFermer}>
              Fermer
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-ipd-gris-clair">
          <ApercuPdf path={path} titre={titre} hauteur="h-full" className="h-full" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
