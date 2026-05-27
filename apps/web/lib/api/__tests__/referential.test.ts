/**
 * Tests Lot A — mutations supplier + budget-line (sprint F5b-c).
 *
 * Mock `apiFetch` — pas de vrai HTTP. On vérifie URL + méthode + body
 * + accessToken. Le contenu de la réponse est laissé au backend
 * (testé indépendamment).
 */
import {
  createBudgetLine,
  createSupplier,
  deleteBudgetLine,
  deleteSupplier,
  replaceSupplier,
  restoreBudgetLine,
  restoreSupplier,
  updateBudgetLine,
  updateSupplier,
  type CreateBudgetLineInput,
  type CreateSupplierInput,
  type UpdateBudgetLineInput,
  type UpdateSupplierInput,
} from '../referential';

jest.mock('../../api-client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../api-client';
const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({} as never);
});

describe('lib/api/referential — supplier mutations (F5b-c Lot A)', () => {
  const opts = { accessToken: 'TOKEN' };
  const supplierId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('createSupplier → POST /suppliers + body + token', async () => {
    const input: CreateSupplierInput = {
      code: 'BIOMED_SN',
      name: 'BioMed Sénégal SARL',
      country: 'SN',
      currencyDefault: 'XOF',
      paymentTermsDays: 30,
    };
    await createSupplier(input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith('/suppliers', {
      accessToken: 'TOKEN',
      method: 'POST',
      json: input,
    });
  });

  it('updateSupplier → PATCH /suppliers/:id + body partiel', async () => {
    const input: UpdateSupplierInput = {
      paymentTermsDays: 60,
      iban: null, // null = clear
    };
    await updateSupplier(supplierId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/suppliers/${supplierId}`, {
      accessToken: 'TOKEN',
      method: 'PATCH',
      json: input,
    });
  });

  it('replaceSupplier → PUT /suppliers/:id avec payload complet', async () => {
    const input: CreateSupplierInput = {
      code: 'BIOMED_SN',
      name: 'BioMed renamed',
    };
    await replaceSupplier(supplierId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/suppliers/${supplierId}`, {
      accessToken: 'TOKEN',
      method: 'PUT',
      json: input,
    });
  });

  it('deleteSupplier → DELETE /suppliers/:id (204 → void)', async () => {
    await deleteSupplier(supplierId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/suppliers/${supplierId}`, {
      accessToken: 'TOKEN',
      method: 'DELETE',
    });
  });

  it('restoreSupplier → POST /suppliers/:id/restore sans body', async () => {
    await restoreSupplier(supplierId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/suppliers/${supplierId}/restore`, {
      accessToken: 'TOKEN',
      method: 'POST',
    });
  });
});

describe('lib/api/referential — budget-line mutations (F5b-c Lot A)', () => {
  const opts = { accessToken: 'TOKEN' };
  const grantId = 'gggggggg-gggg-gggg-gggg-gggggggggggg';
  const lineId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('createBudgetLine → POST /grants/:grantId/budget-lines + body', async () => {
    const input: CreateBudgetLineInput = {
      code: 'L01',
      label: 'Consommables laboratoire',
      budgetedAmount: 90000,
      defaultAccount: '604',
      isOverheadEligible: true,
    };
    await createBudgetLine(grantId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/grants/${grantId}/budget-lines`, {
      accessToken: 'TOKEN',
      method: 'POST',
      json: input,
    });
  });

  it('updateBudgetLine → PATCH /grants/:grantId/budget-lines/:id + body partiel', async () => {
    const input: UpdateBudgetLineInput = {
      budgetedAmount: '120000.50',
      defaultAccount: null,
    };
    await updateBudgetLine(grantId, lineId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/grants/${grantId}/budget-lines/${lineId}`,
      { accessToken: 'TOKEN', method: 'PATCH', json: input },
    );
  });

  it('deleteBudgetLine → DELETE /grants/:grantId/budget-lines/:id', async () => {
    await deleteBudgetLine(grantId, lineId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/grants/${grantId}/budget-lines/${lineId}`,
      { accessToken: 'TOKEN', method: 'DELETE' },
    );
  });

  it('restoreBudgetLine → POST /grants/:grantId/budget-lines/:id/restore', async () => {
    await restoreBudgetLine(grantId, lineId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/grants/${grantId}/budget-lines/${lineId}/restore`,
      { accessToken: 'TOKEN', method: 'POST' },
    );
  });
});

// =====================================================================
//  Sprint F-REF-BAILLEURS-PROJETS — Donors + Projects mutations
// =====================================================================
import {
  createDonor,
  createProject,
  deleteDonor,
  deleteProject,
  restoreDonor,
  restoreProject,
  updateDonor,
  updateProject,
  type CreateDonorInput,
  type CreateProjectInput,
  type UpdateDonorInput,
  type UpdateProjectInput,
} from '../referential';

describe('lib/api/referential — donors mutations (F-REF Lot A)', () => {
  const opts = { accessToken: 'TOK' };
  const donorId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('createDonor → POST /donors + body + token', async () => {
    const input: CreateDonorInput = {
      code: 'GAVI',
      label: 'Global Alliance for Vaccines and Immunization',
      type: 'multilateral',
      country: 'CH',
      contactEmail: 'audit@gavi.org',
    };
    await createDonor(input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith('/donors', {
      accessToken: 'TOK',
      method: 'POST',
      json: input,
    });
  });

  it('updateDonor → PATCH /donors/:id + body partiel', async () => {
    const input: UpdateDonorInput = { label: 'Nouveau libellé', contactEmail: 'new@gavi.org' };
    await updateDonor(donorId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/donors/${donorId}`, {
      accessToken: 'TOK',
      method: 'PATCH',
      json: input,
    });
  });

  it('deleteDonor → DELETE /donors/:id (204 → void)', async () => {
    await deleteDonor(donorId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/donors/${donorId}`, {
      accessToken: 'TOK',
      method: 'DELETE',
    });
  });

  it('restoreDonor → POST /donors/:id/restore', async () => {
    await restoreDonor(donorId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/donors/${donorId}/restore`, {
      accessToken: 'TOK',
      method: 'POST',
    });
  });
});

describe('lib/api/referential — projects mutations (F-REF Lot A)', () => {
  const opts = { accessToken: 'TOK' };
  const projectId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  it('createProject → POST /projects + body + token', async () => {
    const input: CreateProjectInput = {
      code: 'MADIBA-VAC-2026',
      title: 'Vaccine R&D platform — Pasteur',
      startDate: '2026-01-01',
      endDate: '2029-12-31',
      status: 'active',
      description: 'Multi-vaccine pipeline 2026-2029',
    };
    await createProject(input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith('/projects', {
      accessToken: 'TOK',
      method: 'POST',
      json: input,
    });
  });

  it('updateProject → PATCH /projects/:id avec null = clear (endDate, description)', async () => {
    const input: UpdateProjectInput = {
      title: 'Titre mis à jour',
      endDate: null,
      description: null,
    };
    await updateProject(projectId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/projects/${projectId}`, {
      accessToken: 'TOK',
      method: 'PATCH',
      json: input,
    });
  });

  it('deleteProject → DELETE /projects/:id', async () => {
    await deleteProject(projectId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/projects/${projectId}`, {
      accessToken: 'TOK',
      method: 'DELETE',
    });
  });

  it('restoreProject → POST /projects/:id/restore', async () => {
    await restoreProject(projectId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/projects/${projectId}/restore`, {
      accessToken: 'TOK',
      method: 'POST',
    });
  });
});
