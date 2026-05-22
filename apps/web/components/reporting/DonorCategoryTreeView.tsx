'use client';

import { ChevronRight, FolderTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DonorCategory } from '@/lib/api/reporting';

export interface DonorCategoryTreeViewProps {
  categories: DonorCategory[];
  /** Action de click sur une catégorie (sélection). */
  onSelect?: (categoryCode: string) => void;
  /** Code de la catégorie actuellement sélectionnée (highlight). */
  selectedCode?: string | null;
  className?: string;
}

interface TreeNode extends DonorCategory {
  children: TreeNode[];
}

/**
 * Vue hiérarchique des catégories d'un template bailleur.
 *
 * Reconstitue l'arbre depuis le `parentId` côté Prisma. Les catégories
 * racine sont affichées en premier (sortOrder), leurs enfants en
 * indentation. Pas d'expand/collapse (les arbres de templates restent
 * peu profonds — 2 niveaux max dans USAID/OMS).
 */
export function DonorCategoryTreeView({
  categories,
  onSelect,
  selectedCode = null,
  className,
}: DonorCategoryTreeViewProps) {
  const tree = buildTree(categories);

  if (categories.length === 0) {
    return (
      <div
        data-testid="donor-category-tree"
        data-empty="true"
        className={cn(
          'flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 p-6 text-sm text-slate-muted',
          className,
        )}
      >
        <FolderTree className="mb-2 h-6 w-6" />
        Aucune catégorie définie
      </div>
    );
  }

  return (
    <ul
      data-testid="donor-category-tree"
      data-empty="false"
      data-count={categories.length}
      className={cn('space-y-1 text-sm', className)}
    >
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          onSelect={onSelect}
          selectedCode={selectedCode}
        />
      ))}
    </ul>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  onSelect?: (code: string) => void;
  selectedCode?: string | null;
}

function TreeItem({ node, depth, onSelect, selectedCode }: TreeItemProps) {
  const selected = selectedCode === node.code;
  return (
    <li>
      <button
        type="button"
        data-testid={`category-${node.code}`}
        data-depth={depth}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onSelect?.(node.code)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
          selected ? 'bg-ipd-50 text-ipd-darker' : 'hover:bg-slate-50',
        )}
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        {node.children.length > 0 && <ChevronRight className="h-3 w-3 text-slate-muted" />}
        <span className="font-mono text-xs text-slate-muted">{node.code}</span>
        <span className="truncate">{node.label}</span>
      </button>
      {node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedCode={selectedCode}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function buildTree(categories: DonorCategory[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const c of categories) {
    byId.set(c.id, { ...c, children: [] });
  }
  for (const c of categories) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Tri par sortOrder (chaque niveau)
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
