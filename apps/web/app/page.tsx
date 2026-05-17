import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/**
 * Racine `/` : redirige vers /dashboard si authentifié, sinon /login.
 * Centralise la décision d'entrée pour éviter une landing page distincte.
 */
export default async function RootPage() {
  const session = await auth();
  redirect(session ? '/dashboard' : '/login');
}
