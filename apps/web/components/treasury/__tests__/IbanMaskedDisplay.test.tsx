import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IbanMaskedDisplay, maskIban } from '../IbanMaskedDisplay';

jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('maskIban (helper)', () => {
  it('renders dash for null/undefined/empty', () => {
    expect(maskIban(null)).toBe('—');
    expect(maskIban(undefined)).toBe('—');
    expect(maskIban('')).toBe('—');
  });

  it('masks middle keeping country + last 4', () => {
    expect(maskIban('FR7630006000011234567890189')).toBe('FR76 **** **** **** **01 89');
  });

  it('handles whitespace input', () => {
    expect(maskIban('FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 **** **** **** **01 89');
  });

  it('returns **** for too-short input', () => {
    expect(maskIban('FR76')).toBe('****');
  });
});

describe('IbanMaskedDisplay', () => {
  it('renders dash for null IBAN', () => {
    render(<IbanMaskedDisplay iban={null} />);
    expect(screen.getByTestId('iban-masked-empty')).toBeInTheDocument();
  });

  it('renders masked IBAN with copy button', () => {
    render(<IbanMaskedDisplay iban="FR7630006000011234567890189" />);
    expect(screen.getByTestId('iban-masked')).toHaveTextContent(
      /FR76\s+\*\*\*\*\s+\*\*\*\*\s+\*\*\*\*\s+\*\*01\s+89/,
    );
    expect(screen.getByTestId('iban-copy-btn')).toBeInTheDocument();
  });

  it('hides copy button in compact mode', () => {
    render(<IbanMaskedDisplay iban="FR7630006000011234567890189" compact />);
    expect(screen.queryByTestId('iban-copy-btn')).toBeNull();
  });

  it('hides copy button when allowCopy=false', () => {
    render(<IbanMaskedDisplay iban="FR7630006000011234567890189" allowCopy={false} />);
    expect(screen.queryByTestId('iban-copy-btn')).toBeNull();
  });

  it('copies the full IBAN to clipboard on click', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    // jsdom n'expose pas navigator.clipboard ; on l'injecte via defineProperty
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<IbanMaskedDisplay iban="FR7630006000011234567890189" />);
    fireEvent.click(screen.getByTestId('iban-copy-btn'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('FR7630006000011234567890189');
    });
  });
});
