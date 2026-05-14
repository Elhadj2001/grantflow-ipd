'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // TODO: appeler /api/v1/auth/login (Sprint 0)
    setTimeout(() => {
      setLoading(false);
      router.push('/dashboard');
    }, 600);
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      <aside className="hidden lg:flex flex-col justify-center bg-gradient-to-br from-ipd-700 to-ipd-500 text-white p-12">
        <div className="text-5xl font-bold mb-3">G</div>
        <h2 className="text-3xl font-bold mb-3">GRANTFLOW</h2>
        <p className="opacity-85">
          Plateforme intégrée de gestion Procure-to-Account et de comptabilité analytique
          multi-bailleurs.
        </p>
        <p className="text-xs opacity-60 mt-12">
          © 2026 Institut Pasteur de Dakar — Conforme SYSCEBNL
        </p>
      </aside>
      <section className="flex items-center justify-center p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <h3 className="text-2xl font-bold">Bienvenue</h3>
          <p className="text-sm text-slate-500 mb-4">Connectez-vous avec votre compte IPD.</p>
          <div>
            <label className="label-input">Adresse e-mail</label>
            <input className="input" type="email" required value={email}
                   onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@pasteur.sn" />
          </div>
          <div>
            <label className="label-input">Mot de passe</label>
            <input className="input" type="password" required value={password}
                   onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
          <div className="relative my-4 text-center text-xs text-slate-400">
            <span className="bg-slate-50 px-2">— ou —</span>
            <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200 -z-10" />
          </div>
          <button type="button" className="btn-outline w-full">🔑 SSO Microsoft 365</button>
        </form>
      </section>
    </main>
  );
}
