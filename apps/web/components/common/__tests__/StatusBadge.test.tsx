import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('maps draft → muted + "Brouillon"', () => {
    render(<StatusBadge status="draft" />);
    const b = screen.getByTestId('status-badge-draft');
    expect(b).toHaveTextContent('Brouillon');
    expect(b.className).toMatch(/bg-slate-100/);
  });

  it('maps approved → success + "Approuvée"', () => {
    render(<StatusBadge status="approved" />);
    const b = screen.getByTestId('status-badge-approved');
    expect(b).toHaveTextContent('Approuvée');
    expect(b.className).toMatch(/state-success/);
  });

  it('maps rejected → error + "Rejetée"', () => {
    render(<StatusBadge status="rejected" />);
    const b = screen.getByTestId('status-badge-rejected');
    expect(b).toHaveTextContent('Rejetée');
    expect(b.className).toMatch(/state-error/);
  });

  it('maps pending_pi → warning + "En attente PI"', () => {
    render(<StatusBadge status="pending_pi" />);
    expect(screen.getByTestId('status-badge-pending_pi')).toHaveTextContent('En attente PI');
  });

  it('maps petty_cash → secondary + "Caisse"', () => {
    render(<StatusBadge status="petty_cash" />);
    expect(screen.getByTestId('status-badge-petty_cash')).toHaveTextContent('Caisse');
  });

  it('falls back to muted variant for unknown status', () => {
    render(<StatusBadge status="unknown_xyz" />);
    const b = screen.getByTestId('status-badge-unknown_xyz');
    expect(b).toHaveTextContent('unknown_xyz');
    expect(b.className).toMatch(/bg-slate-100/);
  });

  it('respects label override', () => {
    render(<StatusBadge status="warning" label="Custom" />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });
});
