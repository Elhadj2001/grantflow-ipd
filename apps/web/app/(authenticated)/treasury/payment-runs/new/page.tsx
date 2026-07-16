'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { useBankAccounts, useCreatePaymentRun } from '@/hooks/use-treasury';
import { useListInvoices } from '@/hooks/use-invoicing';
import { usePermissions } from '@/hooks/use-permissions';
import type { PaymentMethod } from '@/lib/api/treasury';

/**
 * Création d'un PaymentRun :
 *  1. Choix du compte bancaire
 *  2. Méthode (défaut SEPA — TRF virement)
 *  3. Multi-select factures payables (status posted/partially_paid +
 *     devise matche le compte)
 *  4. Submit → POST /payment-runs → redirige vers le détail
 */
export default function NewPaymentRunPage() {
  const router = useRouter();
  const permissions = usePermissions();
  const [bankAccountId, setBankAccountId] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<PaymentMethod>('sepa');
  const [paymentDate, setPaymentDate] = React.useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [selectedInvoices, setSelectedInvoices] = React.useState<Set<string>>(new Set());

  const banks = useBankAccounts();
  const bankAccount = banks.data?.find((b) => b.id === bankAccountId) ?? null;

  // Liste les factures comptabilisées payables — filtre côté UI par devise du compte
  const invoicesQuery = useListInvoices({ status: 'posted', pageSize: 100 });
  const invoices = invoicesQuery.data?.data ?? [];
  const compatibleInvoices = invoices.filter(
    (i) => !bankAccount || i.currency === bankAccount.currency,
  );

  const createM = useCreatePaymentRun();

  if (permissions.roles.length > 0 && !permissions.canCreatePaymentRun()) {
    router.replace('/treasury/payment-runs');
    return null;
  }

  const totalToPay = compatibleInvoices
    .filter((i) => selectedInvoices.has(i.id))
    .reduce((s, i) => s + Number(i.totalTtc), 0);

  const toggleInvoice = (id: string) => {
    const next = new Set(selectedInvoices);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedInvoices(next);
  };

  const onSubmit = async () => {
    if (!bankAccountId || selectedInvoices.size === 0) return;
    try {
      const result = await createM.mutateAsync({
        bankAccountId,
        method,
        paymentDate,
        invoiceIds: Array.from(selectedInvoices),
      });
      router.push(`/treasury/payment-runs/${result.id}`);
    } catch {
      // toast déjà géré
    }
  };

  return (
    <>
      <PageHeader
        title="Nouveau payment run"
        subtitle="Regroupez plusieurs factures à payer en une seule opération SEPA."
        actions={
          <Button variant="outline" onClick={() => router.push('/treasury/payment-runs')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="mb-1.5 block text-sm font-medium">Compte bancaire *</Label>
                <Combobox
                  testId="bank-account-picker"
                  value={bankAccountId}
                  onChange={setBankAccountId}
                  loading={banks.isLoading}
                  placeholder="Sélectionner un compte bancaire…"
                  options={(banks.data ?? []).map((b) => ({
                    value: b.id,
                    label: `${b.code} — ${b.bankName}`,
                    sublabel: `${b.currency} · ${b.accountNumber.slice(0, 8)}…`,
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="method">Méthode</Label>
                <select
                  id="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  data-testid="payment-method-select"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="sepa">SEPA</option>
                  <option value="swift">SWIFT</option>
                  <option value="check">Chèque</option>
                  <option value="direct_debit">Prélèvement</option>
                </select>
              </div>
              <div>
                <Label htmlFor="paymentDate">Date d'exécution</Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  data-testid="payment-date"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Factures à payer ({selectedInvoices.size} / {compatibleInvoices.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bankAccount ? (
                <p className="text-xs text-slate-muted">
                  Affichage des factures en {bankAccount.currency} (devise du compte).
                </p>
              ) : (
                <p className="text-xs text-slate-muted">
                  Sélectionnez un compte bancaire pour filtrer par devise.
                </p>
              )}
              {compatibleInvoices.length === 0 && bankAccount && (
                <p className="rounded-md border border-dashed border-slate-200 bg-ipd-tab-fond p-4 text-center text-sm text-slate-muted">
                  Aucune facture payable en {bankAccount.currency}. Vérifiez que les factures
                  sont comptabilisées (status <code>posted</code>).
                </p>
              )}
              <ul className="divide-y divide-slate-100">
                {compatibleInvoices.map((inv) => {
                  const checked = selectedInvoices.has(inv.id);
                  return (
                    <li
                      key={inv.id}
                      data-testid={`invoice-row-${inv.id}`}
                      className="flex items-center gap-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInvoice(inv.id)}
                        data-testid={`invoice-checkbox-${inv.id}`}
                        className="h-4 w-4 cursor-pointer accent-ipd-dark"
                      />
                      <div className="flex-1">
                        <p className="font-mono text-xs">{inv.invoiceNumber}</p>
                        <p className="text-xs text-slate-muted">
                          {inv.supplierId.slice(0, 8)}… · échéance {inv.dueDate.slice(0, 10)}
                        </p>
                      </div>
                      <AmountDisplay amount={inv.totalTtc} currency={inv.currency} />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3 rounded-md border border-slate-200 bg-white p-4">
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-muted">Total à payer</p>
              <AmountDisplay
                amount={totalToPay}
                currency={bankAccount?.currency ?? 'XOF'}
                className="text-xl"
              />
            </div>
            <Button
              size="lg"
              onClick={onSubmit}
              disabled={
                !bankAccountId || selectedInvoices.size === 0 || createM.isPending
              }
              data-testid="payment-run-submit"
            >
              {createM.isPending ? 'Création…' : 'Créer le run'}
            </Button>
          </div>
        </div>

        <aside>
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Info className="h-4 w-4 text-ipd-darker" />
              <CardTitle className="text-sm">Cycle de vie d'un run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-muted">
              <p>
                <b className="text-slate-text">1. Brouillon :</b> sélection des factures.
              </p>
              <p>
                <b className="text-slate-text">2. Préparé :</b> validation IBAN + snapshot
                des alertes anti-fraude (IBAN changé &lt; 30j).
              </p>
              <p>
                <b className="text-slate-text">3. Génération SEPA :</b> XML pain.001.001.03
                téléchargeable.
              </p>
              <p>
                <b className="text-slate-text">4. Approuvé par le DAF :</b> exécute le run,
                crée les écritures BQ classe 5 + 666/766 si multi-devise.
              </p>
              <p className="pt-2">
                <b className="text-state-warning">Séparation des tâches :</b> le Trésorier
                prépare et génère le SEPA, le DAF approuve.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
