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

  it('disables Compta / Trésorerie / Reporting (F2 activates Achats)', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    ['Comptabilité', 'Trésorerie', 'Reporting'].forEach((label) => {
      const el = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(el).not.toBeNull();
    });
    // Achats est désormais cliquable (sprint F2)
    const achats = screen.getByText('Achats').closest('a');
    expect(achats).not.toBeNull();
    expect(achats).toHaveAttribute('href', '/procurement/purchase-requests');
  });

  it('marks Achats active when on a /procurement/* path', () => {
    mockPathname = '/procurement/purchase-requests/abc';
    render(<AppSidebar />);
    const achatsLink = screen.getByText('Achats').closest('a');
    expect(achatsLink).toHaveAttribute('aria-current', 'page');
    expect(achatsLink?.className).toMatch(/border-l-ipd/);
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
