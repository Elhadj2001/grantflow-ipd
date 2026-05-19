import { render, screen } from '@testing-library/react';
import { IbanAlertBadge } from '../IbanAlertBadge';

describe('IbanAlertBadge', () => {
  it('renders OK level (green)', () => {
    render(<IbanAlertBadge level="ok" />);
    const badge = screen.getByTestId('iban-alert-badge');
    expect(badge).toHaveAttribute('data-level', 'ok');
    expect(badge).toHaveTextContent('IBAN OK');
  });

  it('renders warn level with count', () => {
    render(<IbanAlertBadge level="warn" count={3} />);
    const badge = screen.getByTestId('iban-alert-badge');
    expect(badge).toHaveAttribute('data-level', 'warn');
    expect(badge).toHaveTextContent('IBAN acknowledgé');
    expect(badge).toHaveTextContent('(3)');
  });

  it('renders critical level with count', () => {
    render(<IbanAlertBadge level="critical" count={2} />);
    const badge = screen.getByTestId('iban-alert-badge');
    expect(badge).toHaveAttribute('data-level', 'critical');
    expect(badge).toHaveTextContent('IBAN à vérifier');
    expect(badge).toHaveTextContent('(2)');
  });

  it('does not show count for OK level even if provided', () => {
    render(<IbanAlertBadge level="ok" count={3} />);
    expect(screen.getByTestId('iban-alert-badge').textContent).not.toContain('(3)');
  });

  it('does not show count if count is 0', () => {
    render(<IbanAlertBadge level="warn" count={0} />);
    expect(screen.getByTestId('iban-alert-badge').textContent).not.toContain('(0)');
  });
});
