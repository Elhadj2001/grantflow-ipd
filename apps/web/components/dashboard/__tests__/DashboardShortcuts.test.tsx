/**
 * Sprint F-DASHBOARD — tests RTL pour la grille de raccourcis.
 *
 * On vérifie le gating par rôle :
 *   - DEMANDEUR voit "Créer une DA" actif, les 3 autres désactivés.
 *   - SUPER_ADMIN voit tout actif.
 *   - BAILLEUR voit "Rapport bailleur" actif, le reste désactivé.
 */

import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';

let mockRoles: GrantflowRole[] = ['SUPER_ADMIN'];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

import { DashboardShortcuts } from '../DashboardShortcuts';

/** Récupère la carte du raccourci dont le titre est passé en arg. */
function cardOf(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title, level: 3 }).closest(
    '[data-testid="shortcut-card"]',
  ) as HTMLElement;
}

describe('DashboardShortcuts', () => {
  it('SUPER_ADMIN : 4 raccourcis tous actifs et avec href', () => {
    mockRoles = ['SUPER_ADMIN'];
    render(<DashboardShortcuts />);
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Créer une DA')).toHaveAttribute(
      'data-href',
      '/procurement/purchase-requests/new',
    );
    expect(cardOf('Suivre factures')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Suivre factures')).toHaveAttribute('data-href', '/accounting/invoices');
    expect(cardOf('Lancer un paiement')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Lancer un paiement')).toHaveAttribute(
      'data-href',
      '/treasury/payment-runs/new',
    );
    expect(cardOf('Rapport bailleur')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Rapport bailleur')).toHaveAttribute(
      'data-href',
      '/reporting/donor-reports',
    );
  });

  it('DEMANDEUR : "Créer une DA" + "Suivre factures" actifs ; paiement et rapport bailleur OFF', () => {
    // canViewInvoice est large (inclut DEMANDEUR — visibilité partielle filtrée
    // côté serveur). Ce qui est gating réel pour ce rôle : pas de payment run,
    // pas de reporting bailleur.
    mockRoles = ['DEMANDEUR'];
    render(<DashboardShortcuts />);
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Suivre factures')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Lancer un paiement')).toHaveAttribute('data-disabled', 'true');
    expect(cardOf('Rapport bailleur')).toHaveAttribute('data-disabled', 'true');
  });

  it('TRESORIER : "Lancer un paiement" actif, "Créer une DA" désactivé', () => {
    mockRoles = ['TRESORIER'];
    render(<DashboardShortcuts />);
    expect(cardOf('Lancer un paiement')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'true');
  });

  it('BAILLEUR : "Rapport bailleur" actif ; "Créer une DA" et "Lancer un paiement" OFF', () => {
    // BAILLEUR a canViewInvoice (lecture seule filtrée serveur) et canViewReporting,
    // mais ni canCreatePR ni canCreatePaymentRun.
    mockRoles = ['BAILLEUR'];
    render(<DashboardShortcuts />);
    expect(cardOf('Rapport bailleur')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'true');
    expect(cardOf('Lancer un paiement')).toHaveAttribute('data-disabled', 'true');
  });

  it('MAGASINIER : tous les raccourcis du dashboard désactivés (workflow strictement réception)', () => {
    mockRoles = ['MAGASINIER'];
    render(<DashboardShortcuts />);
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'true');
    expect(cardOf('Lancer un paiement')).toHaveAttribute('data-disabled', 'true');
    expect(cardOf('Rapport bailleur')).toHaveAttribute('data-disabled', 'true');
    // canViewInvoice : MAGASINIER n'est PAS dans la liste → désactivé
    expect(cardOf('Suivre factures')).toHaveAttribute('data-disabled', 'true');
  });

  it('COMPTABLE : "Suivre factures" actif (canViewInvoice), "Créer une DA" désactivé', () => {
    mockRoles = ['COMPTABLE'];
    render(<DashboardShortcuts />);
    expect(cardOf('Suivre factures')).toHaveAttribute('data-disabled', 'false');
    expect(cardOf('Créer une DA')).toHaveAttribute('data-disabled', 'true');
  });
});
