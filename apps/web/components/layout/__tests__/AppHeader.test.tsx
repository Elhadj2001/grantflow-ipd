import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from 'next-auth';
import { AppHeader } from '../AppHeader';

const mockSignOut = jest.fn();
jest.mock('next-auth/react', () => ({
  signOut: (args: unknown) => mockSignOut(args),
}));

const fakeSession: Session = {
  expires: '2099-01-01',
  fullName: 'Amadou Niang',
  roles: ['DAF'],
  user: { name: 'Amadou Niang', email: 'amadou@pasteur.sn' },
};

describe('AppHeader', () => {
  beforeEach(() => mockSignOut.mockReset());

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

  it('calls signOut when the logout item is clicked', async () => {
    const user = userEvent.setup();
    render(<AppHeader session={fakeSession} />);
    await user.click(screen.getByLabelText('Menu utilisateur'));
    // Radix Dropdown rend dans un portal, le menuitem apparaît asynchrone
    const logout = await waitFor(() => screen.getByText('Se déconnecter'));
    await user.click(logout);
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});
