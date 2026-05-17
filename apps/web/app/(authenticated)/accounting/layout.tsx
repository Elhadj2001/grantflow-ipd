/**
 * Layout du module Comptabilité. Sprint F3 — pass-through pour
 * laisser chaque page gérer son propre PageHeader contextualisé
 * (Factures, Détail, Journal entries). AuthGuard hérité du layout
 * parent (authenticated)/.
 */
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
