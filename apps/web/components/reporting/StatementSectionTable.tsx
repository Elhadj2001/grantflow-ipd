'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/api/pilotage';
import type { StatementLine } from '@/lib/api/reporting';

export interface StatementSectionTableProps {
  /** Toutes les lignes de l'état (déjà filtrées au besoin par le caller). */
  lines: StatementLine[];
  /** Code de section à afficher (cf. STATEMENT_SECTIONS). */
  section: string;
  /** Libellé FR de la section (affiché en titre). */
  sectionLabel: string;
  /** Affiche la colonne "Compte" (utile pour TER/BILAN/RESULTAT, masquée pour FONDS_DEDIES). */
  showAccountColumn?: boolean;
  /** Affiche le total de la section en footer (somme des `balance`). */
  showTotal?: boolean;
  /** Devise affichée (XOF par défaut, ou la devise du template pour donor-reports). */
  currency?: string;
  className?: string;
}

/**
 * Rendu d'une section d'un état financier (TER / BILAN / RESULTAT / FONDS_DEDIES).
 *
 * Volontairement générique : la même structure de table sert toutes les
 * sections — le caller choisit `section` + `sectionLabel` et combine plusieurs
 * `StatementSectionTable` pour reconstituer l'état complet.
 *
 * Cf. backend financial-statement-generator.service.ts pour la signification
 * des colonnes selon le type :
 *   - TER       : balance = montant signé EMPLOIS/RESSOURCES
 *   - BILAN     : balance = montant ACTIF (positif) ou PASSIF (positif aussi, inversion)
 *   - RESULTAT  : balance = montant CHARGES (positif) / PRODUITS (positif aussi)
 *   - FONDS_DEDIES.GRANTS : debit=employé, credit=reçu, balance=restant à employer
 *   - FONDS_DEDIES.RAPPROCHEMENT_689_19 : debit=reprise 789, credit=dotation 689, balance=net
 */
export function StatementSectionTable({
  lines,
  section,
  sectionLabel,
  showAccountColumn = true,
  showTotal = true,
  currency = 'XOF',
  className,
}: StatementSectionTableProps) {
  const filtered = useMemo(
    () => lines.filter((l) => l.section === section).sort((a, b) => a.sortOrder - b.sortOrder),
    [lines, section],
  );

  const total = useMemo(
    () => filtered.reduce((s, l) => s + Number(l.balance), 0),
    [filtered],
  );

  return (
    <section
      data-testid={`statement-section-${section}`}
      data-count={filtered.length}
      className={cn('rounded-lg border bg-white shadow-sm', className)}
    >
      <header className="border-b border-slate-100 bg-slate-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-ipd-darker">{sectionLabel}</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/50 text-xs uppercase tracking-wide text-slate-muted">
            <tr>
              {showAccountColumn && (
                <th className="px-3 py-2 text-left" style={{ width: '90px' }}>
                  Compte
                </th>
              )}
              <th className="px-3 py-2 text-left">Libellé</th>
              <th className="px-3 py-2 text-right" style={{ width: '140px' }}>
                Débit
              </th>
              <th className="px-3 py-2 text-right" style={{ width: '140px' }}>
                Crédit
              </th>
              <th className="px-3 py-2 text-right" style={{ width: '160px' }}>
                Solde
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={showAccountColumn ? 5 : 4}
                  className="px-3 py-6 text-center text-slate-muted"
                >
                  Aucune ligne dans cette section.
                </td>
              </tr>
            ) : (
              filtered.map((l) => (
                <tr
                  key={l.id}
                  data-testid={`statement-line-${l.id}`}
                  className="transition hover:bg-slate-50"
                >
                  {showAccountColumn && (
                    <td className="px-3 py-2 font-mono text-xs text-slate-muted">
                      {l.accountCode ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-slate-700">{l.label}</td>
                  <td className="px-3 py-2 text-right">
                    {formatAmount(Number(l.debit), currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatAmount(Number(l.credit), currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-700">
                    {formatAmount(Number(l.balance), currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {showTotal && filtered.length > 0 && (
            <tfoot className="bg-slate-50 text-sm font-semibold">
              <tr>
                <td
                  className="px-3 py-2 text-ipd-darker"
                  colSpan={showAccountColumn ? 4 : 3}
                >
                  Total {sectionLabel}
                </td>
                <td className="px-3 py-2 text-right text-ipd-darker">
                  {formatAmount(total, currency)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
