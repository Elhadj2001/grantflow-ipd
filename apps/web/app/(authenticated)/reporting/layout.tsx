/**
 * Layout du module Reporting (sprint F5a) — pass-through.
 *
 * Chaque page configure son propre PageHeader. AuthGuard hérité du
 * layout (authenticated)/. Le filtrage RBAC est appliqué dans la
 * sidebar (`canViewReporting`) et chaque page redirige si l'accès
 * est refusé.
 */
export default function ReportingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
