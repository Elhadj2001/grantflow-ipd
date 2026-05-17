import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierPicker } from '../SupplierPicker';
import { installReferentialFetchMock, mockSuppliers } from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('SupplierPicker', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('renders all active suppliers initially', async () => {
    const user = userEvent.setup();
    renderWithQuery(<SupplierPicker value={null} onChange={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('supplier-picker')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('supplier-picker'));
    await waitFor(() => {
      expect(screen.getByText(/Thermo Fisher Scientific/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Merck Sénégal/)).toBeInTheDocument();
    expect(screen.getByText(/Bio-Rad Laboratories/)).toBeInTheDocument();
  });

  it('shows "RIB OK" for suppliers with IBAN+BIC and "RIB manquant" otherwise', async () => {
    const user = userEvent.setup();
    renderWithQuery(<SupplierPicker value={null} onChange={jest.fn()} />);
    await user.click(await screen.findByTestId('supplier-picker'));

    // Thermo Fisher → IBAN + BIC remplis → RIB OK
    await waitFor(() => {
      expect(screen.getByTestId(`supplier-rib-${mockSuppliers[0].id}`)).toHaveTextContent('RIB OK');
    });
    // Bio-Rad → IBAN null → RIB manquant
    expect(screen.getByTestId(`supplier-rib-${mockSuppliers[2].id}`)).toHaveTextContent('RIB manquant');
  });

  it('debounces the search query and filters server-side', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQuery(<SupplierPicker value={null} onChange={jest.fn()} />);
    await user.click(await screen.findByTestId('supplier-picker'));
    const input = await screen.findByPlaceholderText(/Rechercher par nom ou code/);

    await user.type(input, 'merck');
    // Le debounce est de 300ms — on attend que le filtre serveur prenne effet
    await waitFor(
      () => {
        expect(screen.getByText(/Merck Sénégal/)).toBeInTheDocument();
        expect(screen.queryByText(/Thermo Fisher Scientific/)).toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('renders empty state when total=0 and no search', async () => {
    // Mock fetch pour renvoyer total=0 sans search
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: [], total: 0, page: 1, pageSize: 50, hasMore: false }),
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWithQuery(<SupplierPicker value={null} onChange={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('supplier-picker-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/Aucun fournisseur enregistré/)).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: /Créer un fournisseur/ });
    expect(createBtn).toBeDisabled();
  });

  it('emits onChange when a supplier is picked', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithQuery(<SupplierPicker value={null} onChange={onChange} />);
    await user.click(await screen.findByTestId('supplier-picker'));
    await user.click(await screen.findByText(/Thermo Fisher Scientific/));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [id, supplier] = onChange.mock.calls.at(-1)!;
    expect(id).toBe(mockSuppliers[0].id);
    expect(supplier?.code).toBe('THERMO_FISHER');
  });
});
