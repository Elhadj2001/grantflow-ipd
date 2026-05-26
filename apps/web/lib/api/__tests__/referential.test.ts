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
