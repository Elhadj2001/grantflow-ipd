import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import { BudgetLineEditor } from '../BudgetLineEditor';
import type { BudgetLine } from '@/lib/api/referential';
import type { GrantflowRole } from '@/lib/auth';

// --- Mocks d'environnement ---

let mockRoles: GrantflowRole[] = ['CONTROLEUR'];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/hooks/use-referential', () => {
  const actual = jest.requireActual('@/hooks/use-referential');
  return {
    ...actual,
    useCreateBudgetLine: () => ({
      mutateAsync: mockCreate,
      isPending: false,
    }),
    useUpdateBudgetLine: () => ({
      mutateAsync: mockUpdate,
      isPending: false,
    }),
    useDeleteBudgetLine: () => ({
      mutateAsync: mockDelete,
      isPending: false,
    }),
  };
});

const baseLine: BudgetLine = {
  id: 'bl-1',
  grantId: 'grant-1',
  code: 'L01',
  label: 'Consommables labo',
  budgetedAmount: '90000',
  defaultAccount: '604',
  isOverheadEligible: true,
  isActive: true,
};

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockRoles = ['CONTROLEUR'];
});

describe('BudgetLineEditor', () => {
  it('rend la liste + total budgété + reste', () => {
    render(
      <BudgetLineEditor
        grantId="grant-1"
        lines={[baseLine, { ...baseLine, id: 'bl-2', code: 'L02', budgetedAmount: '60000' }]}
        grantAmount={200_000}
      />,
    );
    expect(screen.getByTestId('budget-line-editor')).toBeInTheDocument();
    expect(screen.getByTestId('bl-row-L01')).toBeInTheDocument();
    expect(screen.getByTestId('bl-row-L02')).toBeInTheDocument();
    // Total = 150 000 sur 200 000 → reste 50 000
    // (regex avec word boundary pour ne pas matcher "150 000" → "50 000")
    expect(screen.getByText(/\b150.000|\b150\s000/)).toBeInTheDocument();
    expect(screen.getByText(/\b50.000|\b50\s000/)).toBeInTheDocument();
  });

  it('null retourné si l\'utilisateur n\'a pas canManageBudgetLines (ACHETEUR pur)', () => {
    mockRoles = ['ACHETEUR'];
    const { container } = render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={100_000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('clic "Ajouter" affiche la ligne d\'édition vide', () => {
    render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={200_000} />,
    );
    fireEvent.click(screen.getByTestId('add-budget-line'));
    expect(screen.getByTestId('bl-row-new')).toBeInTheDocument();
    expect(screen.getByTestId('bl-row-new')).toHaveAttribute('data-mode', 'create');
  });

  it('création : submit appelle mutateAsync avec defaultAccount (mapping bailleur)', async () => {
    mockCreate.mockResolvedValue({});
    render(
      <BudgetLineEditor grantId="grant-1" lines={[]} grantAmount={500_000} />,
    );
    fireEvent.click(screen.getByTestId('add-budget-line'));
    fireEvent.change(screen.getByTestId('bl-form-code'), { target: { value: 'L99' } });
    fireEvent.change(screen.getByTestId('bl-form-label'), {
      target: { value: 'Nouvelle ligne' },
    });
    fireEvent.change(screen.getByTestId('bl-form-amount'), { target: { value: '50000' } });
    fireEvent.change(screen.getByTestId('bl-form-default-account'), {
      target: { value: '604' },
    });
    fireEvent.click(screen.getByTestId('bl-form-submit'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith({
      code: 'L99',
      label: 'Nouvelle ligne',
      budgetedAmount: 50_000,
      defaultAccount: '604',
      isOverheadEligible: true,
    });
  });

  it('création : 409 BUDGET_LINES_EXCEED_GRANT → message explicite', async () => {
    mockCreate.mockRejectedValue(
      new ApiError(409, {
        code: 'BUSINESS.BUDGET_LINES_EXCEED_GRANT',
        message: 'sum exceeds grant',
      }),
    );
    render(
      <BudgetLineEditor grantId="grant-1" lines={[]} grantAmount={100} />,
    );
    fireEvent.click(screen.getByTestId('add-budget-line'));
    fireEvent.change(screen.getByTestId('bl-form-code'), { target: { value: 'L99' } });
    fireEvent.change(screen.getByTestId('bl-form-label'), {
      target: { value: 'Overflow line' },
    });
    fireEvent.change(screen.getByTestId('bl-form-amount'), {
      target: { value: '999999' },
    });
    fireEvent.click(screen.getByTestId('bl-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('budget-line-editor-error')).toHaveTextContent(
        /dépasse le montant de la convention/,
      );
    });
  });

  it('suppression : 409 BUDGET_LINE_HAS_USAGE → message explicite (pas de crash)', async () => {
    // DAF requis pour avoir le bouton delete
    mockRoles = ['DAF'];
    mockDelete.mockRejectedValue(
      new ApiError(409, {
        code: 'BUSINESS.BUDGET_LINE_HAS_USAGE',
        message: 'used by 3 PRs',
      }),
    );
    render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={200_000} />,
    );
    fireEvent.click(screen.getByTestId('bl-delete-L01'));

    await waitFor(() => {
      expect(screen.getByTestId('budget-line-editor-error')).toHaveTextContent(
        /référencée par une DA, un BC ou une écriture/,
      );
    });
  });

  it('édition : passe une ligne en mode editable + submit appelle update', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={200_000} />,
    );
    fireEvent.click(screen.getByTestId('bl-edit-L01'));
    expect(screen.getByTestId('bl-row-edit-L01')).toHaveAttribute('data-mode', 'edit');
    // Code immuable en édition
    expect(screen.getByTestId('bl-form-code')).toBeDisabled();

    fireEvent.change(screen.getByTestId('bl-form-amount'), { target: { value: '120000' } });
    fireEvent.click(screen.getByTestId('bl-form-submit'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      id: 'bl-1',
      input: expect.objectContaining({
        budgetedAmount: 120_000,
        defaultAccount: '604',
      }),
    });
  });

  it('bouton supprimer absent pour CONTROLEUR (canDeleteBudgetLine=false)', () => {
    mockRoles = ['CONTROLEUR'];
    render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={200_000} />,
    );
    expect(screen.queryByTestId('bl-delete-L01')).toBeNull();
  });

  it('bouton supprimer présent pour DAF', () => {
    mockRoles = ['DAF'];
    render(
      <BudgetLineEditor grantId="grant-1" lines={[baseLine]} grantAmount={200_000} />,
    );
    expect(screen.getByTestId('bl-delete-L01')).toBeInTheDocument();
  });

  it('total > grantAmount → reste affiché en rouge', () => {
    render(
      <BudgetLineEditor
        grantId="grant-1"
        lines={[{ ...baseLine, budgetedAmount: '150000' }]}
        grantAmount={100_000}
      />,
    );
    // Reste -50 000 → affichage avec text-state-error
    const reste = screen.getByText(/Reste/).parentElement!;
    expect(reste.innerHTML).toMatch(/text-state-error/);
  });
});
