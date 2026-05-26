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
  it('renders the navigation entries (SUPER_ADMIN voit tout : F5b-b + F5b-c)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    [
      'Dashboard',
      'Achats',
      'Comptabilité',
      'Clôture',
      'Trésorerie',
      'Pilotage',
      'Reporting',
      'États financiers',
      'Fournisseurs',
    ].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
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

  it('Reporting activé en F5a — lien vers /reporting', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const reporting = screen.getByText('Reporting').closest('a');
    expect(reporting).not.toBeNull();
    expect(reporting).toHaveAttribute('href', '/reporting');
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

  it('Reporting visible pour CONTROLEUR (sprint F5a)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('Reporting')).toBeInTheDocument();
  });

  it('Reporting visible pour BAILLEUR (sprint F5a, lecture seule)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['BAILLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('Reporting')).toBeInTheDocument();
  });

  it('Reporting masqué pour COMPTABLE seul', () => {
    mockPathname = '/dashboard';
    mockRoles = ['COMPTABLE'];
    render(<AppSidebar />);
    expect(screen.queryByText('Reporting')).toBeNull();
  });

  // -----------------------------------------------------------------
  // Sprint F5b-b — Clôture mensuelle + États financiers
  // -----------------------------------------------------------------

  it('Clôture visible pour COMPTABLE (sprint F5b-b)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['COMPTABLE'];
    render(<AppSidebar />);
    const link = screen.getByText('Clôture').closest('a');
    expect(link).toHaveAttribute('href', '/accounting/periods');
  });

  it('Clôture visible pour CONTROLEUR et DAF', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('Clôture')).toBeInTheDocument();
  });

  it('Clôture masquée pour BAILLEUR (workflow interne uniquement)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['BAILLEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Clôture')).toBeNull();
  });

  it('Clôture masquée pour DEMANDEUR', () => {
    mockPathname = '/dashboard';
    mockRoles = ['DEMANDEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Clôture')).toBeNull();
  });

  it('États financiers visible pour COMPTABLE (peut générer)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['COMPTABLE'];
    render(<AppSidebar />);
    const link = screen.getByText('États financiers').closest('a');
    expect(link).toHaveAttribute('href', '/reporting/statements');
  });

  it('États financiers visible pour BAILLEUR (consultation locked-only via backend)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['BAILLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('États financiers')).toBeInTheDocument();
  });

  it('États financiers masqué pour PI', () => {
    mockPathname = '/dashboard';
    mockRoles = ['PI'];
    render(<AppSidebar />);
    expect(screen.queryByText('États financiers')).toBeNull();
  });

  it('match actif fin : sur /accounting/periods → Clôture active, Comptabilité PAS active', () => {
    mockPathname = '/accounting/periods/abc';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const cloture = screen.getByText('Clôture').closest('a');
    const compta = screen.getByText('Comptabilité').closest('a');
    expect(cloture).toHaveAttribute('aria-current', 'page');
    expect(compta).not.toHaveAttribute('aria-current', 'page');
  });

  it('match actif fin : sur /reporting/statements → États fin active, Reporting PAS active', () => {
    mockPathname = '/reporting/statements/xyz';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const etats = screen.getByText('États financiers').closest('a');
    const reporting = screen.getByText('Reporting').closest('a');
    expect(etats).toHaveAttribute('aria-current', 'page');
    expect(reporting).not.toHaveAttribute('aria-current', 'page');
  });

  it('match actif : sur /reporting/donor-reports → Reporting active (matchPrefixes ok)', () => {
    mockPathname = '/reporting/donor-reports/abc';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const reporting = screen.getByText('Reporting').closest('a');
    expect(reporting).toHaveAttribute('aria-current', 'page');
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

  // -----------------------------------------------------------------
  // Sprint F5b-c — Fournisseurs (référentiel)
  // -----------------------------------------------------------------

  it('Fournisseurs visible pour ACHETEUR (sprint F5b-c) — sourcing', () => {
    mockPathname = '/dashboard';
    mockRoles = ['ACHETEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Fournisseurs').closest('a');
    expect(link).toHaveAttribute('href', '/referential/suppliers');
  });

  it('Fournisseurs visible pour CONTROLEUR et DAF', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    expect(screen.getByText('Fournisseurs')).toBeInTheDocument();
  });

  it('Fournisseurs masqué pour BAILLEUR / COMPTABLE / PI', () => {
    for (const r of ['BAILLEUR', 'COMPTABLE', 'PI'] as const) {
      mockPathname = '/dashboard';
      mockRoles = [r];
      const { unmount } = render(<AppSidebar />);
      expect(screen.queryByText('Fournisseurs')).toBeNull();
      unmount();
    }
  });

  it('match actif : sur /referential/suppliers → Fournisseurs active', () => {
    mockPathname = '/referential/suppliers';
    mockRoles = ['ACHETEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Fournisseurs').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  // -----------------------------------------------------------------
  // Sprint F-ADMIN-USERS — Administration des utilisateurs
  // -----------------------------------------------------------------

  it('Utilisateurs visible pour SUPER_ADMIN → /admin/users', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const link = screen.getByText('Utilisateurs').closest('a');
    expect(link).toHaveAttribute('href', '/admin/users');
  });

  it('Utilisateurs visible pour DAF', () => {
    mockPathname = '/dashboard';
    mockRoles = ['DAF'];
    render(<AppSidebar />);
    expect(screen.getByText('Utilisateurs')).toBeInTheDocument();
  });

  it('Utilisateurs masqué pour CONTROLEUR (gestion comptes = SA/DAF uniquement)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Utilisateurs')).toBeNull();
  });

  it.each<[GrantflowRole]>([
    ['COMPTABLE'],
    ['TRESORIER'],
    ['ACHETEUR'],
    ['MAGASINIER'],
    ['PI'],
    ['DEMANDEUR'],
    ['BAILLEUR'],
    ['CAISSIER'],
  ])('Utilisateurs masqué pour %s', (role) => {
    mockPathname = '/dashboard';
    mockRoles = [role];
    render(<AppSidebar />);
    expect(screen.queryByText('Utilisateurs')).toBeNull();
  });

  it('match actif : sur /admin/users → Utilisateurs active', () => {
    mockPathname = '/admin/users';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const link = screen.getByText('Utilisateurs').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link?.className).toMatch(/border-l-ipd/);
  });
});
