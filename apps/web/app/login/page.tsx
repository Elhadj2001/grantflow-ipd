import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LoginButton } from './login-button';

/**
 * Page /login : si l'utilisateur est déjà authentifié, redirige vers
 * /dashboard. Sinon affiche la card centrée avec le bouton "Se
 * connecter avec Keycloak" qui déclenche signIn('keycloak') côté client.
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
    <main className="min-h-screen grid lg:grid-cols-2 bg-cream">
      <aside className="hidden lg:flex flex-col justify-center bg-pasteur text-white p-12">
        <div className="text-5xl font-bold mb-3">G</div>
        <h2 className="text-3xl font-bold mb-3">GRANTFLOW IPD</h2>
        <p className="opacity-90 max-w-md">
          Plateforme intégrée Procure-to-Account et comptabilité analytique
          multi-bailleurs — Institut Pasteur de Dakar.
        </p>
        <p className="text-xs opacity-60 mt-12">
          © 2026 Institut Pasteur de Dakar — Conforme SYSCEBNL
        </p>
      </aside>

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-text">Bienvenue</h3>
            <p className="text-sm text-slate-muted mt-1">
              Connectez-vous avec votre compte Pasteur (SSO Keycloak).
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              Échec de connexion : {error}
            </div>
          )}

          <LoginButton callbackUrl={callbackUrl} />

          <p className="text-xs text-slate-muted text-center">
            En cas de problème, contactez votre DAF ou consultez{' '}
            <Link href="/" className="underline">l'accueil</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
