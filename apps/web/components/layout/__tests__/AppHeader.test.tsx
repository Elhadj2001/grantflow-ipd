import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from 'next-auth';
import { AppHeader } from '../AppHeader';

// Sprint F-LOGOUT : le bouton "Se déconnecter" redirige désormais vers
// /api/auth/federated-logout (logout fédéré OIDC) au lieu d'appeler
// signOut() directement. On stube le setter de window.location.href pour
// vérifier la cible de redirection.
const locationHrefSetter = jest.fn();
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new Proxy(
      {} as Location,
      {
        set(_target, prop, value: string) {
          if (prop === 'href') {
            locationHrefSetter(value);
            return true;
          }
          return true;
        },
        get(_target, prop) {
          if (prop === 'href') return '';
          return undefined;
        },
      },
    ),
  });
});

const fakeSession: Session = {
  expires: '2099-01-01',
  fullName: 'Amadou Niang',
  roles: ['DAF'],
  // Sprint F-ADMIN-USERS : userId (= Keycloak sub) requis dans Session.
  userId: 'kc-sub-fake',
  user: { name: 'Amadou Niang', email: 'amadou@pasteur.sn' },
};

describe('AppHeader', () => {
  beforeEach(() => locationHrefSetter.mockReset());

  it('renders logo + fullName', () => {
    render(<AppHeader session={fakeSession} />);
    expect(screen.getByText('IPD GRANTFLOW')).toBeInTheDocument();
    expect(screen.getByText('Amadou Niang')).toBeInTheDocument();
  });

  it('renders initials avatar (AN)', () => {
    render(<AppHeader session={fakeSession} />);
    // 2 initiales "AN"
    expect(screen.getByText('AN')).toBeInTheDocument();
  });

  it('falls back on email when no fullName', () => {
    render(
      <AppHeader
        session={{ ...fakeSession, fullName: '', user: { email: 'x@pasteur.sn' } }}
      />,
    );
    expect(screen.getByText('x@pasteur.sn')).toBeInTheDocument();
  });

  it('renders the primary role badge (DAF)', () => {
    render(<AppHeader session={fakeSession} />);
    const badge = screen.getByTestId('role-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('DAF');
    expect(badge.className).toMatch(/bg-ipd-dark/);
  });

  it('picks SUPER_ADMIN over DAF when both are present', () => {
    render(<AppHeader session={{ ...fakeSession, roles: ['DAF', 'SUPER_ADMIN'] }} />);
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Admin');
  });

  it('shows no badge when roles is empty', () => {
    render(<AppHeader session={{ ...fakeSession, roles: [] }} />);
    expect(screen.queryByTestId('role-badge')).toBeNull();
  });

  it('redirects to /api/auth/federated-logout when the logout item is clicked', async () => {
    const user = userEvent.setup();
    render(<AppHeader session={fakeSession} />);
    await user.click(screen.getByLabelText('Menu utilisateur'));
    // Radix Dropdown rend dans un portal, le menuitem apparaît asynchrone
    const logout = await waitFor(() => screen.getByText('Se déconnecter'));
    await user.click(logout);
    // Sprint F-LOGOUT : logout fédéré OIDC via route handler — tue à la fois
    // la session next-auth ET la session Keycloak (RP-Initiated Logout).
    expect(locationHrefSetter).toHaveBeenCalledWith('/api/auth/federated-logout');
  });
});
