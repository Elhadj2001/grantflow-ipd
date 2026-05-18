import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColdChainBadge } from '../ColdChainBadge';

describe('ColdChainBadge', () => {
  it('renders nothing when required=false', () => {
    const { container } = render(<ColdChainBadge required={false} value={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows pending state when value is null', () => {
    render(<ColdChainBadge required value={null} onChange={jest.fn()} />);
    const badge = screen.getByTestId('coldchain-badge');
    expect(badge).toHaveAttribute('data-value', 'pending');
  });

  it('shows ok state when value is true (edit mode)', () => {
    render(<ColdChainBadge required value={true} onChange={jest.fn()} />);
    const badge = screen.getByTestId('coldchain-badge');
    expect(badge).toHaveAttribute('data-value', 'ok');
  });

  it('shows broken state when value is false', () => {
    render(<ColdChainBadge required value={false} onChange={jest.fn()} />);
    const badge = screen.getByTestId('coldchain-badge');
    expect(badge).toHaveAttribute('data-value', 'broken');
  });

  it('emits onChange(true) when Conforme clicked', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<ColdChainBadge required value={null} onChange={onChange} />);
    await user.click(screen.getByTestId('coldchain-ok'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('emits onChange(false) when Rompue clicked', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<ColdChainBadge required value={null} onChange={onChange} />);
    await user.click(screen.getByTestId('coldchain-broken'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('toggles off when clicking the active button (back to null)', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<ColdChainBadge required value={true} onChange={onChange} />);
    await user.click(screen.getByTestId('coldchain-ok'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders read-only badge when readOnly=true', () => {
    render(<ColdChainBadge required value={true} readOnly />);
    expect(screen.getByText('Chaîne du froid OK')).toBeInTheDocument();
    // Pas de bouton interactif en read-only
    expect(screen.queryByTestId('coldchain-ok')).toBeNull();
  });

  it('shows "rompue" label in read-only when value=false', () => {
    render(<ColdChainBadge required value={false} readOnly />);
    expect(screen.getByText('Chaîne du froid rompue')).toBeInTheDocument();
  });

  it('shows "à vérifier" label in read-only when value=null', () => {
    render(<ColdChainBadge required value={null} readOnly />);
    expect(screen.getByText('Chaîne du froid à vérifier')).toBeInTheDocument();
  });
});
