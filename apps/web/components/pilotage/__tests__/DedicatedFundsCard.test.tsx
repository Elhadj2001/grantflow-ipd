import { render, screen } from '@testing-library/react';
import { DedicatedFundsCard } from '../DedicatedFundsCard';
import type { DedicatedFundsResponse } from '@/lib/api/pilotage';

const baseData: DedicatedFundsResponse = {
  grantId: 'g1',
  grantReference: 'BMGF-2026-001',
  balance: 5_000_000,
  currency: 'XOF',
  movements: [
    {
      id: 'm1',
      movementType: 'allocation',
      amount: 3_000_000,
      currency: 'XOF',
      rationale: 'Surplus ressources 2026-03',
      computedAt: '2026-03-31T00:00:00.000Z',
      journalEntryId: 'je1',
      periodCode: '2026-03',
    },
  ],
  lastMovement: null,
};

describe('DedicatedFundsCard', () => {
  it('affiche le solde du compte 19', () => {
    render(<DedicatedFundsCard data={{ ...baseData, lastMovement: baseData.movements[0] }} />);
    expect(screen.getByTestId('dedicated-funds-balance')).toHaveTextContent(/5 000 000/);
  });

  it('rend le dernier mouvement avec rationale', () => {
    render(<DedicatedFundsCard data={{ ...baseData, lastMovement: baseData.movements[0] }} />);
    expect(screen.getByTestId('dedicated-funds-last-movement')).toBeInTheDocument();
    expect(screen.getByText(/Surplus ressources 2026-03/)).toBeInTheDocument();
    expect(screen.getByText(/Dernière dotation \(689\)/)).toBeInTheDocument();
  });

  it('reprise → libellé 789 + icône down', () => {
    const data: DedicatedFundsResponse = {
      ...baseData,
      lastMovement: {
        ...baseData.movements[0],
        movementType: 'reprise',
        rationale: 'Reprise sur surplus N-1',
      },
    };
    render(<DedicatedFundsCard data={data} />);
    expect(screen.getByText(/Dernière reprise \(789\)/)).toBeInTheDocument();
  });

  it('affiche message vide si aucun mouvement', () => {
    const data: DedicatedFundsResponse = {
      ...baseData,
      balance: 0,
      movements: [],
      lastMovement: null,
    };
    render(<DedicatedFundsCard data={data} />);
    expect(screen.queryByTestId('dedicated-funds-last-movement')).toBeNull();
    expect(screen.getByText(/Aucun mouvement enregistré/)).toBeInTheDocument();
  });
});
