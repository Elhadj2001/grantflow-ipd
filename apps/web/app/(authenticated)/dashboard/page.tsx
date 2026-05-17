import { FileBarChart, FileText, Wallet } from 'lucide-react';
import { auth } from '@/lib/auth';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard } from '@/components/common/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Page d'accueil de l'app authentifiée. Pour le sprint F1, on
 * présente :
 *  - L'en-tête PageHeader avec la date du jour (formatée FR)
 *  - 3 KpiCards en placeholders (valeurs "—" en attendant les
 *    endpoints dashboard du sprint F2)
 *  - Une carte de bienvenue avec fullName + rôles en badges
 */
export default async function DashboardPage() {
  const session = await auth();
  // Layout (authenticated) garantit session non nulle, mais TS ne sait
  // pas ça via `auth()` typing — guard défensif.
  const fullName = session?.fullName ?? session?.user?.email ?? 'Utilisateur';
  const roles = session?.roles ?? [];

  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`Aujourd'hui — ${today}`} />

      <div className="p-8 space-y-6">
        <section
          aria-labelledby="kpis-heading"
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          <h2 id="kpis-heading" className="sr-only">
            Indicateurs clés
          </h2>
          <KpiCard
            label="DA en attente"
            value="—"
            hint="Demandes d'achat à approuver"
            icon={FileText}
            accent="pasteur"
          />
          <KpiCard
            label="Factures à matcher"
            value="—"
            hint="3-way matching à valider"
            icon={FileBarChart}
            accent="navy"
          />
          <KpiCard
            label="Budget consommé"
            value="—%"
            hint="Toutes conventions confondues"
            icon={Wallet}
            accent="success"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Bienvenue, {fullName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-muted">
              Cet espace vous donnera une vue temps réel de vos engagements, vos
              factures à matcher, votre consommation budgétaire et vos rapports
              bailleurs. Les indicateurs ci-dessus seront alimentés au sprint
              F2 par les endpoints <code className="rounded bg-muted px-1">/api/v1/dashboard</code>.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {roles.length === 0 ? (
                <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-muted">
                  Aucun rôle GRANTFLOW attribué
                </span>
              ) : (
                roles.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-pasteur-50 px-2.5 py-0.5 text-xs font-medium text-pasteur"
                  >
                    {r}
                  </span>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
