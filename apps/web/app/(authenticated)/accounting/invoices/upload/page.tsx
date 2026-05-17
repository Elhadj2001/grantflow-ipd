'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SupplierPicker } from '@/components/procurement/pickers/SupplierPicker';
import { useUploadInvoice } from '@/hooks/use-invoicing';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Page d'upload facture. L'utilisateur dépose un PDF, choisit
 * optionnellement un fournisseur en hint (utile si l'OCR ne sait pas
 * matcher le nom), puis lance l'upload. Le backend :
 *   1. extrait le texte via pdf-parse
 *   2. crée une Invoice en statut `captured`
 *   3. renvoie l'OCR + l'invoice
 * On redirige ensuite vers /accounting/invoices/[id] pour la suite
 * (édition, soumission au matching, etc).
 *
 * OCR synchrone (pas de polling) — confirmé par l'introspection
 * backend sprint F3.
 */
export default function InvoiceUploadPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [file, setFile] = React.useState<File | null>(null);
  const [supplierHint, setSupplierHint] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const uploadM = useUploadInvoice();

  // Garde RBAC : redirection silencieuse si pas autorisé
  if (permissions.roles.length > 0 && !permissions.canUploadInvoice()) {
    router.replace('/accounting/invoices');
    return null;
  }

  const onSubmit = async () => {
    if (!file) return;
    setProgress(0);
    try {
      const result = await uploadM.mutateAsync({
        file,
        supplierId: supplierHint ?? undefined,
        onProgress: (info) => setProgress(info.pct),
      });
      router.push(`/accounting/invoices/${result.invoiceId}`);
    } catch {
      setProgress(null);
      // toast déjà géré par le hook
    }
  };

  return (
    <>
      <PageHeader
        title="Uploader une facture"
        subtitle="PDF jusqu'à 10 Mo — l'OCR extraira automatiquement les champs principaux."
        actions={
          <Button variant="outline" onClick={() => router.push('/accounting/invoices')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Fichier PDF</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileDropzone
                value={file}
                onChange={setFile}
                accept={['application/pdf']}
                maxBytes={10 * 1024 * 1024}
                disabled={uploadM.isPending}
              />
              {progress !== null && (
                <div data-testid="upload-progress" className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-muted">
                    <span>Upload + OCR en cours…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-ipd-dark transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <Label className="mb-1.5 block text-sm font-medium">
                  Fournisseur (optionnel)
                </Label>
                <SupplierPicker
                  value={supplierHint}
                  onChange={(id) => setSupplierHint(id)}
                  disabled={uploadM.isPending}
                />
                <p className="mt-1 text-xs text-slate-muted">
                  Si l'OCR ne reconnaît pas le nom du fournisseur, pré-sélectionnez-le ici.
                  Sinon laissez vide — le backend fera le matching automatique.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={onSubmit}
                  disabled={!file || uploadM.isPending}
                  data-testid="upload-submit"
                >
                  {uploadM.isPending ? 'Envoi…' : 'Lancer l\'upload + OCR'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside>
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Info className="h-4 w-4 text-ipd-darker" />
              <CardTitle className="text-sm">Comment ça fonctionne</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-muted">
              <p>
                <b className="text-slate-text">1. Capture :</b> le PDF est stocké dans
                MinIO et l'OCR (pdf-parse) extrait n° facture, dates, totaux, devise et
                référence BC s'ils sont présents dans la couche texte du PDF.
              </p>
              <p>
                <b className="text-slate-text">2. Score :</b> chaque champ a un score
                de confiance (0–100). Si la moyenne est &lt; 80%, vous serez invité à
                corriger manuellement avant le matching.
              </p>
              <p>
                <b className="text-slate-text">3. Matching 3-voies :</b> une fois les
                champs validés, soumettez la facture pour rapprochement automatique
                avec le BC et la réception. Tolérances serveur : ±2% prix / ±5% qté.
              </p>
              <p>
                <b className="text-slate-text">4. Comptabilisation :</b> action
                irréversible — crée l'écriture AC SYSCEBNL et extourne l'engagement
                classe 8.
              </p>
              <p className="pt-2 text-state-warning">
                <b>Note :</b> PDF scannés (image sans couche texte) ne sont pas OCRisés
                automatiquement — vous devrez ressaisir les champs.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
