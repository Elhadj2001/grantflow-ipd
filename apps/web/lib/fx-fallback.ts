/**
 * Conversion de devise indicative côté FRONTEND uniquement.
 *
 * ⚠️ NE PAS utiliser pour des écritures comptables — la vérité comptable
 * est calculée côté API via `ExchangeRateService` qui consomme la table
 * `ref.exchange_rate` (taux historiques quotidiens BCEAO + override
 * SUPER_ADMIN). Cette utilitaire ne sert QUE :
 *   - Au contrôle de plafond budgétaire UI sur le formulaire DA (sprint
 *     fix-da-multi-currency) quand la devise DA diffère de la devise
 *     convention. Le calcul reste informatif — le serveur re-vérifie au
 *     submit avec les vrais taux du jour.
 *   - À l'affichage approximatif d'équivalents XOF dans certaines cards.
 *
 * Source des taux :
 *   - EUR↔XOF : taux fixe BCEAO immuable 655.957 (cf. apps/api/prisma/seed.ts
 *     `seedFixedExchangeRates`, valide depuis 1999-01-04). Précision exacte.
 *   - USD/GBP/CHF : valeurs indicatives "ordre de grandeur" 2026 — assez
 *     justes pour un contrôle de plafond informatif (à ±5%) ; le vrai
 *     taux du jour est résolu côté serveur lors de l'imputation.
 */

const FX_BCEAO_EUR_XOF = 655.957; // BCEAO 1999-01-04, immuable

// Taux indicatifs USD/GBP/CHF → XOF (~mai 2026). Pour un contrôle de
// plafond, l'imprécision de quelques % est acceptable.
const FX_INDICATIVE_TO_XOF: Record<string, number> = {
  XOF: 1,
  EUR: FX_BCEAO_EUR_XOF,
  USD: 600,
  GBP: 770,
  CHF: 670,
};

/**
 * Convertit `amount` de la devise `from` vers la devise `to` avec les
 * taux fallback ci-dessus. Renvoie `null` si une des devises n'est pas
 * supportée (le caller doit gérer ce cas — typiquement laisser le
 * contrôle UI passer et déléguer la vérité au serveur).
 *
 * @example
 *   convertAmount(1000, 'EUR', 'XOF')  // → 655 957
 *   convertAmount(100, 'XOF', 'XOF')   // → 100 (no-op)
 *   convertAmount(50, 'JPY', 'XOF')    // → null (JPY non supporté)
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
): number | null {
  if (from === to) return amount;
  const fromRateToXof = FX_INDICATIVE_TO_XOF[from];
  const toRateToXof = FX_INDICATIVE_TO_XOF[to];
  if (fromRateToXof == null || toRateToXof == null) return null;
  // (amount in XOF) / (rate to → XOF) = amount in `to`.
  const amountInXof = amount * fromRateToXof;
  return amountInXof / toRateToXof;
}

/**
 * Liste des devises supportées pour la conversion fallback. Sert aux
 * <select> et tests. Garder synchro avec `FX_INDICATIVE_TO_XOF`.
 */
export const FX_SUPPORTED_CURRENCIES = ['XOF', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type FxSupportedCurrency = (typeof FX_SUPPORTED_CURRENCIES)[number];
