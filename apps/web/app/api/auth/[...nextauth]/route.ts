import { handlers } from '@/lib/auth';

/**
 * Route handler next-auth v5 — délègue à `handlers.GET / .POST`
 * fournis par `NextAuth()`. Gère :
 *  - GET  /api/auth/signin
 *  - GET  /api/auth/callback/keycloak
 *  - POST /api/auth/signout
 *  - GET  /api/auth/session
 *  - GET  /api/auth/csrf
 */
export const { GET, POST } = handlers;
