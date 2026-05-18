import { render, screen } from '@testing-library/react';
import { ScanResultBadge } from '../ScanResultBadge';

describe('ScanResultBadge', () => {
  it('renders nothing when kind is null', () => {
    const { container } = render(<ScanResultBadge kind={null} message="ignored" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when message is null', () => {
    const { container } = render(<ScanResultBadge kind="ok" message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ok variant with success colors', () => {
    render(<ScanResultBadge kind="ok" message="Ligne 1 +1" />);
    const badge = screen.getByTestId('scan-result-badge');
    expect(badge).toHaveAttribute('data-kind', 'ok');
    expect(badge).toHaveTextContent('Ligne 1 +1');
    expect(badge.className).toMatch(/state-success/);
  });

  it('renders warn variant', () => {
    render(<ScanResultBadge kind="warn" message="Quantité dépassée" />);
    expect(screen.getByTestId('scan-result-badge')).toHaveAttribute('data-kind', 'warn');
  });

  it('renders error variant', () => {
    render(<ScanResultBadge kind="error" message="Code non reconnu" />);
    expect(screen.getByTestId('scan-result-badge')).toHaveAttribute('data-kind', 'error');
  });
});
