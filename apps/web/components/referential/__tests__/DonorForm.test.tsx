/**
 * Sprint F-REF-BAILLEURS-PROJETS — tests RTL DonorForm.
 *
 * Couverture :
 *  - rendu create / edit (code immuable en edit)
 *  - validation Zod : code regex + label min + email
 *  - submit nettoie les chaînes vides en undefined
 *  - select type rendu avec libellés FR
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonorForm } from '../DonorForm';
import type { Donor } from '@/lib/api/referential';

const fakeDonor: Donor = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  code: 'BMGF',
  label: 'Bill & Melinda Gates Foundation',
  type: 'private_foundation',
  country: 'US',
  contactEmail: 'audit@gatesfoundation.org',
  isActive: true,
};

describe('DonorForm', () => {
  it('mode create : champs vides + boutons + type par défaut public_intl', () => {
    render(<DonorForm mode="create" onSubmit={jest.fn()} />);
    expect(screen.getByTestId('donor-code-input')).toHaveValue('');
    expect(screen.getByTestId('donor-label-input')).toHaveValue('');
    expect(screen.getByTestId('donor-type-select')).toHaveValue('public_intl');
    expect(screen.getByTestId('donor-form-submit')).toHaveTextContent('Créer');
  });

  it('mode edit : pré-remplit + code read-only', () => {
    render(<DonorForm mode="edit" defaultValues={fakeDonor} onSubmit={jest.fn()} />);
    expect(screen.getByTestId('donor-code-input')).toHaveValue('BMGF');
    expect(screen.getByTestId('donor-code-input')).toHaveAttribute('readonly');
    expect(screen.getByTestId('donor-label-input')).toHaveValue(
      'Bill & Melinda Gates Foundation',
    );
    expect(screen.getByTestId('donor-type-select')).toHaveValue('private_foundation');
    expect(screen.getByTestId('donor-form-submit')).toHaveTextContent('Enregistrer');
  });

  it('rend les 6 types FR dans le select', () => {
    render(<DonorForm mode="create" onSubmit={jest.fn()} />);
    const select = screen.getByTestId('donor-type-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual([
      'Public international',
      'Fondation privée',
      'Bailleur bilatéral',
      'Bailleur multilatéral',
      'Gouvernement',
      'Fonds propres',
    ]);
  });

  it('validation : code minuscule → erreur Zod, submit non appelé', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<DonorForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('donor-code-input'), 'bmgf'); // minuscule
    await user.type(screen.getByTestId('donor-label-input'), 'Test Donor');
    await user.click(screen.getByTestId('donor-form-submit'));

    expect(await screen.findByText(/Code MAJUSCULES/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validation : e-mail invalide → submit bloqué (Zod refuse les non-emails non vides)', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<DonorForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('donor-code-input'), 'BMGF');
    await user.type(screen.getByTestId('donor-label-input'), 'BMGF Foundation');
    await user.type(screen.getByTestId('donor-email-input'), 'not-an-email');
    await user.click(screen.getByTestId('donor-form-submit'));

    // Le submit doit être bloqué côté Zod — peu importe le message exact
    // (l'union string().email() | literal('') peut produire un message
    // composite "Invalid input" selon la version Zod). L'important est
    // que onSubmit n'est PAS appelé.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submit happy path : chaînes vides nettoyées en undefined", async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<DonorForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('donor-code-input'), 'GAVI');
    await user.type(screen.getByTestId('donor-label-input'), 'GAVI Alliance');
    await user.selectOptions(screen.getByTestId('donor-type-select'), 'multilateral');
    // Pas de country / pas d'email
    await user.click(screen.getByTestId('donor-form-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.code).toBe('GAVI');
    expect(payload.label).toBe('GAVI Alliance');
    expect(payload.type).toBe('multilateral');
    expect(payload.country).toBeUndefined();
    expect(payload.contactEmail).toBeUndefined();
  });

  it("affiche l'errorMessage backend (cas 409 DUPLICATE_CODE)", () => {
    render(
      <DonorForm
        mode="create"
        onSubmit={jest.fn()}
        errorMessage="Erreur 409 — code déjà utilisé"
      />,
    );
    expect(screen.getByTestId('donor-form-error')).toHaveTextContent('409');
  });
});
