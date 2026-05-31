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

  it('renders the 4 pickers (project, grant, budget-line, currency)', () => {
    renderForm({ onSubmit: jest.fn(), defaultValues: baseDefaults() });
    expect(screen.getByTestId('project-picker')).toBeInTheDocument();
    expect(screen.getByTestId('grant-picker')).toBeInTheDocument();
    expect(screen.getByTestId('budget-line-picker-0')).toBeInTheDocument();
    // Fix da-multi-currency : devise est désormais un <select> ÉDITABLE
    // (l'héritage convention reste l'auto-fill par défaut via GrantPicker,
    // mais l'utilisateur peut overrider pour le cas SYSCEBNL convention
    // USD + dépense locale XOF).
    const currency = screen.getByTestId('pr-currency');
    expect(currency.tagName).toBe('SELECT');
    expect(currency).not.toHaveAttribute('readonly');
    expect(currency).not.toHaveAttribute('disabled');
  });

  // ----- Sprint fix-da-multi-currency -----

  it('override manuel de la devise : la valeur est conservée', () => {
    renderForm({
      onSubmit: jest.fn(),
      defaultValues: { ...baseDefaults(), currency: 'XOF' },
    });
    const select = screen.getByTestId('pr-currency') as HTMLSelectElement;
    expect(select.value).toBe('XOF');
    fireEvent.change(select, { target: { value: 'USD' } });
    expect(select.value).toBe('USD');
  });

  it('submit envoie la NOUVELLE devise après override', async () => {
    const onSubmit = jest.fn();
    renderForm({
      onSubmit,
      defaultValues: { ...baseDefaults(), currency: 'XOF' },
    });
    const select = screen.getByTestId('pr-currency') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'EUR' } });
    fireEvent.submit(screen.getByTestId('pr-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].currency).toBe('EUR');
  });

  it('affiche l\'alerte "Devise différente de la convention" quand DA.currency ≠ grant.currency', async () => {
    // Fetch mock spécifique : la route `/grants/<UUID>` (sans /dashboard
    // ni /budget-lines) renvoie un Grant USD. Le composant useGrant
    // chargera donc currency=USD ; la DA défaut XOF → mismatch attendu.
    const grantUsd = {
      id: UUID,
      reference: 'USAID-IPD-2026-01',
      donorId: UUID,
      projectId: UUID,
      amount: '300000',
      currency: 'USD',
      overheadRate: '0.15',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'active',
      signedAt: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      // Match /grants/<UUID> mais PAS /grants/<UUID>/dashboard ni /budget-lines
      const isGrantOnly = /\/grants\/[0-9a-f-]+(\?|$)/.test(url) && !url.includes('/dashboard');
      const body = isGrantOnly
        ? grantUsd
        : { data: [], total: 0, page: 1, pageSize: 20, hasMore: false };
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => '',
      } as unknown as Response;
    });
    renderForm({
      onSubmit: jest.fn(),
      // DA en XOF par défaut, convention USD → mismatch attendu.
      defaultValues: { ...baseDefaults(), currency: 'XOF' },
    });
    // L'alerte apparaît dès que useGrant a chargé.
    await waitFor(() => {
      expect(screen.getByTestId('pr-currency-mismatch')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pr-currency-mismatch')).toHaveTextContent(/USD/);
    expect(screen.getByTestId('pr-currency-mismatch')).toHaveTextContent(/BCEAO/i);
  });
});
