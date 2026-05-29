/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sprint F-DEPLOY-CLOUD : `output: 'standalone'` produit un dossier
  // `.next/standalone/` self-contained (server.js + minimal node_modules)
  // utilisé par le Dockerfile de phase 2 (migration vers le cloud IPD).
  // Vercel l'ignore — leur build pipeline a son propre packager. Sans effet
  // négatif sur le déploiement Vercel courant.
  output: 'standalone',
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
