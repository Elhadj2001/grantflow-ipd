import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanBarcode } from '../ScanBarcode';

// On capture le callback onSuccess passé à `instance.start()` pour pouvoir
// simuler un scan depuis le test.
let lastOnSuccess: ((decoded: string) => void) | null = null;

jest.mock('html5-qrcode', () => ({
  Html5Qrcode: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockImplementation((_camera, _config, onSuccess) => {
      lastOnSuccess = onSuccess;
      return Promise.resolve();
    }),
    stop: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
  })),
}));

beforeEach(() => {
  lastOnSuccess = null;
});

describe('ScanBarcode', () => {
  it('renders overlay with cible visuelle + boutons fermer / manuel', async () => {
    render(<ScanBarcode onScan={jest.fn()} onClose={jest.fn()} onSwitchToManual={jest.fn()} />);
    expect(screen.getByTestId('scan-barcode')).toBeInTheDocument();
    expect(screen.getByTestId('scan-close')).toBeInTheDocument();
    expect(screen.getByTestId('scan-switch-manual')).toBeInTheDocument();
  });

  it('initialise html5-qrcode et fire onScan au décodage', async () => {
    const onScan = jest.fn();
    render(<ScanBarcode onScan={onScan} onClose={jest.fn()} />);

    // Attend que le useEffect ait branché lastOnSuccess
    await waitFor(() => {
      expect(lastOnSuccess).not.toBeNull();
    });

    act(() => {
      lastOnSuccess!('GRF://abc/def');
    });
    expect(onScan).toHaveBeenCalledWith('GRF://abc/def');
  });

  it('dedup : ignore le même code scanné dans 1500ms', async () => {
    const onScan = jest.fn();
    render(<ScanBarcode onScan={onScan} onClose={jest.fn()} />);
    await waitFor(() => expect(lastOnSuccess).not.toBeNull());

    act(() => {
      lastOnSuccess!('CODE-A');
      lastOnSuccess!('CODE-A'); // dup → ignoré
      lastOnSuccess!('CODE-B');
    });
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onScan).toHaveBeenNthCalledWith(1, 'CODE-A');
    expect(onScan).toHaveBeenNthCalledWith(2, 'CODE-B');
  });

  it('appelle onClose quand X cliqué', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ScanBarcode onScan={jest.fn()} onClose={onClose} />);
    await user.click(screen.getByTestId('scan-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('appelle onSwitchToManual quand Saisie manuelle cliqué', async () => {
    const onSwitchToManual = jest.fn();
    const user = userEvent.setup();
    render(
      <ScanBarcode
        onScan={jest.fn()}
        onClose={jest.fn()}
        onSwitchToManual={onSwitchToManual}
      />,
    );
    await user.click(screen.getByTestId('scan-switch-manual'));
    expect(onSwitchToManual).toHaveBeenCalled();
  });
});
