/**
 * Layout du module Procurement. Pour le sprint F2, ce layout est
 * un simple pass-through — le breadcrumb est rendu dans chaque page
 * via PageHeader pour rester contextualisé (DA / BC / GR).
 *
 * L'AuthGuard est garanti par le layout parent (authenticated)/.
 */
export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
