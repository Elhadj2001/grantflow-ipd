/**
 * Sprint F-REF-BAILLEURS-PROJETS — tests RTL ProjectForm.
 *
 * Couverture :
 *  - rendu create / edit (code immuable en edit)
 *  - validation Zod : code regex + title min 5 + dates ISO + endDate > startDate
 *  - 3 statuts FR (Actif / Suspendu / Clos)
 *  - submit nettoie les chaînes vides (en create → undefined ; en edit → null)
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectForm } from '../ProjectForm';
import type { Project } from '@/lib/api/referential';

const fakeProject: Project = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  code: 'MADIBA-VAC-2026',
  title: 'Madiba Vaccine Platform 2026-2029',
  programId: null,
  piUserId: null,
  startDate: '2026-01-01',
  endDate: '2029-12-31',
  status: 'active',
  description: 'Multi-vaccine pipeline',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ProjectForm', () => {
  it('mode create : champs vides + statut par défaut active', () => {
    render(<ProjectForm mode="create" onSubmit={jest.fn()} />);
    expect(screen.getByTestId('project-code-input')).toHaveValue('');
    expect(screen.getByTestId('project-title-input')).toHaveValue('');
    expect(screen.getByTestId('project-status-select')).toHaveValue('active');
    expect(screen.getByTestId('project-form-submit')).toHaveTextContent('Créer');
  });

  it('mode edit : pré-remplit + code read-only + dates ISO', () => {
    render(<ProjectForm mode="edit" defaultValues={fakeProject} onSubmit={jest.fn()} />);
    expect(screen.getByTestId('project-code-input')).toHaveValue('MADIBA-VAC-2026');
    expect(screen.getByTestId('project-code-input')).toHaveAttribute('readonly');
    expect(screen.getByTestId('project-title-input')).toHaveValue(
      'Madiba Vaccine Platform 2026-2029',
    );
    expect(screen.getByTestId('project-startdate-input')).toHaveValue('2026-01-01');
    expect(screen.getByTestId('project-enddate-input')).toHaveValue('2029-12-31');
    expect(screen.getByTestId('project-status-select')).toHaveValue('active');
    expect(screen.getByTestId('project-form-submit')).toHaveTextContent('Enregistrer');
  });

  it('rend les 3 statuts FR dans le select', () => {
    render(<ProjectForm mode="create" onSubmit={jest.fn()} />);
    const select = screen.getByTestId('project-status-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Actif', 'Suspendu', 'Clos']);
  });

  it('validation : code minuscule → erreur, submit non appelé', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProjectForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('project-code-input'), 'madiba-vac');
    await user.type(screen.getByTestId('project-title-input'), 'A valid title here');
    await user.type(screen.getByTestId('project-startdate-input'), '2026-01-01');
    await user.click(screen.getByTestId('project-form-submit'));

    expect(await screen.findByText(/Code MAJUSCULES/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validation : endDate < startDate → erreur ciblée', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProjectForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('project-code-input'), 'PALU-2026');
    await user.type(screen.getByTestId('project-title-input'), 'Paludisme Dakar 2026');
    await user.type(screen.getByTestId('project-startdate-input'), '2026-06-01');
    await user.type(screen.getByTestId('project-enddate-input'), '2026-01-01');
    await user.click(screen.getByTestId('project-form-submit'));

    expect(
      await screen.findByText(/date de fin.*strictement après/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit happy path : endDate vide → undefined, description vide → undefined', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProjectForm mode="create" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('project-code-input'), 'NEW-PROJECT-2026');
    await user.type(screen.getByTestId('project-title-input'), 'Nouveau projet de test');
    await user.type(screen.getByTestId('project-startdate-input'), '2026-01-01');
    await user.click(screen.getByTestId('project-form-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.code).toBe('NEW-PROJECT-2026');
    expect(payload.title).toBe('Nouveau projet de test');
    expect(payload.startDate).toBe('2026-01-01');
    expect(payload.endDate).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.status).toBe('active');
  });

  it('mode edit : endDate vidée → envoie null (PATCH clear)', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup();
    render(<ProjectForm mode="edit" defaultValues={fakeProject} onSubmit={onSubmit} />);

    await user.clear(screen.getByTestId('project-enddate-input'));
    await user.click(screen.getByTestId('project-form-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.endDate).toBeNull();
  });

  it("affiche l'errorMessage backend (cas 409 DUPLICATE_CODE)", () => {
    render(
      <ProjectForm
        mode="create"
        onSubmit={jest.fn()}
        errorMessage="Erreur 409 — code projet déjà utilisé"
      />,
    );
    expect(screen.getByTestId('project-form-error')).toHaveTextContent('409');
  });
});
