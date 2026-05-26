import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrepaymentsForm } from '../PrepaymentsForm';

describe('PrepaymentsForm', () => {
  it('démarre avec 1 entrée par défaut', () => {
    render(<PrepaymentsForm onSubmit={jest.fn()} />);
    expect(screen.getByTestId('prepayment-entry-0')).toBeInTheDocument();
    expect(screen.queryByTestId('prepayment-entry-1')).toBeNull();
  });

  it('clic "Ajouter" ajoute une seconde entrée', () => {
    render(<PrepaymentsForm onSubmit={jest.fn()} />);
    fireEvent.click(screen.getByTestId('prepayment-add'));
    expect(screen.getByTestId('prepayment-entry-1')).toBeInTheDocument();
  });

  it('clic Supprimer retire une entrée (uniquement quand > 1)', () => {
    render(<PrepaymentsForm onSubmit={jest.fn()} />);
    // 1 entrée → pas de bouton remove
    expect(screen.queryByTestId('prepayment-remove-0')).toBeNull();

    fireEvent.click(screen.getByTestId('prepayment-add'));
    expect(screen.getByTestId('prepayment-remove-0')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('prepayment-remove-1'));
    expect(screen.queryByTestId('prepayment-entry-1')).toBeNull();
  });

  it('submit transmet bien les valeurs typées', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<PrepaymentsForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('prepayment-account-0'), {
      target: { value: '622' },
    });
    fireEvent.change(screen.getByTestId('prepayment-amount-0'), {
      target: { value: '125000' },
    });
    fireEvent.change(screen.getByTestId('prepayment-label-0'), {
      target: { value: 'Loyer Q1 2027' },
    });
    fireEvent.click(screen.getByTestId('prepayments-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({
          direction: 'CCA',
          accountCode: '622',
          amount: 125_000,
          label: 'Loyer Q1 2027',
        }),
      ],
    });
  });

  it('libellé < 3 caractères → erreur de validation Zod, pas de submit', async () => {
    const onSubmit = jest.fn();
    render(<PrepaymentsForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('prepayment-account-0'), {
      target: { value: '622' },
    });
    fireEvent.change(screen.getByTestId('prepayment-amount-0'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByTestId('prepayment-label-0'), {
      target: { value: 'OK' }, // 2 caractères
    });
    fireEvent.click(screen.getByTestId('prepayments-submit'));
    await waitFor(() => {
      expect(screen.getByText(/min 3 caractères/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('changement de direction CCA → PCA reflété', () => {
    render(<PrepaymentsForm onSubmit={jest.fn()} />);
    const select = screen.getByTestId('prepayment-direction-0') as HTMLSelectElement;
    expect(select.value).toBe('CCA');
    fireEvent.change(select, { target: { value: 'PCA' } });
    expect(select.value).toBe('PCA');
  });
});
