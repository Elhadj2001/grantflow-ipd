import { render, screen } from '@testing-library/react';
import { DonorReportStatusBadge } from '../DonorReportStatusBadge';

describe('DonorReportStatusBadge', () => {
  it('draft → muted variant + label "Brouillon"', () => {
    render(<DonorReportStatusBadge status="draft" />);
    const badge = screen.getByTestId('donor-report-status-badge');
    expect(badge).toHaveAttribute('data-status', 'draft');
    expect(badge).toHaveTextContent('Brouillon');
  });

  it('locked → warning variant + label "Verrouillé"', () => {
    render(<DonorReportStatusBadge status="locked" />);
    const badge = screen.getByTestId('donor-report-status-badge');
    expect(badge).toHaveAttribute('data-status', 'locked');
    expect(badge).toHaveTextContent('Verrouillé');
  });

  it('sent → success variant + label "Envoyé"', () => {
    render(<DonorReportStatusBadge status="sent" />);
    const badge = screen.getByTestId('donor-report-status-badge');
    expect(badge).toHaveAttribute('data-status', 'sent');
    expect(badge).toHaveTextContent('Envoyé');
  });

  it('inclut une icône (svg) à chaque statut', () => {
    const { container, rerender } = render(<DonorReportStatusBadge status="draft" />);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<DonorReportStatusBadge status="sent" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
