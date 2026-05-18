'use client';

import { Snowflake, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ColdChainBadgeProps {
  /** Le BC exige-t-il la chaîne du froid ? (header level) */
  required: boolean;
  /** État courant côté ligne. `null` = pas encore vérifié. */
  value: boolean | null;
  onChange?: (next: boolean | null) => void;
  /** Affichage compact (badge seul) si pas d'interaction prévue. */
  readOnly?: boolean;
  className?: string;
}

/**
 * Badge "chaîne du froid" + toggle pour signaler conforme / non-conforme
 * lors de la réception. Schéma backend : `coldChainOk: Boolean?` —
 * 3 états (null = pas encore renseigné / true / false).
 *
 * Si vous avez besoin de tracer la température réelle (ex: -22°C),
 * saisissez-la dans le champ `qualityCheck` de la ligne (texte libre).
 * Pas de colonne dédiée — cf. arbitrage F-MAG.
 */
export function ColdChainBadge({
  required,
  value,
  onChange,
  readOnly,
  className,
}: ColdChainBadgeProps) {
  if (!required) return null;

  // Mode lecture seule : juste le badge d'état
  if (readOnly || !onChange) {
    return (
      <Badge
        variant={value === true ? 'success' : value === false ? 'error' : 'warning'}
        data-testid="coldchain-badge"
        data-required="true"
        className={cn('text-xs', className)}
      >
        <Snowflake className="mr-1 h-3 w-3" />
        {value === true
          ? 'Chaîne du froid OK'
          : value === false
            ? 'Chaîne du froid rompue'
            : 'Chaîne du froid à vérifier'}
      </Badge>
    );
  }

  // Mode édition : pill avec 2 boutons
  return (
    <div
      data-testid="coldchain-badge"
      data-required="true"
      data-value={value === null ? 'pending' : value ? 'ok' : 'broken'}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border-2 p-2',
        value === false
          ? 'border-state-error bg-state-error/10'
          : value === true
            ? 'border-state-success bg-state-success/5'
            : 'border-state-warning bg-state-warning/10',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Snowflake className="h-4 w-4 text-ipd-darker" />
        Chaîne du froid
      </span>
      <div className="ml-auto flex gap-2">
        <Button
          type="button"
          variant={value === true ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(value === true ? null : true)}
          data-testid="coldchain-ok"
          className="min-h-10"
        >
          <ThumbsUp className="mr-1 h-4 w-4" /> Conforme
        </Button>
        <Button
          type="button"
          variant={value === false ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => onChange(value === false ? null : false)}
          data-testid="coldchain-broken"
          className="min-h-10"
        >
          <ThumbsDown className="mr-1 h-4 w-4" /> Rompue
        </Button>
      </div>
    </div>
  );
}
