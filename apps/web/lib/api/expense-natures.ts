import { apiFetch, type ApiFetchOptions } from '@/lib/api-client';

/**
 * US-064 — catalogue des natures de dépense (grant_office.expense_nature,
 * seedé US-032). Read-only : consommé par le select du formulaire DA et
 * l'affichage détail (mapping code → libellé).
 */
export interface ExpenseNature {
  id: string;
  code: string;
  label: string;
  category: string;
  defaultAccountClass: string | null;
  description: string | null;
}

export function listExpenseNatures(options: ApiFetchOptions = {}) {
  return apiFetch<ExpenseNature[]>('/expense-natures', options);
}
