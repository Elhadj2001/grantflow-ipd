import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';

/**
 * AuthGuard côté serveur : si pas de session → redirect /login
 * (avec callbackUrl pour retour après auth). Toutes les pages
 * sous `app/(authenticated)/` héritent automatiquement de ce check
 * + de l'AppShell (sidebar navy — le profil/logout y vit, plus de header).
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) {
    redirect('/login?callbackUrl=/dashboard');
  }
  return <AppShell>{children}</AppShell>;
}
