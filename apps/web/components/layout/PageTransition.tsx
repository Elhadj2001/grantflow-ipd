'use client';

import { usePathname } from 'next/navigation';

/**
 * Conteneur de contenu : remonté à chaque navigation (key={pathname}) →
 * rejoue l'animation d'entrée .ipd-page-in (160ms, opacity+transform,
 * désactivée via prefers-reduced-motion). La sidebar, hors de ce conteneur,
 * reste immobile. Pas de padding ici : chaque page garde son gabarit
 * existant (évite le double-padding sur ~40 pages).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="ipd-page-in">
      {children}
    </div>
  );
}
