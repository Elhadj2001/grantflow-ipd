'use client';

import * as React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { useSuppliersList } from '@/hooks/use-referential';
import type { Supplier } from '@/lib/api/referential';

export interface SupplierPickerProps {
  value: string | null;
  onChange: (supplierId: string | null, supplier: Supplier | null) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Sélecteur de fournisseur. La recherche est effectuée côté serveur
 * (debounce 300 ms) via `?q=...` qui utilise `pg_trgm`.
 *
 * Empty state : si aucun fournisseur n'existe en base, affiche un
 * call-to-action désactivé (la création est gérée dans un sprint
 * dédié — F2.z).
 */
export function SupplierPicker({ value, onChange, disabled, className }: SupplierPickerProps) {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useSuppliersList({
    q: debounced || undefined,
    pageSize: 50,
  });
  const suppliers = React.useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const options: ComboboxOption[] = React.useMemo(
    () =>
      suppliers.map((s) => {
        const ribOk = !!(s.iban && s.bic);
        return {
          value: s.id,
          label: `${s.code} — ${s.name}`,
          sublabel: `${s.country ?? '—'} • ${s.vatNumber ?? 'Sans TVA'}`,
          searchText: `${s.code} ${s.name}`,
          rightSlot: (
            <Badge
              variant={ribOk ? 'success' : 'warning'}
              className="text-[10px]"
              data-testid={`supplier-rib-${s.id}`}
            >
              {ribOk ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" /> RIB OK
                </>
              ) : (
                <>
                  <AlertTriangle className="mr-1 h-3 w-3" /> RIB manquant
                </>
              )}
            </Badge>
          ),
        };
      }),
    [suppliers],
  );

  // Empty state : aucun fournisseur EN BASE (pas un filtre vide)
  const trulyEmpty = !isLoading && total === 0 && !debounced;
  if (trulyEmpty) {
    return (
      <div
        data-testid="supplier-picker-empty"
        className="flex items-center justify-between gap-3 rounded-md border border-dashed border-slate-200 bg-cream/50 px-3 py-3 text-sm"
      >
        <span className="text-slate-muted">Aucun fournisseur enregistré.</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="Création de fournisseur disponible dans un sprint ultérieur"
        >
          Créer un fournisseur
        </Button>
      </div>
    );
  }

  return (
    <Combobox
      testId="supplier-picker"
      options={options}
      value={value}
      onChange={(id) => {
        const s = suppliers.find((sp) => sp.id === id) ?? null;
        onChange(id, s);
      }}
      placeholder="Sélectionner un fournisseur…"
      searchPlaceholder="Rechercher par nom ou code…"
      emptyText={
        debounced
          ? `Aucun fournisseur trouvé pour "${debounced}".`
          : 'Commencez à saisir pour rechercher…'
      }
      loading={isLoading}
      disabled={disabled}
      serverFilter
      search={search}
      onSearchChange={setSearch}
      className={className}
    />
  );
}
