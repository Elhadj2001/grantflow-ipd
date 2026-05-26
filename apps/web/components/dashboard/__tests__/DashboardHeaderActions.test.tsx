/**
 * Sprint F-DASHBOARD — tests RTL pour les actions du header dashboard.
 *
 * "Exporter" a été supprimé (pas de cible globale claire). Seul reste
 * "Nouvelle DA", visible uniquement si `canCreatePR()`. Pour les rôles
 * non autorisés, le composant doit retourner null (pas de bouton désactivé).
 */

import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';

let mockRoles: GrantflowRole[] = ['DEMANDEUR'];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

import { DashboardHeaderActions } from '../DashboardHeaderActions';

describe('DashboardHeaderActions', () => {
  it('DEMANDEUR : bouton "Nouvelle DA" visible avec lien vers la création', () => {
    mockRoles = ['DEMANDEUR'];
    render(<DashboardHeaderActions />);
    const link = screen.getByRole('link', { name: /Nouvelle DA/i });
    expect(link).toHaveAttribute('href', '/procurement/purchase-requests/new');
  });

  it('PI : bouton "Nouvelle DA" visible', () => {
    mockRoles = ['PI'];
    render(<DashboardHeaderActions />);
    expect(screen.getByRole('link', { name: /Nouvelle DA/i })).toBeInTheDocument();
  });

  it('SUPER_ADMIN : bouton "Nouvelle DA" visible', () => {
    mockRoles = ['SUPER_ADMIN'];
    render(<DashboardHeaderActions />);
    expect(screen.getByRole('link', { name: /Nouvelle DA/i })).toBeInTheDocument();
  });

  it('BAILLEUR : aucun bouton (composant retourne null, pas de bouton désactivé)', () => {
    mockRoles = ['BAILLEUR'];
    const { container } = render(<DashboardHeaderActions />);
    expect(container.firstChild).toBeNull();
  });

  it('MAGASINIER : aucun bouton (ne peut pas créer de DA)', () => {
    mockRoles = ['MAGASINIER'];
    const { container } = render(<DashboardHeaderActions />);
    expect(container.firstChild).toBeNull();
  });

  it('ACHETEUR : aucun bouton (ACHETEUR gère les BC, pas les DA)', () => {
    mockRoles = ['ACHETEUR'];
    const { container } = render(<DashboardHeaderActions />);
    expect(container.firstChild).toBeNull();
  });

  it('Le bouton porte le testid data-testid="dashboard-new-pr"', () => {
    mockRoles = ['DEMANDEUR'];
    render(<DashboardHeaderActions />);
    expect(screen.getByTestId('dashboard-new-pr')).toBeInTheDocument();
  });
});
