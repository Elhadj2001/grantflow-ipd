import { cn } from '@/lib/utils';

export interface AmountDisplayProps {
  /** Montant brut (peut être string venant de Decimal Prisma ou number). */
  amount: number | string | null | undefined;
  currency?: string;
  /** Décimales fixes (par défaut 0 pour XOF, 2 pour devises). */
  decimals?: number;
  /** Affiche le signe + devant les positifs (compta) — défaut false. */
  showSign?: boolean;
  /** Couleur selon signe : utile pour variances. */
  signColor?: boolean;
  /**
   * US-068 (ADR-005) : équivalent XOF STOCKÉ (colonnes `*_amount_xof`) —
   * affiché en infobulle quand la devise ≠ XOF. AUCUN recalcul front :
   * si la valeur n'est pas fournie, pas d'infobulle.
   */
  amountXof?: number | string | null;
  className?: string;
}

/**
 * Affiche un montant formaté FR avec espace insécable comme séparateur
 * de milliers et virgule comme décimal. XOF par défaut sans décimales.
 *
 * Exemples :
 *   <AmountDisplay amount={1234567.89} currency="USD" />
 *     → "1 234 567,89 USD"
 *   <AmountDisplay amount={1500000} />
 *     → "1 500 000 XOF"
 *   <AmountDisplay amount={-250} signColor />
 *     → "-250 XOF" en rouge
 */
export function AmountDisplay({
  amount,
  currency = 'XOF',
  decimals,
  showSign = false,
  signColor = false,
  amountXof,
  className,
}: AmountDisplayProps) {
  const num = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
  const isFinite = Number.isFinite(num);
  const safe = isFinite ? num : 0;
  const fractionDigits = decimals ?? (currency === 'XOF' ? 0 : 2);

  const formatter = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const formatted = formatter.format(Math.abs(safe));
  const sign = safe < 0 ? '-' : showSign && safe > 0 ? '+' : '';
  const colorClass = signColor
    ? safe < 0
      ? 'text-state-error'
      : safe > 0
        ? 'text-state-success'
        : 'text-slate-muted'
    : '';

  // Infobulle équivalent XOF (US-068) : uniquement en devise étrangère et
  // si la valeur STOCKÉE est disponible. Format FR entier (XOF sans
  // décimales), infobulle native (title) — zéro dépendance.
  const xofNum =
    typeof amountXof === 'string' ? Number(amountXof) : (amountXof ?? null);
  const xofTitle =
    currency !== 'XOF' && xofNum != null && Number.isFinite(xofNum)
      ? `≈ ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(xofNum)} XOF`
      : undefined;

  return (
    <span
      data-testid="amount-display"
      data-amount={String(safe)}
      title={xofTitle}
      {...(xofTitle ? { 'data-xof': String(xofNum) } : {})}
      className={cn('font-mono tabular-nums', colorClass, xofTitle && 'cursor-help', className)}
    >
      {sign}
      {formatted}
      <span className="ml-1 text-xs font-medium text-slate-muted">{currency}</span>
    </span>
  );
}
