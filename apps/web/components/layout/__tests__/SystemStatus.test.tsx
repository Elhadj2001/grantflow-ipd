import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { SystemStatus } from '../SystemStatus';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const originalFetch = global.fetch;

describe('SystemStatus', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows "API en ligne" when /health returns {status:"ok"}', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok', ts: '2026-05-17T12:00:00Z' }),
    }) as unknown as typeof fetch;
    wrap(<SystemStatus />);
    await waitFor(() => {
      const el = screen.getByTestId('system-status');
      expect(el).toHaveAttribute('data-status', 'online');
    });
    expect(screen.getByText('API en ligne')).toBeInTheDocument();
  });

  it('shows "API hors ligne" on fetch error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    wrap(<SystemStatus />);
    await waitFor(() => {
      const el = screen.getByTestId('system-status');
      expect(el).toHaveAttribute('data-status', 'offline');
    });
    expect(screen.getByText('API hors ligne')).toBeInTheDocument();
  });

  it('shows "Connexion…" while loading', () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    wrap(<SystemStatus />);
    expect(screen.getByText(/Connexion/)).toBeInTheDocument();
    const el = screen.getByTestId('system-status');
    expect(el).toHaveAttribute('data-status', 'loading');
  });
});
