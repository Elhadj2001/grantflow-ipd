'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AccountMapping, DonorCategory } from '@/lib/api/reporting';

export interface AccountMappingTableProps {
  /** Mappings existants (read-only) à afficher en haut de la table. */
  existing: AccountMapping[];
  /** Catégories du template (pour le sélecteur catégorie). */
  categories: DonorCategory[];
  /**
   * Mode édition : permet d'ajouter de nouveaux mappings (locaux),
   * exportés via `onChange`. Le caller envoie la liste en POST
   * /templates/:id/mappings (upsert).
   */
  editable?: boolean;
  /** Callback à chaque changement des mappings éditables. */
  onChange?: (newMappings: NewMappingDraft[]) => void;
  className?: string;
}

export interface NewMappingDraft {
  glAccountCode: string;
  categoryCode: string;
  sign: 1 | -1;
}

/**
 * Table compte SYSCEBNL → catégorie bailleur (+ signe).
 *
 * Mode read-only par défaut. En mode édition (`editable`), affiche un
 * formulaire d'ajout en bas + bouton "Ajouter mapping" — le caller
 * récupère la liste finale via `onChange`.
 *
 * Note : les mappings sont upsertés côté backend (PK = templateId +
 * glAccountCode). Réimporter le même compte met simplement à jour la
 * catégorie / sign.
 */
export function AccountMappingTable({
  existing,
  categories,
  editable = false,
  onChange,
  className,
}: AccountMappingTableProps) {
  const [drafts, setDrafts] = useState<NewMappingDraft[]>([]);

  const categoryByCode = useMemo(() => {
    const m = new Map<string, DonorCategory>();
    for (const c of categories) m.set(c.code, c);
    return m;
  }, [categories]);
  const categoryById = useMemo(() => {
    const m = new Map<string, DonorCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const updateDrafts = (next: NewMappingDraft[]) => {
    setDrafts(next);
    onChange?.(next);
  };

  const addDraft = () => {
    updateDrafts([...drafts, { glAccountCode: '', categoryCode: categories[0]?.code ?? '', sign: 1 }]);
  };

  const removeDraft = (idx: number) => {
    updateDrafts(drafts.filter((_, i) => i !== idx));
  };

  const updateDraft = (idx: number, patch: Partial<NewMappingDraft>) => {
    updateDrafts(drafts.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  return (
    <div
      data-testid="account-mapping-table"
      data-editable={editable ? 'true' : 'false'}
      data-existing-count={existing.length}
      data-draft-count={drafts.length}
      className={cn('overflow-x-auto rounded-md border bg-white', className)}
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-muted">
          <tr>
            <th className="px-3 py-2 text-left">Compte SYSCEBNL</th>
            <th className="px-3 py-2 text-left">Catégorie bailleur</th>
            <th className="px-3 py-2 text-center">Signe</th>
            {editable && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {existing.length === 0 && drafts.length === 0 && (
            <tr>
              <td colSpan={editable ? 4 : 3} className="px-3 py-6 text-center text-slate-muted">
                Aucun mapping défini
              </td>
            </tr>
          )}

          {existing.map((m) => {
            const cat = categoryById.get(m.donorCategoryId);
            return (
              <tr
                key={m.id}
                data-testid={`mapping-row-${m.glAccountCode}`}
                data-mode="existing"
                className="hover:bg-slate-50"
              >
                <td className="px-3 py-2 font-mono text-xs text-slate-700">{m.glAccountCode}</td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-slate-muted">{cat?.code ?? '—'}</span>
                  <span className="ml-2 text-slate-700">{cat?.label ?? ''}</span>
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-center font-semibold',
                    m.sign === -1 ? 'text-state-error' : 'text-state-success',
                  )}
                >
                  {m.sign === -1 ? '−1' : '+1'}
                </td>
                {editable && <td />}
              </tr>
            );
          })}

          {editable &&
            drafts.map((d, idx) => {
              const cat = d.categoryCode ? categoryByCode.get(d.categoryCode) : null;
              return (
                <tr
                  key={`draft-${idx}`}
                  data-testid={`mapping-draft-${idx}`}
                  data-mode="draft"
                  className="bg-ipd-50/30"
                >
                  <td className="px-3 py-2">
                    <Input
                      data-testid={`draft-account-${idx}`}
                      value={d.glAccountCode}
                      onChange={(e) => updateDraft(idx, { glAccountCode: e.target.value.trim() })}
                      placeholder="611"
                      className="h-8 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      data-testid={`draft-category-${idx}`}
                      value={d.categoryCode}
                      onChange={(e) => updateDraft(idx, { categoryCode: e.target.value })}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.label}
                        </option>
                      ))}
                    </select>
                    {cat && (
                      <p className="mt-0.5 text-[10px] text-slate-muted">
                        sortOrder={cat.sortOrder}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select
                      data-testid={`draft-sign-${idx}`}
                      value={d.sign}
                      onChange={(e) =>
                        updateDraft(idx, { sign: Number(e.target.value) === -1 ? -1 : 1 })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value={1}>+1</option>
                      <option value={-1}>−1</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      data-testid={`draft-remove-${idx}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => removeDraft(idx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {editable && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
          <Button
            data-testid="mapping-add-draft"
            type="button"
            size="sm"
            variant="outline"
            onClick={addDraft}
            disabled={categories.length === 0}
          >
            <Plus className="mr-1 h-3 w-3" />
            Ajouter un mapping
          </Button>
          {categories.length === 0 && (
            <span className="ml-3 text-xs text-state-warning">
              Aucune catégorie : créez d&apos;abord les catégories à l&apos;étape précédente.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
