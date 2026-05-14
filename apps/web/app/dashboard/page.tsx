/**
 * Dashboard du DAF / Direction.
 *
 * À implémenter au Sprint 5 :
 * - Connexion à /api/v1/dashboard
 * - KPI cards : engagements, factures à valider, DA en retard, touchless rate, alertes fraude
 * - Graphique bar : consommation par bailleur
 * - Graphique donut : répartition par programme
 * - Tableau d'alertes & actions
 *
 * Voir wireframe Écran 2 dans Wireframes_GRANTFLOW_IPD.html
 */
export default function DashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold text-ipd-900 mb-4">Tableau de bord</h1>
      <div className="card">
        <p className="text-slate-500 text-sm">
          🛠️ Page à implémenter au Sprint 5 (voir <code>ANTIGRAVITY_PROMPTS.md</code> et le wireframe Écran 2).
        </p>
      </div>
    </main>
  );
}
