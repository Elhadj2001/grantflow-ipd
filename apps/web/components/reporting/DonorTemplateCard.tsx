'use client';

import Link from 'next/link';
import { ArrowRight, BadgeCheck, FileSpreadsheet, Layers, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  OFFICIAL_TEMPLATE_CODES,
  type DonorTemplateSummary,
} from '@/lib/api/reporting';

export interface DonorTemplateCardProps {
  template: DonorTemplateSummary;
  /** Override le lien par défaut (/reporting/templates/:id). */
  href?: string;
  className?: string;
}

/**
 * Carte synthétique d'un DonorReportTemplate.
 *
 * Affiche : code, name, donor (si attaché), currency, nb catégories +
 * nb mappings, et un badge "Officiel" si le code matche un template
 * fourni en seed (USAID_FFR425, OMS_STANDARD, WELLCOME_TRUST).
 *
 * Click → page de détail. Hover : bordure aqua + ombre.
 */
export function DonorTemplateCard({ template, href, className }: DonorTemplateCardProps) {
  const link = href ?? `/reporting/templates/${template.id}`;
  const isOfficial = OFFICIAL_TEMPLATE_CODES.has(template.code);

  return (
    <Link
      data-testid="donor-template-card"
      data-template-code={template.code}
      data-official={isOfficial ? 'true' : 'false'}
      href={link}
      className={cn(
        'group block transition focus:outline-none focus:ring-2 focus:ring-ipd-dark focus:ring-offset-2',
        className,
      )}
    >
      <Card className="h-full border-2 transition hover:border-ipd hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-base text-ipd-darker">{template.code}</CardTitle>
              <p className="text-sm text-slate-700">{template.name}</p>
            </div>
            {isOfficial && (
              <Badge variant="default" className="gap-1">
                <BadgeCheck className="h-3 w-3" />
                Officiel
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {template.donor && (
            <p className="flex items-center gap-1.5 text-xs text-slate-muted">
              <Link2 className="h-3 w-3" />
              Bailleur :{' '}
              <span className="font-medium text-slate-700">{template.donor.label}</span>
            </p>
          )}
          {!template.donor && (
            <p className="text-xs italic text-slate-muted">
              Template générique (multi-bailleurs)
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
            <Stat
              icon={Layers}
              label="Catégories"
              value={template._count.categories}
              testId="categories-count"
            />
            <Stat
              icon={FileSpreadsheet}
              label="Mappings"
              value={template._count.mappings}
              testId="mappings-count"
            />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-muted">Devise</p>
              <p className="mt-0.5 text-sm font-semibold text-ipd-darker">{template.currency}</p>
            </div>
          </div>

          <div className="flex items-center justify-end pt-1 text-xs text-ipd-darker opacity-0 transition group-hover:opacity-100">
            Détail <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  testId?: string;
}

function Stat({ icon: Icon, label, value, testId }: StatProps) {
  return (
    <div data-testid={testId}>
      <p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-slate-muted">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-700">{value}</p>
    </div>
  );
}
