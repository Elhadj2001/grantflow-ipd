import { render, screen } from '@testing-library/react';

// Mocks server-only utilities — la page est un server component qui
// utilise `auth()` (next-auth) et `redirect()` (next/navigation).
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/auth', () => ({ auth: jest.fn().mockResolvedValue(null) }));

// LoginButton est un client component qui appelle signIn — on le
// remplace par un stub pour ne pas tirer next-auth/react dans jsdom.
jest.mock('../login-button', () => ({
  LoginButton: ({ callbackUrl }: { callbackUrl: string }) => (
    <button data-testid="login-btn" data-callback={callbackUrl}>
      Se connecter avec Keycloak
    </button>
  ),
}));

import LoginPage from '../page';

async function renderAsync(jsx: Promise<JSX.Element>) {
  const element = await jsx;
  return render(element);
}

describe('LoginPage (refonte sprint-F1.1)', () => {
  it('renders aside heading + IPD branding', async () => {
    await renderAsync(LoginPage({ searchParams: {} }));
    expect(screen.getByRole('heading', { level: 1, name: 'GRANTFLOW IPD' })).toBeInTheDocument();
    // Le placeholder texte "IPD" a été remplacé par l'image du logo IPD
    // (commit "feat(web): logo IPD (sidebar + login)"). On vérifie désormais
    // la présence du logo via son alt accessible.
    expect(screen.getByAltText('Institut Pasteur de Dakar')).toBeInTheDocument();
    // "Institut Pasteur de Dakar" apparaît aussi dans le badge aside + le footer copyright
    const matches = screen.getAllByText(/Institut Pasteur de Dakar/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the 4 feature bullets in aside', async () => {
    await renderAsync(LoginPage({ searchParams: {} }));
    expect(screen.getByText(/Cycle complet DA → BC → Facture → Paiement/)).toBeInTheDocument();
    expect(screen.getByText(/Conformité SYSCEBNL/)).toBeInTheDocument();
    expect(screen.getByText(/Multi-bailleurs, multi-devises/)).toBeInTheDocument();
    expect(screen.getByText(/Reporting bailleur automatisé/)).toBeInTheDocument();
  });

  it('renders connexion card with login button', async () => {
    await renderAsync(LoginPage({ searchParams: {} }));
    expect(screen.getByRole('heading', { level: 2, name: 'Connexion' })).toBeInTheDocument();
    const btn = screen.getByTestId('login-btn');
    expect(btn).toHaveAttribute('data-callback', '/dashboard');
  });

  it('propagates callbackUrl from searchParams to LoginButton', async () => {
    await renderAsync(LoginPage({ searchParams: { callbackUrl: '/reports' } }));
    expect(screen.getByTestId('login-btn')).toHaveAttribute('data-callback', '/reports');
  });

  it('shows error alert when searchParams.error is set', async () => {
    await renderAsync(LoginPage({ searchParams: { error: 'OAuthCallback' } }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/OAuthCallback/);
  });

  it('renders role preview badges (DAF, Comptable, Demandeur)', async () => {
    await renderAsync(LoginPage({ searchParams: {} }));
    expect(screen.getByText('DAF')).toBeInTheDocument();
    expect(screen.getByText('Comptable')).toBeInTheDocument();
    expect(screen.getByText('Demandeur')).toBeInTheDocument();
    expect(screen.getByText(/\+ 8 rôles/)).toBeInTheDocument();
  });

  it('renders footer secondary nav', async () => {
    await renderAsync(LoginPage({ searchParams: {} }));
    expect(screen.getByRole('link', { name: 'Accueil' })).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Politique RGPD')).toBeInTheDocument();
  });
});
