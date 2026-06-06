/**
 * Constantes FX UEMOA — SOURCE UNIQUE de la politique de change GRANTFLOW IPD.
 *
 * Voir `docs/uemoa-exchange-rate.md` (section « Politique FX GRANTFLOW IPD »)
 * et ADR-005 (multidevise tripartite). La valeur littérale 655.957 ne doit
 * apparaître qu'ICI dans le code applicatif (le frontend `apps/web` a son
 * propre fallback isolé, bundle séparé).
 *
 * Référence : https://www.bceao.int/
 */

/**
 * Parité immuable BCEAO EUR/XOF, fixée par les accords successifs de
 * Bretton Woods, garantie par le Trésor français depuis 1999
 * (entrée en vigueur de l'euro, 04/01/1999) :
 *
 *   1 EUR = 655,957 XOF        (exactement)
 *   1 XOF = 1 / 655,957 EUR    ≈ 0,001 524 49 EUR
 *
 * NE PAS MODIFIER sauf modification du traité international (acte du Conseil
 * des Ministres de l'UEMOA + avis de la Banque de France). Toute conversion
 * EUR↔XOF DOIT utiliser cette constante (cf. ExchangeRateService.convertToXof).
 */
export const FX_BCEAO_EUR_XOF = 655.957 as const;

/** Inverse exact — calculé une fois pour éviter la dérive flottante. */
export const FIXED_XOF_EUR = 1 / FX_BCEAO_EUR_XOF;

/** Date charnière historique : entrée en vigueur de la parité. */
export const FIXED_PARITY_DATE = '1999-01-04';

/** Source à inscrire dans `ref.exchange_rate.source`. */
export const FIXED_PARITY_SOURCE = 'BCEAO_FIXED';

/**
 * Taux fallback INDICATIFS pour USD/GBP/CHF tant que la table
 * `ref.exchange_rate` n'est pas alimentée par le contrôle de gestion (CG).
 *
 * ⚠️ À NE PAS UTILISER EN PRODUCTION pour des décisions comptables. Chaque
 * usage est tracé par log Pino avec `isIndicativeFallback = true`
 * (cf. ExchangeRateService.convertToXof, audit ajouté en US-006).
 *
 * Le CG IPD doit valider et seeder `ref.exchange_rate` avant la mise en
 * production. `Object.freeze` empêche toute mutation runtime accidentelle.
 *
 * NB : on type en `Readonly<Record<string, number>>` (et non `as const`) pour
 * autoriser l'indexation par devise dynamique (`map[currency]`) côté service —
 * `Object.freeze` couvre l'immutabilité runtime, l'objectif premier.
 */
export const FALLBACK_INDICATIVE_TO_XOF: Readonly<Record<string, number>> = Object.freeze({
  USD: 600,
  GBP: 800,
  CHF: 700,
});
