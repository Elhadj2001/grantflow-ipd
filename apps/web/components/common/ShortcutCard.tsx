import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface ShortcutCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  disabled?: boolean;
  href?: string;
}

/**
 * Carte raccourci affichée dans la section "Raccourcis" du dashboard.
 * Pour le sprint F1.1, toutes les cartes sont disabled (modules
 * fonctionnels arrivant dans F2+) mais elles ont un hover-state
 * (shadow transition) pour signaler qu'elles deviendront cliquables.
 */
export function ShortcutCard({
  icon: Icon,
  title,
  description,
  actionLabel = 'Bientôt disponible',
  disabled = true,
}: ShortcutCardProps) {
  return (
    <Card
      data-testid="shortcut-card"
      data-disabled={disabled ? 'true' : 'false'}
      className="group transition-shadow hover:shadow-md"
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full bg-pasteur-50 text-pasteur transition-transform group-hover:scale-110"
        >
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-sm font-semibold text-slate-text">{title}</h3>
        <p className="text-xs text-slate-muted leading-relaxed">{description}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="mt-auto self-start"
        >
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
