import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}

/**
 * Placeholder visuel utilisé quand une section n'a pas (encore) de
 * données. Affiche une icône ronde, un titre, une description, et
 * (optionnel) un bouton outline disabled pour annoncer un sprint futur.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionDisabled = false,
  onAction,
}: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-pasteur-50 text-pasteur"
        >
          <Icon className="h-7 w-7" />
        </span>
        <h3 className="text-base font-semibold text-slate-text">{title}</h3>
        {description && (
          <p className="max-w-md text-sm text-slate-muted">{description}</p>
        )}
        {actionLabel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
