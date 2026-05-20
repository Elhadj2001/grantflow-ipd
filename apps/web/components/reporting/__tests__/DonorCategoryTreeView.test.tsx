import { fireEvent, render, screen } from '@testing-library/react';
import { DonorCategoryTreeView } from '../DonorCategoryTreeView';
import type { DonorCategory } from '@/lib/api/reporting';

const categories: DonorCategory[] = [
  { id: 'a', templateId: 't1', code: 'A', label: 'Personnel', parentId: null, sortOrder: 0 },
  { id: 'a1', templateId: 't1', code: 'A1', label: 'Salaries', parentId: 'a', sortOrder: 0 },
  { id: 'a2', templateId: 't1', code: 'A2', label: 'Benefits', parentId: 'a', sortOrder: 10 },
  { id: 'b', templateId: 't1', code: 'B', label: 'Travel', parentId: null, sortOrder: 10 },
];

describe('DonorCategoryTreeView', () => {
  it('reconstitue l\'arbre hiérarchique', () => {
    render(<DonorCategoryTreeView categories={categories} />);
    expect(screen.getByTestId('category-A')).toHaveAttribute('data-depth', '0');
    expect(screen.getByTestId('category-A1')).toHaveAttribute('data-depth', '1');
    expect(screen.getByTestId('category-A2')).toHaveAttribute('data-depth', '1');
    expect(screen.getByTestId('category-B')).toHaveAttribute('data-depth', '0');
  });

  it('expose data-count = nombre total de catégories', () => {
    render(<DonorCategoryTreeView categories={categories} />);
    expect(screen.getByTestId('donor-category-tree')).toHaveAttribute('data-count', '4');
  });

  it('état vide quand pas de catégorie', () => {
    render(<DonorCategoryTreeView categories={[]} />);
    expect(screen.getByTestId('donor-category-tree')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/Aucune catégorie définie/i)).toBeInTheDocument();
  });

  it('clic appelle onSelect avec le code', () => {
    const onSelect = jest.fn();
    render(<DonorCategoryTreeView categories={categories} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('category-A1'));
    expect(onSelect).toHaveBeenCalledWith('A1');
  });

  it('selectedCode highlight la catégorie correspondante', () => {
    render(<DonorCategoryTreeView categories={categories} selectedCode="A2" />);
    expect(screen.getByTestId('category-A2')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('category-A1')).toHaveAttribute('data-selected', 'false');
  });
});
