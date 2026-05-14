/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
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
