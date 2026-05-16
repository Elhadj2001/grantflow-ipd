/**
 * Constantes parité fixe BCEAO/UEMOA.
 *
 * Le franc CFA (XOF) est rattaché à l'euro à un taux fixe garanti par
 * la BCEAO depuis l'introduction de l'euro le 04/01/1999 :
 *
 *   1 EUR = 655,957 XOF
 *   1 XOF = 1 / 655,957 EUR ≈ 0.00152449 EUR
 *
 * Cette parité ne change JAMAIS. Tout code qui calcule un taux EUR↔XOF
 * doit utiliser ces constantes (ou aller chercher la ligne `is_fixed=true`
 * en BD si on veut un seul point de vérité côté SQL).
 *
 * Référence : https://www.bceao.int/
 */
export const FIXED_EUR_XOF = 655.957;

/** Inverse exact — calculé une fois pour éviter la dérive flottante. */
export const FIXED_XOF_EUR = 1 / FIXED_EUR_XOF;

/** Date charnière historique : entrée en vigueur de la parité. */
export const FIXED_PARITY_DATE = '1999-01-04';

/** Source à inscrire dans `ref.exchange_rate.source`. */
export const FIXED_PARITY_SOURCE = 'BCEAO_FIXED';
