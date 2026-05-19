'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface IbanMaskedDisplayProps {
  /** IBAN complet (peut contenir des espaces). */
  iban: string | null | undefined;
  /** Affiche un bouton de copie du complet en clipboard. Défaut true. */
  allowCopy?: boolean;
  /** Affichage compact (sans bouton copie, juste le texte masqué). */
  compact?: boolean;
  className?: string;
}

/**
 * Affichage masqué d'un IBAN — anti-PII pour les logs et l'UI :
 * "FR76 **** **** **** **89 78" garde le pays + les 4 derniers chiffres.
 * Au clic sur l'icône copie, copie le complet dans le clipboard.
 *
 * Sprint F4b — utilisé partout où un IBAN s'affiche (alerte fraude,
 * détail payment-run, ligne SEPA preview).
 */
export function IbanMaskedDisplay({
  iban,
  allowCopy = true,
  compact = false,
  className,
}: IbanMaskedDisplayProps) {
  const [copied, setCopied] = React.useState(false);

  const masked = maskIban(iban);
  if (!iban) {
    return (
      <span data-testid="iban-masked-empty" className={cn('text-slate-muted', className)}>
        —
      </span>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(iban.replace(/\s/g, ''));
      setCopied(true);
      toast({
        variant: 'success',
        title: 'IBAN copié',
        description: 'L\'IBAN complet est dans votre presse-papier.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copie impossible',
        description: 'Le navigateur a refusé l\'accès au presse-papier.',
      });
    }
  };

  if (compact) {
    return (
      <span
        data-testid="iban-masked"
        className={cn('font-mono text-xs tabular-nums', className)}
      >
        {masked}
      </span>
    );
  }

  return (
    <span
      data-testid="iban-masked"
      className={cn('inline-flex items-center gap-1 font-mono text-xs tabular-nums', className)}
    >
      {masked}
      {allowCopy && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={copy}
          aria-label="Copier l'IBAN complet"
          data-testid="iban-copy-btn"
        >
          {copied ? (
            <Check className="h-3 w-3 text-state-success" />
          ) : (
            <Copy className="h-3 w-3 text-slate-muted" />
          )}
        </Button>
      )}
    </span>
  );
}

/**
 * Masque le milieu de l'IBAN. Compatible avec/sans espaces en entrée.
 * "FR7630006000011234567890189" → "FR76 **** **** **** **01 89"
 */
export function maskIban(iban: string | null | undefined): string {
  if (!iban) return '—';
  const clean = iban.replace(/\s/g, '');
  if (clean.length < 8) return '****';
  return `${clean.slice(0, 4)} **** **** **** **${clean.slice(-4, -2)} ${clean.slice(-2)}`;
}
