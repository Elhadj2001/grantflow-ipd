'use client';

import * as React from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useDonorsList } from '@/hooks/use-referential';
import type { Donor } from '@/lib/api/referential';

export interface DonorPickerProps {
  value: string | null;
  onChange: (donorId: string | null, donor: Donor | null) => void;
  disabled?: boolean;
  /** Présélectionne automatiquement si une seule option est disponible. */
  autoSelectSingle?: boolean;
  className?: string;
}

/**
 * Sélecteur de bailleur. Charge `/donors?isActive=true` (jusqu'à 100).
 * Affichage "CODE — libellé". Sprint F-REF-BAILLEURS-PROJETS — remplace
 * la saisie manuelle de l'UUID dans le formulaire de convention.
 *
 * Si un seul bailleur est retourné et `autoSelectSingle` est vrai
 * (défaut), sélectionne automatiquement.
 */
export function DonorPicker({
  value,
  onChange,
  disabled,
  autoSelectSingle = true,
  className,
}: DonorPickerProps) {
  const { data, isLoading } = useDonorsList();
  const donors = React.useMemo(() => data?.data ?? [], [data]);

  // Auto-sélection si une seule option
  React.useEffect(() => {
    if (!autoSelectSingle || value || isLoading) return;
    if (donors.length === 1) {
      onChange(donors[0].id, donors[0]);
    }
  }, [autoSelectSingle, value, isLoading, donors, onChange]);

  const options: ComboboxOption[] = React.useMemo(
    () =>
      donors.map((d) => ({
        value: d.id,
        label: `${d.code} — ${d.label}`,
        sublabel: d.country ?? undefined,
        searchText: `${d.code} ${d.label} ${d.country ?? ''}`,
      })),
    [donors],
  );

  return (
    <Combobox
      testId="donor-picker"
      options={options}
      value={value}
      onChange={(id) => {
        const donor = donors.find((d) => d.id === id) ?? null;
        onChange(id, donor);
      }}
      placeholder="Sélectionner un bailleur…"
      searchPlaceholder="Rechercher par code, libellé ou pays…"
      emptyText="Aucun bailleur actif."
      loading={isLoading}
      disabled={disabled}
      className={className}
    />
  );
}
