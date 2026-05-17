/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes désactivé pour permettre des hrefs string vers des routes
  // pas encore créées (ex: /procurement, /accounting affichés en disabled
  // dans la sidebar). À ré-activer une fois toutes les routes en place.
  experimental: { typedRoutes: false },
  transpilePackages: ['@grantflow/shared'],
  i18n: undefined, // utilisé en mode App Router via middleware si besoin
  // Pas de rewrite /api/* → on appelle directement le backend depuis
  // lib/api-client.ts (NEXT_PUBLIC_API_URL). Cela évite que les routes
  // NextAuth /api/auth/* soient capturées par erreur et proxifiées.
  // Si besoin d'un proxy serveur plus tard (pour SSR/CORS), utiliser
  // un préfixe dédié type /backend/:path* qui n'entre pas en conflit.
};

module.exports = nextConfig;
