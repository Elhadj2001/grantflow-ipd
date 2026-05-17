'use client';

import * as React from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useProjectsList } from '@/hooks/use-referential';
import type { Project } from '@/lib/api/referential';

export interface ProjectPickerProps {
  value: string | null;
  onChange: (projectId: string | null, project: Project | null) => void;
  disabled?: boolean;
  /** Présélectionne automatiquement si une seule option est disponible. */
  autoSelectSingle?: boolean;
  className?: string;
}

/**
 * Sélecteur de projet. Charge `/projects?isActive=true` (jusqu'à 100).
 * Si un seul projet est retourné et `autoSelectSingle` est vrai (défaut),
 * sélectionne automatiquement — cas typique d'un demandeur affecté à
 * un unique projet.
 */
export function ProjectPicker({
  value,
  onChange,
  disabled,
  autoSelectSingle = true,
  className,
}: ProjectPickerProps) {
  const { data, isLoading } = useProjectsList();
  const projects = React.useMemo(() => data?.data ?? [], [data]);

  // Auto-sélection si une seule option
  React.useEffect(() => {
    if (!autoSelectSingle || value || isLoading) return;
    if (projects.length === 1) {
      onChange(projects[0].id, projects[0]);
    }
  }, [autoSelectSingle, value, isLoading, projects, onChange]);

  const options: ComboboxOption[] = React.useMemo(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: `${p.code} — ${p.title}`,
        sublabel: p.startDate.slice(0, 4) + (p.endDate ? ` → ${p.endDate.slice(0, 4)}` : ''),
        searchText: `${p.code} ${p.title}`,
      })),
    [projects],
  );

  return (
    <Combobox
      testId="project-picker"
      options={options}
      value={value}
      onChange={(id) => {
        const proj = projects.find((p) => p.id === id) ?? null;
        onChange(id, proj);
      }}
      placeholder="Sélectionner un projet…"
      searchPlaceholder="Rechercher par code ou titre…"
      emptyText="Aucun projet actif."
      loading={isLoading}
      disabled={disabled}
      className={className}
    />
  );
}
