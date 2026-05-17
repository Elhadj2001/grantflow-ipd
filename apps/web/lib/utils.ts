import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Helper utilisé par tous les composants shadcn/ui :
 * combine `clsx` (gestion conditionnelle) avec `tailwind-merge`
 * (dédoublonne les classes Tailwind conflictuelles).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
