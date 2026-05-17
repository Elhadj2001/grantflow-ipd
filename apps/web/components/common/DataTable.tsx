'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  /** Identifiant utilisé pour le tri (accesseur). */
  key: string;
  header: React.ReactNode;
  /** Fonction de rendu cellule. */
  cell: (row: T) => React.ReactNode;
  /** Largeur de colonne (CSS, ex: "120px" ou "20%"). */
  width?: string;
  /** Permet le tri cliquable sur ce header. */
  sortable?: boolean;
  /** Alignement du contenu cellule (text-{left|center|right}). */
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** Identifiant unique pour chaque row (extracteur). */
  getRowId: (row: T) => string;
  /** Affiche les skeletons quand isLoading=true. */
  isLoading?: boolean;
  /** Quand true, affiche un message d'empty state au lieu du tbody. */
  isEmpty?: boolean;
  /** Slot pour l'empty state (utilise EmptyState component dans les pages). */
  emptyState?: React.ReactNode;
  /** Optionnel : handler tri ; si absent → tri client-side. */
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  /** Tri actif (key, direction) pour l'affichage de la flèche. */
  sortState?: { key: string; direction: 'asc' | 'desc' };
  /** Pagination simple — appeler {goToPage(p)} sur next/prev. */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  /** Click row → navigate (typiquement vers /detail). */
  onRowClick?: (row: T) => void;
}

/**
 * Tableau réutilisable — tri optionnel, pagination simple, hover row,
 * sticky header. Pour des features avancées (filtres colonne, drag,
 * virtualisation), évoluera vers TanStack Table v8 quand nécessaire.
 *
 * Sprint F2 : version minimale suffisante pour les listes DA / BC / GR.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading = false,
  isEmpty = false,
  emptyState,
  onSort,
  sortState,
  pagination,
  onRowClick,
}: DataTableProps<T>) {
  const handleHeaderClick = (col: DataTableColumn<T>) => {
    if (!col.sortable || !onSort) return;
    const nextDir: 'asc' | 'desc' =
      sortState?.key === col.key && sortState.direction === 'asc' ? 'desc' : 'asc';
    onSort(col.key, nextDir);
  };

  const alignClass = (a?: 'left' | 'center' | 'right'): string =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const isSorted = sortState?.key === col.key;
              const Arrow = !col.sortable
                ? null
                : !isSorted
                  ? ArrowUpDown
                  : sortState.direction === 'asc'
                    ? ArrowUp
                    : ArrowDown;
              return (
                <TableHead
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    alignClass(col.align),
                    col.sortable && 'cursor-pointer select-none hover:text-ipd-darker',
                  )}
                  onClick={col.sortable ? () => handleHeaderClick(col) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {Arrow && <Arrow className="h-3 w-3" aria-hidden />}
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`loading-${i}`}>
                  {columns.map((col, j) => (
                    <TableCell key={`loading-${i}-${j}`}>
                      <Skeleton className="h-4 w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : isEmpty || data.length === 0
              ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="p-0">
                      {emptyState ?? (
                        <div className="px-6 py-12 text-center text-sm text-slate-muted">
                          Aucun élément à afficher.
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              : data.map((row) => (
                  <TableRow
                    key={getRowId(row)}
                    data-testid={`row-${getRowId(row)}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} className={alignClass(col.align)}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
        </TableBody>
      </Table>

      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
          <div className="text-slate-muted">
            Page {pagination.page} sur{' '}
            {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} —{' '}
            {pagination.total} élément(s)
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
