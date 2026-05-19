/**
 * Layout du module Trésorerie. Sprint F4b — pass-through pour laisser
 * chaque page gérer son propre PageHeader contextualisé.
 * AuthGuard hérité du layout parent (authenticated)/.
 */
export default function TreasuryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
