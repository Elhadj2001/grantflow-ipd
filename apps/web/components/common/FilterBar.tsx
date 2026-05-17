'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface FilterOption {
  /** Identifiant interne (ex: "status"). */
  key: string;
  /** Label affiché dans le chip. */
  label: string;
  /** Liste de valeurs sélectionnables. */
  values: Array<{ value: string; label: string }>;
}

export interface FilterBarProps {
  /** Valeur du champ recherche. */
  search?: string;
  onSearchChange?: (s: string) => void;
  searchPlaceholder?: string;
  /** Filtres actifs (key → value). */
  filters?: Record<string, string | undefined>;
  /** Définition des filtres disponibles (key + valeurs possibles). */
  options?: FilterOption[];
  onFilterChange?: (key: string, value: string | undefined) => void;
  /** Slot droite (boutons custom). */
  rightSlot?: React.ReactNode;
}

/**
 * Barre de filtres avec recherche + chips de filtres cliquables.
 * Sprint F2 : version minimale (chips toggle, pas de dropdown).
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Rechercher…',
  filters = {},
  options = [],
  onFilterChange,
  rightSlot,
}: FilterBarProps) {
  const activeCount = Object.values(filters).filter(Boolean).length;
  const handleClear = () => {
    options.forEach((opt) => onFilterChange?.(opt.key, undefined));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" aria-hidden />
            <Input
              type="search"
              placeholder={searchPlaceholder}
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
              data-testid="filterbar-search"
            />
          </div>
        )}
        {rightSlot && <div className="ml-auto flex items-center gap-2">{rightSlot}</div>}
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {options.map((opt) => {
            const active = filters[opt.key];
            return (
              <div key={opt.key} className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-muted">{opt.label} :</span>
                {opt.values.map((v) => {
                  const isActive = active === v.value;
                  return (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => onFilterChange?.(opt.key, isActive ? undefined : v.value)}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                        isActive
                          ? 'border-ipd-dark bg-ipd-50 text-ipd-darker'
                          : 'border-slate-200 bg-white text-slate-muted hover:border-ipd-dark hover:text-ipd-darker',
                      )}
                      data-testid={`filter-${opt.key}-${v.value}`}
                      aria-pressed={isActive}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="ml-auto text-xs">
              <X className="mr-1 h-3 w-3" />
              Effacer
              <Badge variant="muted" className="ml-2">{activeCount}</Badge>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
