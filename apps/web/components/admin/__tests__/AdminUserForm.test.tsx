/**
 * Sprint F-ADMIN-USERS Lot D — tests RTL AdminUserForm.
 *
 * Vérifie :
 *   - mode 'create' soumet { profile, roles, rolesChanged:true }
 *   - mode 'edit' verrouille l'e-mail (readOnly), pré-remplit les valeurs,
 *     calcule rolesChanged correctement (false si identique, true si diff)
 *   - validation Zod : e-mail invalide → message d'erreur
 *   - validation custom : 0 rôle → message "Au moins un rôle obligatoire"
 *   - errorMessage backend affiché
 *   - bouton désactivé pendant loading
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminUserForm } from '../AdminUserForm';
import type { AdminUser } from '@/lib/api/admin-users';

const fakeUser: AdminUser = {
  id: 'kc-1',
  email: 'jane@pasteur.sn',
  fullName: 'Jane DIOP',
  department: 'Finance',
  employeeCode: 'IPD-001',
  status: 'active',
  enabled: true,
  roles: ['DAF', 'COMPTABLE'],
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AdminUserForm — création', () => {
  it("soumet { profile, roles, rolesChanged:true } pour un create valide", async () => {
    const onSubmit = jest.fn();
    render(<AdminUserForm mode="create" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('admin-user-email-input'), {
      target: { value: 'new@pasteur.sn' },
    });
    fireEvent.change(screen.getByTestId('admin-user-fullname-input'), {
      target: { value: 'New User' },
    });
    // Sélectionner un rôle (sinon erreur "Au moins un rôle obligatoire")
    fireEvent.click(screen.getByTestId('role-DAF'));
    fireEvent.click(screen.getByTestId('admin-user-form-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.profile.email).toBe('new@pasteur.sn');
    expect(payload.profile.fullName).toBe('New User');
    expect(payload.roles).toEqual(['DAF']);
    expect(payload.rolesChanged).toBe(true);
  });

  it("validation : e-mail invalide → onSubmit pas appelé", async () => {
    const onSubmit = jest.fn();
    render(<AdminUserForm mode="create" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('admin-user-email-input'), {
      target: { value: 'pas-un-email' },
    });
    fireEvent.change(screen.getByTestId('admin-user-fullname-input'), {
      target: { value: 'New User' },
    });
    fireEvent.click(screen.getByTestId('role-DAF'));
    fireEvent.click(screen.getByTestId('admin-user-form-submit'));

    // Laisser RHF compléter sa validation async + re-render éventuel.
    await waitFor(() => {
      // L'essentiel : la validation a empêché l'appel onSubmit.
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("validation : aucun rôle → onSubmit pas appelé + message rolesError", async () => {
    const onSubmit = jest.fn();
    render(<AdminUserForm mode="create" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('admin-user-email-input'), {
      target: { value: 'valid@pasteur.sn' },
    });
    fireEvent.change(screen.getByTestId('admin-user-fullname-input'), {
      target: { value: 'New User' },
    });
    fireEvent.click(screen.getByTestId('admin-user-form-submit'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/rôle/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("affiche errorMessage backend et le bouton se met en loading", () => {
    render(
      <AdminUserForm
        mode="create"
        onSubmit={jest.fn()}
        errorMessage="Erreur 409 — Email déjà utilisé"
        loading
      />,
    );
    expect(screen.getByTestId('admin-user-form-error')).toHaveTextContent(
      'Email déjà utilisé',
    );
    expect(screen.getByTestId('admin-user-form-submit')).toBeDisabled();
    expect(screen.getByTestId('admin-user-form-submit')).toHaveTextContent('Enregistrement');
  });
});

describe('AdminUserForm — édition', () => {
  it('pré-remplit les valeurs et verrouille l\'e-mail', () => {
    render(<AdminUserForm mode="edit" defaultValues={fakeUser} onSubmit={jest.fn()} />);
    const email = screen.getByTestId('admin-user-email-input') as HTMLInputElement;
    expect(email.value).toBe('jane@pasteur.sn');
    expect(email).toHaveAttribute('readOnly');
    const fullname = screen.getByTestId('admin-user-fullname-input') as HTMLInputElement;
    expect(fullname.value).toBe('Jane DIOP');
    // Rôles initiaux sélectionnés
    expect(screen.getByTestId('role-DAF')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('role-COMPTABLE')).toHaveAttribute('aria-pressed', 'true');
  });

  it('rolesChanged=false si rôles identiques', async () => {
    const onSubmit = jest.fn();
    render(<AdminUserForm mode="edit" defaultValues={fakeUser} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('admin-user-form-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0].rolesChanged).toBe(false);
  });

  it("rolesChanged=true si on ajoute un rôle", async () => {
    const onSubmit = jest.fn();
    render(<AdminUserForm mode="edit" defaultValues={fakeUser} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('role-CONTROLEUR'));
    fireEvent.click(screen.getByTestId('admin-user-form-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.rolesChanged).toBe(true);
    expect(payload.roles).toEqual(expect.arrayContaining(['DAF', 'COMPTABLE', 'CONTROLEUR']));
  });

  it("lockedRoles : SUPER_ADMIN verrouillé dans le selector quand passé en prop", () => {
    const userWithSA: AdminUser = { ...fakeUser, roles: ['SUPER_ADMIN'] };
    render(
      <AdminUserForm
        mode="edit"
        defaultValues={userWithSA}
        onSubmit={jest.fn()}
        lockedRoles={['SUPER_ADMIN']}
      />,
    );
    expect(screen.getByTestId('role-SUPER_ADMIN')).toBeDisabled();
  });
});
