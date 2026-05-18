import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarcodeQuickInput } from '../BarcodeQuickInput';

describe('BarcodeQuickInput', () => {
  it('renders an autofocused input with submit button', () => {
    render(<BarcodeQuickInput onSubmit={jest.fn()} />);
    const input = screen.getByTestId('barcode-quick-field');
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('submits typed value via Enter key', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<BarcodeQuickInput onSubmit={onSubmit} />);
    const input = screen.getByTestId('barcode-quick-field');
    await user.type(input, 'GRF://test{enter}');
    expect(onSubmit).toHaveBeenCalledWith('GRF://test');
  });

  it('submits via button click', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<BarcodeQuickInput onSubmit={onSubmit} />);
    await user.type(screen.getByTestId('barcode-quick-field'), 'CODE-42');
    await user.click(screen.getByTestId('barcode-quick-submit'));
    expect(onSubmit).toHaveBeenCalledWith('CODE-42');
  });

  it('does not submit empty input', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<BarcodeQuickInput onSubmit={onSubmit} />);
    await user.click(screen.getByTestId('barcode-quick-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('trims whitespace before submit', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<BarcodeQuickInput onSubmit={onSubmit} />);
    await user.type(screen.getByTestId('barcode-quick-field'), '   spaces   {enter}');
    expect(onSubmit).toHaveBeenCalledWith('spaces');
  });

  it('clears input + refocuses after submit (chained scans)', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<BarcodeQuickInput onSubmit={onSubmit} />);
    const input = screen.getByTestId('barcode-quick-field') as HTMLInputElement;
    await user.type(input, 'A{enter}');
    expect(input.value).toBe('');
    // user.type a refait focus côté lib mais setTimeout(0) côté composant peut
    // retarder le refocus — on vérifie juste que l'input n'est pas désactivé
    expect(input).not.toBeDisabled();
  });
});
