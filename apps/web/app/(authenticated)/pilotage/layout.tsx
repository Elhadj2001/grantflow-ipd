/**
 * Layout du module Pilotage (sprint F-PILOTAGE).
 *
 * Pass-through : chaque page configure son propre PageHeader + actions
 * en fonction du rôle (CG / PI). AuthGuard hérité du layout (authenticated)/.
 */
export default function PilotageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
