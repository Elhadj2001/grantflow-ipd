import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BudgetLinePicker } from '../BudgetLinePicker';
import {
  installReferentialFetchMock,
  mockGrantDashboards,
} from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

// L'ID du grant principal des fixtures (3 lignes : L01, L02, L03 vertes, L04 orange)
const GRANT_ID = Object.keys(mockGrantDashboards)[0];

describe('BudgetLinePicker', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('is disabled when grantId is null', () => {
    renderWithQuery(<BudgetLinePicker grantId={null} value={null} onChange={jest.fn()} />);
    expect(screen.getByTestId('budget-line-picker')).toBeDisabled();
  });

  it('lists budget lines with code, label, and availability', async () => {
    const user = userEvent.setup();
    renderWithQuery(<BudgetLinePicker grantId={GRANT_ID} value={null} onChange={jest.fn()} />);
    await user.click(screen.getByTestId('budget-line-picker'));
    await waitFor(() => {
      expect(screen.getByText(/L01 — Consommables/)).toBeInTheDocument();
    });
    expect(screen.getByText(/L02 — Équipement/)).toBeInTheDocument();
    // 60% disponible — pas de badge insuffisant
    expect(screen.queryByText(/Solde insuffisant/)).toBeNull();
  });

  it('flags lines as insufficient when requestedAmount > available', async () => {
    const user = userEvent.setup();
    // L04 a 2000 disponible — demander 5000 doit déclencher le flag
    renderWithQuery(
      <BudgetLinePicker
        grantId={GRANT_ID}
        value={null}
        onChange={jest.fn()}
        requestedAmount={5000}
      />,
    );
    await user.click(screen.getByTestId('budget-line-picker'));
    const badges = await screen.findAllByText(/Solde insuffisant/);
    // L02 (40k), L04 (2k), pas L01/L03 (qui ont 120k/90k)
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('emits onChange with the selected entry', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithQuery(<BudgetLinePicker grantId={GRANT_ID} value={null} onChange={onChange} />);
    await user.click(screen.getByTestId('budget-line-picker'));
    await user.click(await screen.findByText(/L01 — Consommables/));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [id, entry] = onChange.mock.calls.at(-1)!;
    expect(entry?.code).toBe('L01');
    expect(entry?.available).toBe(120000);
    expect(id).toBe(entry?.budgetLineId);
  });

  it('supports custom testId per line', () => {
    renderWithQuery(
      <BudgetLinePicker grantId={null} value={null} onChange={jest.fn()} testId="bl-line-3" />,
    );
    expect(screen.getByTestId('bl-line-3')).toBeInTheDocument();
  });
});
