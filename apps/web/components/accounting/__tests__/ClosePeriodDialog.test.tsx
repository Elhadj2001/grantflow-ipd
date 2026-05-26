import { fireEvent, render, screen } from '@testing-library/react';
import { ClosePeriodDialog } from '../ClosePeriodDialog';

describe('ClosePeriodDialog', () => {
  it('sans finding bloquant : bouton Clôturer actif immédiatement', () => {
    const onConfirm = jest.fn();
    render(
      <ClosePeriodDialog
        open
        onOpenChange={() => undefined}
        blockingCount={0}
        canOverride={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId('close-confirm')).not.toBeDisabled();
    expect(screen.queryByTestId('close-blocking-banner')).toBeNull();
  });

  it('avec findings bloquants + canOverride : checkbox + reason ≥ 5 requis', () => {
    const onConfirm = jest.fn();
    render(
      <ClosePeriodDialog
        open
        onOpenChange={() => undefined}
        blockingCount={2}
        canOverride
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId('close-blocking-banner')).toBeInTheDocument();
    expect(screen.getByTestId('acknowledge-checkbox')).toBeInTheDocument();
    expect(screen.getByTestId('close-confirm')).toBeDisabled();

    // Coche + ajout d'un motif court → toujours désactivé
    fireEvent.click(screen.getByTestId('acknowledge-checkbox'));
    fireEvent.change(screen.getByTestId('close-reason'), { target: { value: 'abc' } });
    expect(screen.getByTestId('close-confirm')).toBeDisabled();

    // Motif valide → activé
    fireEvent.change(screen.getByTestId('close-reason'), {
      target: { value: 'C006 résolu manuellement' },
    });
    expect(screen.getByTestId('close-confirm')).not.toBeDisabled();
  });

  it('avec findings bloquants + !canOverride : bouton désactivé même avec reason', () => {
    render(
      <ClosePeriodDialog
        open
        onOpenChange={() => undefined}
        blockingCount={2}
        canOverride={false}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText(/Seul un DAF/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('close-reason'), {
      target: { value: 'Motif valide' },
    });
    expect(screen.getByTestId('close-confirm')).toBeDisabled();
  });

  it('clic Confirmer transmet acknowledge + reason au caller', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    render(
      <ClosePeriodDialog
        open
        onOpenChange={() => undefined}
        blockingCount={1}
        canOverride
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId('acknowledge-checkbox'));
    fireEvent.change(screen.getByTestId('close-reason'), {
      target: { value: 'Override valide' },
    });
    fireEvent.click(screen.getByTestId('close-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      acknowledgeWarnings: true,
      reason: 'Override valide',
    });
  });

  it('errorMessage affiché sous le formulaire', () => {
    render(
      <ClosePeriodDialog
        open
        onOpenChange={() => undefined}
        blockingCount={0}
        canOverride
        onConfirm={jest.fn()}
        errorMessage="Erreur 409 — PERIOD_CLOSE_BLOCKED"
      />,
    );
    expect(screen.getByTestId('close-error')).toHaveTextContent(/PERIOD_CLOSE_BLOCKED/);
  });
});
