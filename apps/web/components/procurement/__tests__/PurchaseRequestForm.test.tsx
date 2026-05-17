import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseRequestForm } from '../PurchaseRequestForm';

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

describe('PurchaseRequestForm', () => {
  it('renders the 3 PR type chips', () => {
    render(<PurchaseRequestForm onSubmit={jest.fn()} defaultValues={baseDefaults()} />);
    expect(screen.getByTestId('pr-type-standard')).toBeInTheDocument();
    expect(screen.getByTestId('pr-type-petty_cash')).toBeInTheDocument();
    expect(screen.getByTestId('pr-type-cash_advance')).toBeInTheDocument();
  });

  it('computes total live (qty * unitPrice)', async () => {
    render(<PurchaseRequestForm onSubmit={jest.fn()} defaultValues={baseDefaults()} />);
    // total = 2 * 100 = 200
    await waitFor(() => {
      expect(screen.getByTestId('amount-display')).toHaveAttribute('data-amount', '200');
    });
  });

  it('allows adding and removing lines', async () => {
    const user = userEvent.setup();
    render(<PurchaseRequestForm onSubmit={jest.fn()} defaultValues={baseDefaults()} />);
    expect(screen.getByTestId('pr-line-0')).toBeInTheDocument();
    await user.click(screen.getByTestId('add-line'));
    expect(screen.getByTestId('pr-line-1')).toBeInTheDocument();
    await user.click(screen.getByTestId('remove-line-1'));
    expect(screen.queryByTestId('pr-line-1')).toBeNull();
  });

  it('disables remove on last line', () => {
    render(<PurchaseRequestForm onSubmit={jest.fn()} defaultValues={baseDefaults()} />);
    expect(screen.getByTestId('remove-line-0')).toBeDisabled();
  });

  it('shows petty cash warning when type=petty_cash + total > 100k', async () => {
    const user = userEvent.setup();
    render(
      <PurchaseRequestForm
        onSubmit={jest.fn()}
        defaultValues={{
          ...baseDefaults(),
          lines: [
            { description: 'X', quantity: 1, unit: 'unit', unitPrice: 150_000, budgetLineId: UUID },
          ],
        }}
      />,
    );
    await user.click(screen.getByTestId('pr-type-petty_cash'));
    expect(await screen.findByTestId('petty-cash-warning')).toBeInTheDocument();
    expect(screen.getByTestId('pr-submit')).toBeDisabled();
  });

  it('no petty cash warning when type=standard even with big total', async () => {
    render(
      <PurchaseRequestForm
        onSubmit={jest.fn()}
        defaultValues={{
          ...baseDefaults(),
          lines: [{ description: 'X', quantity: 1, unit: 'unit', unitPrice: 500_000, budgetLineId: UUID }],
        }}
      />,
    );
    expect(screen.queryByTestId('petty-cash-warning')).toBeNull();
  });

  it('calls onSubmit with normalized payload', async () => {
    const onSubmit = jest.fn();
    render(<PurchaseRequestForm onSubmit={onSubmit} defaultValues={baseDefaults()} />);
    fireEvent.submit(screen.getByTestId('pr-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0][0];
    expect(call.description).toBe('Achat de réactifs Q2 2026');
    expect(call.lines).toHaveLength(1);
    expect(call.lines[0].quantity).toBe(2);
    expect(call.lines[0].unitPrice).toBe(100);
  });
});
