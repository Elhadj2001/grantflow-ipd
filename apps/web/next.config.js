/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes désactivé pour permettre des hrefs string vers des routes
  // pas encore créées (ex: /procurement, /accounting affichés en disabled
  // dans la sidebar). À ré-activer une fois toutes les routes en place.
  experimental: { typedRoutes: false },
  transpilePackages: ['@grantflow/shared'],
  i18n: undefined, // utilisé en mode App Router via middleware si besoin
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
