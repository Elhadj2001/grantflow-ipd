import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface ShortcutCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  /**
   * Si fourni, la carte devient cliquable et le bouton ouvre l'URL via
   * `<Link>` Next.js. Si absent, la carte reste désactivée
   * (placeholder hérité du sprint F1.1).
   */
  href?: string;
  /**
   * Force le mode désactivé même si `href` est fourni (ex. permission
   * manquante détectée tardivement). Par défaut, `disabled` est déduit :
   * absence de `href` → disabled, sinon actif.
   */
  disabled?: boolean;
}

/**
 * Carte raccourci affichée dans la section "Raccourcis" du dashboard.
 *
 * Sprint F-DASHBOARD : si `href` est fourni, la carte devient cliquable
 * (Link Next.js). Sinon — pour rétro-compat F1.1 — elle reste en mode
 * placeholder désactivé.
 */
export function ShortcutCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  href,
  disabled,
}: ShortcutCardProps) {
  const isDisabled = disabled ?? !href;
  const effectiveLabel = actionLabel ?? (isDisabled ? 'Bientôt disponible' : 'Ouvrir');

  return (
    <Card
      data-testid="shortcut-card"
      data-disabled={isDisabled ? 'true' : 'false'}
      data-href={href ?? ''}
      className="group transition-shadow hover:shadow-md"
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full bg-ipd-50 text-ipd-darker transition-transform group-hover:scale-110"
        >
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-sm font-semibold text-slate-text">{title}</h3>
        <p className="text-xs text-slate-muted leading-relaxed">{description}</p>
        {!isDisabled && href ? (
          <Button asChild variant="outline" size="sm" className="mt-auto self-start">
            <Link href={href}>{effectiveLabel}</Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="mt-auto self-start"
          >
            {effectiveLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
