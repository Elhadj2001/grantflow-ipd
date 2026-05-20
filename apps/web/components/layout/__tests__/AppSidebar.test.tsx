import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';

let mockPathname = '/dashboard';
let mockRoles: GrantflowRole[] = ['SUPER_ADMIN'];

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Sprint F-PILOTAGE : AppSidebar utilise désormais usePermissions →
// importe next-auth/react. On stubbe useSession pour éviter l'ESM import.
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

// Stub SystemStatus pour ne pas tirer TanStack Query dans ce test
jest.mock('../SystemStatus', () => ({
  SystemStatus: () => <div data-testid="system-status-stub" />,
}));

// Import APRÈS jest.mock (les mocks sont hoistés mais l'import résolu après évaluation)
import { AppSidebar } from '../AppSidebar';

describe('AppSidebar', () => {
  it('renders the navigation entries (SUPER_ADMIN voit tout dont Pilotage)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    ['Dashboard', 'Achats', 'Comptabilité', 'Trésorerie', 'Pilotage', 'Reporting'].forEach(
      (label) => expect(screen.getByText(label)).toBeInTheDocument(),
    );
  });

  it('Pilotage visible pour CONTROLEUR (sprint F-PILOTAGE)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('Pilotage')).toBeInTheDocument();
  });

  it('Pilotage visible pour PI (sprint F-PILOTAGE)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['PI'];
    render(<AppSidebar />);
    expect(screen.getByText('Pilotage')).toBeInTheDocument();
  });

  it('Pilotage masqué pour rôles sans accès (ex. DEMANDEUR seul)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['DEMANDEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Pilotage')).toBeNull();
  });

  it('marks Dashboard active on /dashboard with ipd accent', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink?.className).toMatch(/border-l-ipd/);
  });

  it('disables Reporting (F2/F3/F4b activent Achats/Comptabilité/Trésorerie)', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    const reporting = screen.getByText('Reporting').closest('[aria-disabled="true"]');
    expect(reporting).not.toBeNull();
    // Achats actif depuis F2
    const achats = screen.getByText('Achats').closest('a');
    expect(achats).toHaveAttribute('href', '/procurement/purchase-requests');
    // Comptabilité actif depuis F3
    const compta = screen.getByText('Comptabilité').closest('a');
    expect(compta).toHaveAttribute('href', '/accounting/invoices');
    // Trésorerie actif depuis F4b
    const treso = screen.getByText('Trésorerie').closest('a');
    expect(treso).not.toBeNull();
    expect(treso).toHaveAttribute('href', '/treasury/payment-runs');
  });

  it('marks Trésorerie active when on a /treasury/* path (sprint F4b)', () => {
    mockPathname = '/treasury/payment-runs/abc';
    render(<AppSidebar />);
    const link = screen.getByText('Trésorerie').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link?.className).toMatch(/border-l-ipd/);
  });

  it('marks Comptabilité active when on a /accounting/* path (sprint F3)', () => {
    mockPathname = '/accounting/invoices/abc';
    render(<AppSidebar />);
    const link = screen.getByText('Comptabilité').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link?.className).toMatch(/border-l-ipd/);
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
