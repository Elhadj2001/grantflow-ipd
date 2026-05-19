import { render, screen } from '@testing-library/react';
import { GrantStatusBadge } from '../GrantStatusBadge';

describe('GrantStatusBadge', () => {
  it('active → success variant + libellé "Active"', () => {
    render(<GrantStatusBadge status="active" />);
    const b = screen.getByTestId('grant-status-badge');
    expect(b).toHaveAttribute('data-status', 'active');
    expect(b).toHaveTextContent('Active');
  });

  it('suspended → warning + "Suspendue"', () => {
    render(<GrantStatusBadge status="suspended" />);
    expect(screen.getByTestId('grant-status-badge')).toHaveTextContent('Suspendue');
  });

  it('closed → muted + "Clôturée"', () => {
    render(<GrantStatusBadge status="closed" />);
    expect(screen.getByTestId('grant-status-badge')).toHaveTextContent('Clôturée');
  });

  it('expiring → "Expire bientôt"', () => {
    render(<GrantStatusBadge status="expiring" />);
    expect(screen.getByTestId('grant-status-badge')).toHaveTextContent('Expire bientôt');
  });

  it('expired → "Expirée"', () => {
    render(<GrantStatusBadge status="expired" />);
    expect(screen.getByTestId('grant-status-badge')).toHaveTextContent('Expirée');
  });

  it('draft → "Brouillon"', () => {
    render(<GrantStatusBadge status="draft" />);
    expect(screen.getByTestId('grant-status-badge')).toHaveTextContent('Brouillon');
  });
});
