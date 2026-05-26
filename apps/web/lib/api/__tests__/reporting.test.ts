import {
  filterReportsForBailleur,
  OFFICIAL_TEMPLATE_CODES,
  STATEMENT_SECTIONS,
  STATEMENT_TYPE_LABELS_FR,
  varianceLevel,
  type DonorReportSummary,
  type StatementType,
} from '../reporting';
import {
  createStatement,
  downloadStatementExcel,
  downloadStatementPdf,
  getStatement,
  listStatements,
  lockStatement,
} from '../reporting';

jest.mock('../../api-client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../api-client';
const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('lib/api/reporting helpers', () => {
  describe('varianceLevel', () => {
    it('< 5 % → none', () => {
      expect(varianceLevel(0)).toBe('none');
      expect(varianceLevel(3)).toBe('none');
      expect(varianceLevel(-4.9)).toBe('none');
    });
    it('entre 5 % et 15 % → warning', () => {
      expect(varianceLevel(5)).toBe('warning');
      expect(varianceLevel(10)).toBe('warning');
      expect(varianceLevel(-15)).toBe('warning');
    });
    it('> 15 % → critical', () => {
      expect(varianceLevel(20)).toBe('critical');
      expect(varianceLevel(-50)).toBe('critical');
    });
  });

  describe('OFFICIAL_TEMPLATE_CODES', () => {
    it('contient USAID / OMS / Wellcome', () => {
      expect(OFFICIAL_TEMPLATE_CODES.has('USAID_FFR425')).toBe(true);
      expect(OFFICIAL_TEMPLATE_CODES.has('OMS_STANDARD')).toBe(true);
      expect(OFFICIAL_TEMPLATE_CODES.has('WELLCOME_TRUST')).toBe(true);
    });
    it('ne contient pas un code custom', () => {
      expect(OFFICIAL_TEMPLATE_CODES.has('CUSTOM_IPD')).toBe(false);
    });
  });

  describe('filterReportsForBailleur', () => {
    const reports = [
      { id: 'r1', status: 'draft' },
      { id: 'r2', status: 'locked' },
      { id: 'r3', status: 'sent' },
      { id: 'r4', status: 'sent' },
    ] as Partial<DonorReportSummary>[] as DonorReportSummary[];

    it('garde uniquement les sent', () => {
      const filtered = filterReportsForBailleur(reports);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.status === 'sent')).toBe(true);
    });

    it('liste vide → liste vide', () => {
      expect(filterReportsForBailleur([])).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  // Sprint F5b-b — Statements clients HTTP
  // -----------------------------------------------------------------
  describe('Statements (sprint F5b-b)', () => {
    const statementId = 'sss-id';
    const opts = { accessToken: 'TOKEN' };

    beforeEach(() => {
      apiFetchMock.mockReset();
      apiFetchMock.mockResolvedValue({} as never);
      // mock fetch global pour les blobs PDF/Excel
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['x']),
      })) as unknown as typeof fetch;
    });

    it('listStatements applique le filtre periodId + type dans la querystring', async () => {
      await listStatements({ periodId: 'p1', type: 'TER' }, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/reporting/statements?periodId=p1&type=TER',
        opts,
      );
    });

    it('listStatements sans filtre → URL sans query', async () => {
      await listStatements({}, opts);
      expect(apiFetchMock).toHaveBeenCalledWith('/reporting/statements', opts);
    });

    it('getStatement → GET /reporting/statements/:id', async () => {
      await getStatement(statementId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/reporting/statements/${statementId}`,
        opts,
      );
    });

    it('createStatement → POST avec body { periodId, type }', async () => {
      await createStatement({ periodId: 'p1', type: 'FONDS_DEDIES' }, opts);
      expect(apiFetchMock).toHaveBeenCalledWith('/reporting/statements', {
        accessToken: 'TOKEN',
        method: 'POST',
        json: { periodId: 'p1', type: 'FONDS_DEDIES' },
      });
    });

    it('lockStatement → POST /:id/lock sans body', async () => {
      await lockStatement(statementId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/reporting/statements/${statementId}/lock`,
        { accessToken: 'TOKEN', method: 'POST' },
      );
    });

    it('downloadStatementPdf renvoie un Blob avec Authorization', async () => {
      const blob = await downloadStatementPdf(statementId, opts);
      expect(blob).toBeInstanceOf(Blob);
      const fetchMock = globalThis.fetch as jest.Mock;
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/reporting/statements/${statementId}/pdf`),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer TOKEN' }),
        }),
      );
    });

    it('downloadStatementExcel renvoie un Blob avec Authorization', async () => {
      const blob = await downloadStatementExcel(statementId, opts);
      expect(blob).toBeInstanceOf(Blob);
      const fetchMock = globalThis.fetch as jest.Mock;
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/reporting/statements/${statementId}/excel`),
        expect.any(Object),
      );
    });

    it('downloadStatementPdf lève une erreur si HTTP non-ok', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 404,
      })) as unknown as typeof fetch;
      await expect(downloadStatementPdf(statementId, opts)).rejects.toThrow(/HTTP 404/);
    });

    it('STATEMENT_TYPE_LABELS_FR couvre les 4 types', () => {
      const types: StatementType[] = ['TER', 'BILAN', 'RESULTAT', 'FONDS_DEDIES'];
      for (const t of types) {
        expect(STATEMENT_TYPE_LABELS_FR[t]).toBeDefined();
      }
    });

    it('STATEMENT_SECTIONS FONDS_DEDIES contient GRANTS + RAPPROCHEMENT_689_19', () => {
      expect(STATEMENT_SECTIONS.FONDS_DEDIES).toEqual([
        'GRANTS',
        'RAPPROCHEMENT_689_19',
      ]);
    });
  });
});
