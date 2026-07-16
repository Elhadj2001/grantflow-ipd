import type { Metadata } from 'next';
import './globals.css';
import { lato, poppins } from './fonts';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'GRANTFLOW IPD',
  description: 'Plateforme intégrée Procure-to-Account & Comptabilité Analytique — Institut Pasteur de Dakar',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${poppins.variable} ${lato.variable}`}>
      {/* Fond gris très clair charte (#F2F3F5) + Lato corps — cf. globals.css. */}
      <body className="min-h-screen bg-ipd-gris-clair text-slate-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
