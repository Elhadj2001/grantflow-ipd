import { render, screen } from '@testing-library/react';

let mockPathname = '/dashboard';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Stub SystemStatus pour ne pas tirer TanStack Query dans ce test
jest.mock('../SystemStatus', () => ({
  SystemStatus: () => <div data-testid="system-status-stub" />,
}));

// Import APRÈS jest.mock (les mocks sont hoistés mais l'import résolu après évaluation)
import { AppSidebar } from '../AppSidebar';

describe('AppSidebar', () => {
  it('renders the 5 navigation entries', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    ['Dashboard', 'Achats', 'Comptabilité', 'Trésorerie', 'Reporting'].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument(),
    );
  });

  it('marks Dashboard active on /dashboard with ipd accent', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink?.className).toMatch(/border-l-ipd/);
  });

  it('disables Achats / Compta / Trésorerie / Reporting in F1', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    ['Achats', 'Comptabilité', 'Trésorerie', 'Reporting'].forEach((label) => {
      const el = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(el).not.toBeNull();
    });
  });

  it('does not mark Dashboard active when on a different path', () => {
    mockPathname = '/something';
    render(<AppSidebar />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');
  });

  it('renders the SystemStatus bloc at the bottom (sprint F1.1)', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    expect(screen.getByTestId('system-status-stub')).toBeInTheDocument();
  });
});
