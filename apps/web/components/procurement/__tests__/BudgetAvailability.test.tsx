import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  BudgetAvailability,
  type BudgetAvailabilityValue,
} from '../BudgetAvailability';
import {
  installReferentialFetchMock,
  mockGrantDashboards,
  mockProjects,
} from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

const GRANT_ID = Object.keys(mockGrantDashboards)[0];

function Harness({ requestedAmount }: { requestedAmount?: number }) {
  const [val, setVal] = useState<BudgetAvailabilityValue>({
    projectId: null,
    grantId: null,
    budgetLineId: null,
    currency: null,
    available: null,
    budgeted: null,
  });
  return <BudgetAvailability value={val} onChange={setVal} requestedAmount={requestedAmount} />;
}

describe('BudgetAvailability', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('shows 3 pickers; grant + budget-line disabled initially', async () => {
    renderWithQuery(<Harness />);
    expect(screen.getByTestId('project-picker')).toBeEnabled();
    expect(screen.getByTestId('grant-picker')).toBeDisabled();
    expect(screen.getByTestId('budget-line-picker')).toBeDisabled();
  });

  it('cascade: picking project enables grant; picking grant enables budget line', async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByTestId('project-picker'));
    await user.click(await screen.findByText(/MADIBA-VAC-2024/));

    await waitFor(() => {
      expect(screen.getByTestId('grant-picker')).toBeEnabled();
    });

    await user.click(screen.getByTestId('grant-picker'));
    await user.click(await screen.findByText('BMGF-2023-117'));

    await waitFor(() => {
      expect(screen.getByTestId('budget-line-picker')).toBeEnabled();
    });
  });

  it('renders BudgetIndicator once a budget line is selected, with requested amount', async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness requestedAmount={5000} />);

    // Sélectionner projet → grant → ligne (L04 a 2000 dispo → insuffisant)
    await user.click(screen.getByTestId('project-picker'));
    await user.click(await screen.findByText(/MADIBA-VAC-2024/));
    await user.click(screen.getByTestId('grant-picker'));
    await user.click(await screen.findByText('BMGF-2023-117'));
    await user.click(screen.getByTestId('budget-line-picker'));
    await user.click(await screen.findByText(/L04 — Voyage/));

    await waitFor(() => {
      expect(screen.getByTestId('budget-indicator')).toHaveAttribute(
        'data-state',
        'insufficient',
      );
    });
  });

  it('hideBudgetLine masks the third picker and the indicator', () => {
    renderWithQuery(
      <BudgetAvailability
        value={{
          projectId: mockProjects[0].id,
          grantId: null,
          budgetLineId: null,
          currency: null,
          available: null,
          budgeted: null,
        }}
        onChange={jest.fn()}
        hideBudgetLine
      />,
    );
    expect(screen.queryByTestId('budget-line-picker')).toBeNull();
    expect(screen.queryByTestId('budget-indicator')).toBeNull();
  });
});
