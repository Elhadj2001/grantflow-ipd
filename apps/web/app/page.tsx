import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ipd-700 to-ipd-500 text-white p-8">
      <div className="max-w-2xl text-center space-y-6">
        <div className="text-6xl font-bold">G</div>
        <h1 className="text-4xl font-bold tracking-tight">GRANTFLOW IPD</h1>
        <p className="text-lg opacity-90">
          Plateforme intégrée de gestion Procure-to-Account et de comptabilité analytique
          multi-bailleurs pour l'Institut Pasteur de Dakar.
        </p>
        <div className="flex justify-center gap-3 pt-4">
          <Link href="/login" className="btn-primary bg-white text-ipd-700 hover:bg-slate-100">
            Se connecter →
          </Link>
          <Link href="/dashboard" className="btn-outline bg-transparent border-white text-white hover:bg-white/10">
            Démo
          </Link>
        </div>
        <div className="pt-8 text-xs opacity-70">
          Mémoire MIAGE — El Hadj Amadou NIANG — 2025/2026
        </div>
      </div>
    </main>
  );
}
