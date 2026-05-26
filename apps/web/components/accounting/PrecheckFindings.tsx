'use client';

import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHECK_CODE_LABELS_FR, type PrecheckFinding } from '@/lib/api/accounting';

export interface PrecheckFindingsProps {
  findings: PrecheckFinding[];
  /** Affiche un état "non lancé" si null. */
  loading?: boolean;
  className?: string;
}

/**
 * Affiche la liste des findings d'un précheck regroupés par sévérité.
 * BLOCKING (C001..C006) en rouge, WARNING (W001..W003) en orange.
 * État vide (aucun finding) = ✓ vert "Période prête à clôturer".
 */
export function PrecheckFindings({ findings, loading, className }: PrecheckFindingsProps) {
  if (loading) {
    return (
      <p data-testid="precheck-loading" className={cn('text-sm text-slate-muted', className)}>
        Précheck en cours…
      </p>
    );
  }

  const blocking = findings.filter((f) => f.severity === 'BLOCKING');
  const warnings = findings.filter((f) => f.severity === 'WARNING');

  if (findings.length === 0) {
    return (
      <div
        data-testid="precheck-clean"
        className={cn(
          'flex items-center gap-2 rounded-md border border-state-success/30 bg-state-success/5 px-3 py-2 text-sm text-state-success',
          className,
        )}
      >
        <CheckCircle2 className="h-4 w-4" />
        Aucun finding — période prête à être clôturée.
      </div>
    );
  }

  return (
    <div data-testid="precheck-findings" className={cn('space-y-3', className)}>
      {blocking.length > 0 && (
        <FindingsGroup
          title={`${blocking.length} finding${blocking.length > 1 ? 's' : ''} bloquant${blocking.length > 1 ? 's' : ''}`}
          findings={blocking}
          severity="BLOCKING"
        />
      )}
      {warnings.length > 0 && (
        <FindingsGroup
          title={`${warnings.length} avertissement${warnings.length > 1 ? 's' : ''}`}
          findings={warnings}
          severity="WARNING"
        />
      )}
    </div>
  );
}

interface FindingsGroupProps {
  title: string;
  findings: PrecheckFinding[];
  severity: 'BLOCKING' | 'WARNING';
}

function FindingsGroup({ title, findings, severity }: FindingsGroupProps) {
  const isBlocking = severity === 'BLOCKING';
  return (
    <section
      data-testid={`findings-group-${severity}`}
      className={cn(
        'rounded-md border px-3 py-2',
        isBlocking
          ? 'border-state-error/40 bg-state-error/5'
          : 'border-state-warning/40 bg-state-warning/5',
      )}
    >
      <header
        className={cn(
          'mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide',
          isBlocking ? 'text-state-error' : 'text-state-warning',
        )}
      >
        {isBlocking ? <AlertCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {title}
      </header>
      <ul className="space-y-1.5">
        {findings.map((f) => (
          <li
            key={`${f.code}-${f.message.slice(0, 20)}`}
            data-testid={`finding-${f.code}`}
            data-severity={f.severity}
            className="text-sm"
          >
            <span
              className={cn(
                'mr-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-mono font-semibold',
                isBlocking
                  ? 'bg-state-error/15 text-state-error'
                  : 'bg-state-warning/15 text-state-warning',
              )}
            >
              {f.code}
            </span>
            <span className="text-slate-700">
              {CHECK_CODE_LABELS_FR[f.code] ?? f.message}
            </span>
            {f.payload && Object.keys(f.payload).length > 0 && (
              <span className="ml-1 text-xs text-slate-muted">— {f.message}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
