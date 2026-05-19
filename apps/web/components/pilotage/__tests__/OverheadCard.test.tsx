import { render, screen } from '@testing-library/react';
import { OverheadCard } from '../OverheadCard';
import type { OverheadResponse } from '@/lib/api/pilotage';

const base: OverheadResponse = {
  grantId: 'g1',
  grantReference: 'BMGF-2026-001',
  grantOverheadRate: 0.15,
  totalBillable: 100_000,
  totalReversed: 100_000,
  variance: 0,
  variancePercent: 0,
  entries: [
    {
      id: 'oc1',
      periodCode: '2026-04',
      eligibleBase: 666_667,
      overheadRate: 0.15,
      overheadAmount: 100_000,
      journalEntryId: 'je1',
      computedAt: '2026-04-30T00:00:00.000Z',
    },
  ],
};

describe('OverheadCard', () => {
  it('rend les montants facturable et reversé', () => {
    render(<OverheadCard data={base} />);
    expect(screen.getAllByText(/100 000/).length).toBeGreaterThanOrEqual(2);
  });

  it('pas d\'alerte quand variancePercent = 0', () => {
    render(<OverheadCard data={base} />);
    expect(screen.getByTestId('overhead-card')).toHaveAttribute('data-alert', 'false');
    expect(screen.queryByTestId('overhead-alert')).toBeNull();
  });

  it('alerte quand variancePercent > seuil (par défaut 5%)', () => {
    const data: OverheadResponse = {
      ...base,
      totalBillable: 100_000,
      totalReversed: 80_000,
      variance: 20_000,
      variancePercent: 0.2,
    };
    render(<OverheadCard data={data} />);
    expect(screen.getByTestId('overhead-card')).toHaveAttribute('data-alert', 'true');
    expect(screen.getByTestId('overhead-alert')).toBeInTheDocument();
  });

  it('seuil custom (15%) → pas d\'alerte sous 15%', () => {
    const data: OverheadResponse = {
      ...base,
      totalBillable: 100_000,
      totalReversed: 90_000,
      variance: 10_000,
      variancePercent: 0.1,
    };
    render(<OverheadCard data={data} alertThreshold={0.15} />);
    expect(screen.getByTestId('overhead-card')).toHaveAttribute('data-alert', 'false');
  });
});
