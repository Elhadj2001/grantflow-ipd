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
  it('renders the navigation entries (SUPER_ADMIN voit tout : F5b-b + F5b-c + F-ADMIN-USERS + F-REF)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    [
      'Dashboard',
      'Achats',
      'Réception',
      'Inventaire / Scan',
      'Comptabilité',
      'Clôture',
      'Trésorerie',
      'Pilotage',
      'Reporting',
      'États financiers',
      'Fournisseurs',
      'Bailleurs',
      'Projets',
      'Utilisateurs',
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
    expect(dashboardLink?.className).toMatch(/shadow-actif/);
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
    expect(link?.className).toMatch(/shadow-actif/);
  });

  it('marks Comptabilité active when on a /accounting/* path (sprint F3)', () => {
    mockPathname = '/accounting/invoices/abc';
    render(<AppSidebar />);
    const link = screen.getByText('Comptabilité').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link?.className).toMatch(/shadow-actif/);
  });

  it('marks Achats active when on a /procurement/* path', () => {
    mockPathname = '/procurement/purchase-requests/abc';
    render(<AppSidebar />);
    const achatsLink = screen.getByText('Achats').closest('a');
    expect(achatsLink).toHaveAttribute('aria-current', 'page');
    expect(achatsLink?.className).toMatch(/shadow-actif/);
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
  // Sprint F-DASHBOARD — Réception + Inventaire/Scan (canReceive)
  // -----------------------------------------------------------------

  it('Réception visible pour MAGASINIER → /procurement/reception-rapide', () => {
    mockPathname = '/dashboard';
    mockRoles = ['MAGASINIER'];
    render(<AppSidebar />);
    const link = screen.getByText('Réception').closest('a');
    expect(link).toHaveAttribute('href', '/procurement/reception-rapide');
  });

  it('Inventaire / Scan visible pour MAGASINIER → /procurement/inventaire-scan', () => {
    mockPathname = '/dashboard';
    mockRoles = ['MAGASINIER'];
    render(<AppSidebar />);
    const link = screen.getByText('Inventaire / Scan').closest('a');
    expect(link).toHaveAttribute('href', '/procurement/inventaire-scan');
  });

  it('Réception + Inventaire visibles pour SUPER_ADMIN', () => {
    mockPathname = '/dashboard';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    expect(screen.getByText('Réception')).toBeInTheDocument();
    expect(screen.getByText('Inventaire / Scan')).toBeInTheDocument();
  });

  it('Réception + Inventaire masqués pour DEMANDEUR (pas canReceive)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['DEMANDEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Réception')).toBeNull();
    expect(screen.queryByText('Inventaire / Scan')).toBeNull();
  });

  it('Réception + Inventaire masqués pour BAILLEUR (pas canReceive)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['BAILLEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Réception')).toBeNull();
    expect(screen.queryByText('Inventaire / Scan')).toBeNull();
  });

  it('Réception + Inventaire masqués pour ACHETEUR (acheteur ≠ réceptionneur)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['ACHETEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Réception')).toBeNull();
    expect(screen.queryByText('Inventaire / Scan')).toBeNull();
  });

  it('match actif fin : sur /procurement/reception-rapide → Réception active, Achats PAS active', () => {
    mockPathname = '/procurement/reception-rapide';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const reception = screen.getByText('Réception').closest('a');
    const achats = screen.getByText('Achats').closest('a');
    expect(reception).toHaveAttribute('aria-current', 'page');
    expect(achats).not.toHaveAttribute('aria-current', 'page');
  });

  it('match actif fin : sur /procurement/inventaire-scan → Inventaire active, Achats PAS active', () => {
    mockPathname = '/procurement/inventaire-scan';
    mockRoles = ['SUPER_ADMIN'];
    render(<AppSidebar />);
    const inv = screen.getByText('Inventaire / Scan').closest('a');
    const achats = screen.getByText('Achats').closest('a');
    expect(inv).toHaveAttribute('aria-current', 'page');
    expect(achats).not.toHaveAttribute('aria-current', 'page');
  });

  // Note : le test "F5b-c PAS encore mergé / Fournisseurs ABSENT" de la
  // branche sprint-F-dashboard est volontairement supprimé : F5b-c est
  // désormais sur main, l'entrée Fournisseurs DOIT être visible (testée
  // dans le bloc "Sprint F5b-c" ci-dessus).

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
    expect(link?.className).toMatch(/shadow-actif/);
  });

  // -----------------------------------------------------------------
  // Sprint F-REF-BAILLEURS-PROJETS — Bailleurs + Projets (référentiel)
  // -----------------------------------------------------------------

  it('Bailleurs visible pour CONTROLEUR → /referential/donors', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Bailleurs').closest('a');
    expect(link).toHaveAttribute('href', '/referential/donors');
  });

  it('Bailleurs visible pour DAF et SUPER_ADMIN', () => {
    for (const role of ['DAF', 'SUPER_ADMIN'] as const) {
      mockPathname = '/dashboard';
      mockRoles = [role];
      const { unmount } = render(<AppSidebar />);
      expect(screen.getByText('Bailleurs')).toBeInTheDocument();
      unmount();
    }
  });

  it('Bailleurs masqué pour ACHETEUR (peut gérer fournisseurs mais pas bailleurs)', () => {
    mockPathname = '/dashboard';
    mockRoles = ['ACHETEUR'];
    render(<AppSidebar />);
    expect(screen.queryByText('Bailleurs')).toBeNull();
  });

  it.each<[GrantflowRole]>([
    ['COMPTABLE'],
    ['TRESORIER'],
    ['MAGASINIER'],
    ['PI'],
    ['DEMANDEUR'],
    ['BAILLEUR'],
    ['CAISSIER'],
  ])('Bailleurs masqué pour %s', (role) => {
    mockPathname = '/dashboard';
    mockRoles = [role];
    render(<AppSidebar />);
    expect(screen.queryByText('Bailleurs')).toBeNull();
  });

  it('match actif fin : sur /referential/donors → Bailleurs active', () => {
    mockPathname = '/referential/donors';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Bailleurs').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('Projets visible pour CONTROLEUR → /referential/projects', () => {
    mockPathname = '/dashboard';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Projets').closest('a');
    expect(link).toHaveAttribute('href', '/referential/projects');
  });

  it('Projets visible pour DAF et SUPER_ADMIN', () => {
    for (const role of ['DAF', 'SUPER_ADMIN'] as const) {
      mockPathname = '/dashboard';
      mockRoles = [role];
      const { unmount } = render(<AppSidebar />);
      expect(screen.getByText('Projets')).toBeInTheDocument();
      unmount();
    }
  });

  it.each<[GrantflowRole]>([
    ['COMPTABLE'],
    ['ACHETEUR'],
    ['TRESORIER'],
    ['MAGASINIER'],
    ['PI'],
    ['DEMANDEUR'],
    ['BAILLEUR'],
    ['CAISSIER'],
  ])('Projets masqué pour %s', (role) => {
    mockPathname = '/dashboard';
    mockRoles = [role];
    render(<AppSidebar />);
    expect(screen.queryByText('Projets')).toBeNull();
  });

  it('match actif fin : sur /referential/projects → Projets active', () => {
    mockPathname = '/referential/projects';
    mockRoles = ['CONTROLEUR'];
    render(<AppSidebar />);
    const link = screen.getByText('Projets').closest('a');
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});
