import { render, screen } from '@testing-library/react';
import { AmountDisplay } from '../AmountDisplay';

describe('AmountDisplay', () => {
  it('formats XOF without decimals + currency suffix', () => {
    render(<AmountDisplay amount={1500000} />);
    const el = screen.getByTestId('amount-display');
    // Espaces insécables (Intl fr-FR utilise des espaces fins)
    const text = el.textContent ?? '';
    expect(text.replace(/ | /g, ' ')).toMatch(/1 500 000/);
    expect(text).toContain('XOF');
  });

  it('formats USD with 2 decimals by default', () => {
    render(<AmountDisplay amount={1234.5} currency="USD" />);
    const text = screen.getByTestId('amount-display').textContent ?? '';
    // Intl fr-FR utilise U+202F (espace fine insécable) — \s match
    expect(text).toMatch(/1\s?234,50/);
    expect(text).toContain('USD');
  });

  it('respects custom decimals', () => {
    render(<AmountDisplay amount={42} decimals={3} />);
    expect((screen.getByTestId('amount-display').textContent ?? '')).toMatch(/42,000/);
  });

  it('handles negative amounts with sign', () => {
    render(<AmountDisplay amount={-250} />);
    expect((screen.getByTestId('amount-display').textContent ?? '')).toMatch(/-250/);
  });

  it('applies signColor red on negative', () => {
    const { container } = render(<AmountDisplay amount={-250} signColor />);
    expect(container.querySelector('.text-state-error')).not.toBeNull();
  });

  it('applies signColor green on positive', () => {
    const { container } = render(<AmountDisplay amount={250} signColor />);
    expect(container.querySelector('.text-state-success')).not.toBeNull();
  });

  it('accepts string amount (from Decimal Prisma)', () => {
    render(<AmountDisplay amount="9999" currency="XOF" />);
    const text = screen.getByTestId('amount-display').textContent ?? '';
    expect(text).toMatch(/9\s?999/);
  });

  it('handles null amount → 0', () => {
    render(<AmountDisplay amount={null} />);
    expect(screen.getByTestId('amount-display')).toHaveAttribute('data-amount', '0');
  });

  it('handles non-finite (NaN) → 0', () => {
    render(<AmountDisplay amount={NaN} />);
    expect(screen.getByTestId('amount-display')).toHaveAttribute('data-amount', '0');
  });
});
