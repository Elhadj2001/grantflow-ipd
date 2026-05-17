'use client';

import * as React from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useGrantsByProject } from '@/hooks/use-referential';
import type { Grant } from '@/lib/api/referential';

export interface GrantPickerProps {
  projectId: string | null;
  value: string | null;
  onChange: (grantId: string | null, grant: Grant | null) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Sélecteur de convention. Cascade depuis `projectId` — désactivé si
 * pas de projet sélectionné. Le composant parent doit vider `value`
 * quand `projectId` change (sinon on garde une grant orpheline).
 */
export function GrantPicker({
  projectId,
  value,
  onChange,
  disabled,
  className,
}: GrantPickerProps) {
  const { data, isLoading } = useGrantsByProject(projectId);
  const grants = React.useMemo(() => data?.data ?? [], [data]);

  // Vider la sélection si projectId disparaît ou change
  const lastProjectId = React.useRef<string | null>(projectId);
  React.useEffect(() => {
    if (lastProjectId.current !== projectId) {
      lastProjectId.current = projectId;
      if (value) onChange(null, null);
    }
  }, [projectId, value, onChange]);

  const options: ComboboxOption[] = React.useMemo(
    () =>
      grants.map((g) => ({
        value: g.id,
        label: `${g.reference}`,
        sublabel: `${formatAmount(g.amount, g.currency)} • ${g.startDate.slice(0, 7)} → ${g.endDate.slice(0, 7)}`,
        searchText: g.reference,
      })),
    [grants],
  );

  return (
    <Combobox
      testId="grant-picker"
      options={options}
      value={value}
      onChange={(id) => {
        const g = grants.find((gr) => gr.id === id) ?? null;
        onChange(id, g);
      }}
      placeholder={projectId ? 'Sélectionner une convention…' : 'Choisir un projet d\'abord'}
      searchPlaceholder="Rechercher par référence…"
      emptyText={projectId ? 'Aucune convention active sur ce projet.' : 'Sélectionnez un projet.'}
      loading={isLoading}
      disabled={disabled || !projectId}
      className={className}
    />
  );
}

function formatAmount(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} ${currency}`;
}
