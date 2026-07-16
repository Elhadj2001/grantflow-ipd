import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { BarChart3, CheckCircle2, Globe, Lock } from 'lucide-react';
import { auth } from '@/lib/auth';
import { LoginButton } from './login-button';

interface Feature {
  Icon: typeof CheckCircle2;
  text: string;
}

const FEATURES: Feature[] = [
  { Icon: CheckCircle2, text: 'Cycle complet DA → BC → Facture → Paiement' },
  { Icon: Lock, text: "Conformité SYSCEBNL & piste d'audit immuable" },
  { Icon: Globe, text: 'Multi-bailleurs, multi-devises, parité fixe BCEAO' },
  { Icon: BarChart3, text: 'Reporting bailleur automatisé (TER, Bilan, USAID FFR-425)' },
];

const ROLE_PREVIEWS = [
  { label: 'DAF', color: 'bg-ipd-dark text-white' },
  { label: 'Comptable', color: 'bg-navy text-white' },
  { label: 'Demandeur', color: 'bg-state-success text-white' },
];

/**
 * Sprint F1.1 — refonte page /login.
 *
 *  - Aside gauche : dégradé ipd → ipd-dark → navy (aqua qui glisse vers
 *    secondaire), pattern SVG dots, logo cerclé blanc, 4 features
 *    (CheckCircle/Lock/Globe/BarChart3), footer copyright.
 *  - Section droite : Card centrée, header "Connexion", bouton SSO
 *    Keycloak full-width, separator "ou", note redirection, mini-cards
 *    rôles, footer liens secondaires.
 *
 * Server component — délègue le bouton à login-button.tsx (client).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { callbackUrl?: string; error?: string };
}) {
  const session = await auth();
  if (session) redirect(searchParams?.callbackUrl ?? '/dashboard');
  const error = searchParams?.error;
  const callbackUrl = searchParams?.callbackUrl ?? '/dashboard';

  return (
    <main className="min-h-screen flex flex-col lg:flex-row bg-ipd-gris-clair">
      {/* ============== ASIDE (photo IPD + voile navy charte) ============== */}
      <aside
        aria-label="Présentation GRANTFLOW IPD"
        className="relative overflow-hidden bg-ipd-navy text-white p-8 lg:p-12 lg:basis-1/2 lg:flex flex-col justify-between"
      >
        {/* Photo institutionnelle + voile dégradé navy (lisibilité AA). */}
        <Image
          src="/img/login_background.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover opacity-40"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-ipd-navy/90 via-ipd-navy/70 to-ipd-navy-2/90"
        />

        <div className="relative space-y-8">
          {/* Logo officiel blanc (charte 2025) */}
          <Image
            src="/img/logo_ipd_blanc.png"
            alt="Institut Pasteur de Dakar"
            width={220}
            height={50}
            className="h-11 w-auto"
            priority
          />

          {/* Titre + sous-titre */}
          <div className="space-y-3 max-w-xl">
            <h1 className="text-4xl lg:text-5xl font-bold leading-tight !text-white">GRANTFLOW IPD</h1>
            <p className="text-ipd-hero-sous text-lg leading-relaxed">
              Automatisation Procure-to-Account & Comptabilité analytique multi-bailleurs.
            </p>
          </div>

          {/* Features list */}
          <ul className="space-y-3 max-w-md">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-sm leading-relaxed">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative pt-8 text-xs text-ipd-hero-sous">
          © 2026 Institut Pasteur de Dakar — Direction Administrative & Financière
        </div>
      </aside>

      {/* ====================== FORM (droite) ====================== */}
      <section className="flex flex-1 flex-col items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white shadow-xl p-8 space-y-6">
            <header className="space-y-2 text-center">
              <h2 className="text-3xl font-bold text-slate-text">Connexion</h2>
              <p className="text-sm text-slate-muted">Accédez à votre espace IPD.</p>
            </header>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                Échec de connexion : {error}
              </div>
            )}

            <LoginButton callbackUrl={callbackUrl} />

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-white px-3 text-slate-muted">ou</span>
              </div>
            </div>

            <p className="text-center text-sm text-slate-muted">
              Vous serez redirigé vers Keycloak pour authentification SSO.
              <br />
              <span className="text-xs">Authentification multi-facteurs activée pour DAF.</span>
            </p>

            {/* Mini-cards rôles décoratifs */}
            <div className="pt-2">
              <p className="mb-2 text-center text-xs uppercase tracking-wide text-slate-muted">
                Adapté à votre rôle
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {ROLE_PREVIEWS.map((r) => (
                  <span
                    key={r.label}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${r.color}`}
                  >
                    {r.label}
                  </span>
                ))}
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-muted">
                  + 8 rôles
                </span>
              </div>
            </div>
          </article>

          <nav
            aria-label="Liens secondaires"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-muted"
          >
            <Link href="/" className="hover:text-ipd-darker underline-offset-4 hover:underline">
              Accueil
            </Link>
            <span aria-hidden>•</span>
            <span>Documentation</span>
            <span aria-hidden>•</span>
            <span>Politique RGPD</span>
            <span aria-hidden>•</span>
            <span>Contact DAF</span>
          </nav>
        </div>
      </section>
    </main>
  );
}
