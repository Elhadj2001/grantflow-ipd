'use client';

import { signIn } from 'next-auth/react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Bouton client-side qui déclenche `signIn('keycloak')`. Séparé en
 * fichier client pour permettre à la page `LoginPage` de rester
 * server-component (et de pouvoir appeler `auth()`).
 */
export function LoginButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      onClick={() => signIn('keycloak', { callbackUrl })}
    >
      <LogIn className="mr-2 h-4 w-4" />
      Se connecter avec Keycloak
    </Button>
  );
}
