import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseRequestForm } from '../PurchaseRequestForm';

// Mock next-auth/react — les pickers internes (ProjectPicker, GrantPicker,
// BudgetLinePicker) utilisent useSession() pour récupérer l'access token.
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));

// Toast (use-toast) n'a pas besoin de portail dans les tests
jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

// Mock fetch global pour éviter de vrais appels HTTP — les pickers tentent
// `/projects`, `/grants?projectId=…`, `/grants/:id/dashboard`. On renvoie
// vide partout, le form ne dépend pas des données pour les assertions
// (testées avec des UUIDs en defaultValues).
const fetchMock = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
  json: async () => ({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }),
  text: async () => '',
});
global.fetch = fetchMock as unknown as typeof fetch;

const UUID = '11111111-1111-1111-1111-111111111111';

function baseDefaults() {
  return {
    description: 'Achat de réactifs Q2 2026',
    projectId: UUID,
    grantId: UUID,
    lines: [
      { description: 'Boîte X', quantity: 2, unit: 'unit', unitPrice: 100, budgetLineId: UUID },
    ],
  };
}

function renderForm(props: Parameters<typeof PurchaseRequestForm>[0]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PurchaseRequestForm {...props} />
    </QueryClientProvider>,
  );
}

describe('PurchaseRequestForm', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('renders the 3 PR type chips', () => {
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    expect(screen.getByTestId('pr-type-standard')).toBeInTheDocument();
    expect(screen.getByTestId('pr-type-petty_cash')).toBeInTheDocument();
    expect(screen.getByTestId('pr-type-cash_advance')).toBeInTheDocument();
  });

  it('computes total live (qty * unitPrice)', async () => {
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    // total = 2 * 100 = 200 — on cherche le bloc Total estimé (le dernier
    // amount-display de la page) car d'autres existent dans les pickers/badges
    await waitFor(() => {
      const displays = screen.getAllByTestId('amount-display');
      const totalAmount = displays.find((el) => el.getAttribute('data-amount') === '200');
      expect(totalAmount).toBeDefined();
    });
  });

  it('allows adding and removing lines', async () => {
    const user = userEvent.setup();
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    expect(screen.getByTestId('pr-line-0')).toBeInTheDocument();
    await user.click(screen.getByTestId('add-line'));
    expect(screen.getByTestId('pr-line-1')).toBeInTheDocument();
    await user.click(screen.getByTestId('remove-line-1'));
    expect(screen.queryByTestId('pr-line-1')).toBeNull();
  });

  it('disables remove on last line', () => {
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    expect(screen.getByTestId('remove-line-0')).toBeDisabled();
  });

  it('shows petty cash warning when type=petty_cash + total > 100k', async () => {
    const user = userEvent.setup();
    renderForm({
      onSubmit: jest.fn(),
      defaultValues: {
        ...baseDefaults(),
        lines: [
          { description: 'X', quantity: 1, unit: 'unit', unitPrice: 150_000, budgetLineId: UUID },
        ],
      },
    });
    await user.click(screen.getByTestId('pr-type-petty_cash'));
    expect(await screen.findByTestId('petty-cash-warning')).toBeInTheDocument();
    expect(screen.getByTestId('pr-submit')).toBeDisabled();
  });

  it('no petty cash warning when type=standard even with big total', async () => {
    renderForm({
      onSubmit: jest.fn(),
      defaultValues: {
        ...baseDefaults(),
        lines: [{ description: 'X', quantity: 1, unit: 'unit', unitPrice: 500_000, budgetLineId: UUID }],
      },
    });
    expect(screen.queryByTestId('petty-cash-warning')).toBeNull();
  });

  it('calls onSubmit with normalized payload', async () => {
    const onSubmit = jest.fn();
    renderForm({ onSubmit, defaultValues: baseDefaults() });
    fireEvent.submit(screen.getByTestId('pr-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0][0];
    expect(call.description).toBe('Achat de réactifs Q2 2026');
    expect(call.lines).toHaveLength(1);
    expect(call.lines[0].quantity).toBe(2);
    expect(call.lines[0].unitPrice).toBe(100);
  });

  it('renders the 4 pickers (project, grant, budget-line, currency readonly)', () => {
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    expect(screen.getByTestId('project-picker')).toBeInTheDocument();
    expect(screen.getByTestId('grant-picker')).toBeInTheDocument();
    expect(screen.getByTestId('budget-line-picker-0')).toBeInTheDocument();
    // Devise est en lecture seule (héritée de la convention)
    expect(screen.getByTestId('pr-currency')).toHaveAttribute('readonly');
  });
});
