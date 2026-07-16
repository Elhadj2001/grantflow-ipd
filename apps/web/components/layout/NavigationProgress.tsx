'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Barre de progression supérieure (2px, bleu IPD) — composant MAISON, zéro
 * dépendance (nprogress = legacy DOM global, nextjs-toploader = dépendance
 * de plus pour ~60 lignes de code ; App Router n'expose pas d'événements
 * routeur, on intercepte donc les clics sur les <a> internes en phase
 * capture, et on termine quand usePathname/useSearchParams changent).
 *
 * Cinétique : démarre à 0 et « rampe » vers ~85 % (transition CSS longue,
 * jamais complète) ; à l'arrivée de la nouvelle page → 100 % + fondu.
 * N'anime que width/opacity. prefers-reduced-motion : la rampe est
 * remplacée par une simple apparition statique (CSS, cf. globals).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Clé de route STRINGIFIÉE : useSearchParams ne garantit pas la stabilité
  // référentielle de l'objet entre renders — comparer la string évite de
  // re-déclencher l'effet « arrivée » sur un simple re-render.
  const routeKey = `${pathname}?${searchParams}`;
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Départ : clic sur un lien INTERNE vers une autre page (phase capture —
  // fonctionne pour tous les <Link> sans les modifier un par un).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return; // externes / ancres ignorés
      const [destPath] = href.split(/[?#]/);
      if (destPath === window.location.pathname) return; // même page
      setPhase('loading');
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Arrivée : la route (ou la query) a changé → 100 % puis fondu.
  useEffect(() => {
    setPhase((p) => (p === 'loading' ? 'done' : p));
  }, [routeKey]);

  useEffect(() => {
    if (phase !== 'done') return;
    doneTimer.current = setTimeout(() => setPhase('idle'), 260);
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [phase]);

  if (phase === 'idle') return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5">
      <div
        data-testid="nav-progress"
        className={
          phase === 'loading'
            ? 'ipd-progress-ramp h-full bg-ipd-bleu shadow-[0_0_8px_rgba(0,137,208,.55)]'
            : 'ipd-progress-done h-full bg-ipd-bleu'
        }
      />
    </div>
  );
}
