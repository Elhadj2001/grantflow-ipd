import { fireEvent, render, screen } from '@testing-library/react';
import { AccountMappingTable } from '../AccountMappingTable';
import type { AccountMapping, DonorCategory } from '@/lib/api/reporting';

const categories: DonorCategory[] = [
  { id: 'c1', templateId: 't1', code: 'LINE_01', label: 'Personnel', parentId: null, sortOrder: 0 },
  { id: 'c2', templateId: 't1', code: 'LINE_02', label: 'Travel', parentId: null, sortOrder: 10 },
];

const existing: AccountMapping[] = [
  { id: 'm1', templateId: 't1', glAccountCode: '611', donorCategoryId: 'c1', sign: 1 },
  { id: 'm2', templateId: 't1', glAccountCode: '614', donorCategoryId: 'c2', sign: -1 },
];

describe('AccountMappingTable', () => {
  it('rend les mappings existants en mode read-only', () => {
    render(<AccountMappingTable existing={existing} categories={categories} />);
    expect(screen.getByTestId('mapping-row-611')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-row-614')).toBeInTheDocument();
    expect(screen.getByTestId('account-mapping-table')).toHaveAttribute('data-editable', 'false');
    expect(screen.queryByTestId('mapping-add-draft')).toBeNull();
  });

  it('affiche le sign coloré (+1 vert / −1 rouge)', () => {
    render(<AccountMappingTable existing={existing} categories={categories} />);
    const row611 = screen.getByTestId('mapping-row-611');
    const row614 = screen.getByTestId('mapping-row-614');
    expect(row611).toHaveTextContent('+1');
    expect(row614).toHaveTextContent('−1');
  });

  it('mode editable : bouton "Ajouter mapping" présent', () => {
    render(<AccountMappingTable existing={[]} categories={categories} editable />);
    expect(screen.getByTestId('mapping-add-draft')).toBeInTheDocument();
    expect(screen.getByTestId('account-mapping-table')).toHaveAttribute('data-editable', 'true');
  });

  it('clic "Ajouter mapping" crée un draft + propage onChange', () => {
    const onChange = jest.fn();
    render(
      <AccountMappingTable existing={[]} categories={categories} editable onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('mapping-add-draft'));
    expect(screen.getByTestId('mapping-draft-0')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([
      { glAccountCode: '', categoryCode: 'LINE_01', sign: 1 },
    ]);
  });

  it('modification du compte du draft propage onChange', () => {
    const onChange = jest.fn();
    render(
      <AccountMappingTable existing={[]} categories={categories} editable onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('mapping-add-draft'));
    onChange.mockClear();
    fireEvent.change(screen.getByTestId('draft-account-0'), { target: { value: '612' } });
    expect(onChange).toHaveBeenLastCalledWith([
      { glAccountCode: '612', categoryCode: 'LINE_01', sign: 1 },
    ]);
  });

  it('suppression d\'un draft', () => {
    const onChange = jest.fn();
    render(
      <AccountMappingTable existing={[]} categories={categories} editable onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('mapping-add-draft'));
    fireEvent.click(screen.getByTestId('draft-remove-0'));
    expect(screen.queryByTestId('mapping-draft-0')).toBeNull();
  });

  it('aucune catégorie → bouton "Ajouter" désactivé + warning', () => {
    render(<AccountMappingTable existing={[]} categories={[]} editable />);
    expect(screen.getByTestId('mapping-add-draft')).toBeDisabled();
    expect(screen.getByText(/Aucune catégorie/i)).toBeInTheDocument();
  });

  it('état vide quand pas de mapping + pas de draft', () => {
    render(<AccountMappingTable existing={[]} categories={categories} />);
    expect(screen.getByText('Aucun mapping défini')).toBeInTheDocument();
  });
});
