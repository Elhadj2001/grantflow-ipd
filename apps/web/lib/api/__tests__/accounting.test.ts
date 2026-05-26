/**
 * Tests du client lib/api/accounting (sprint F5b-b Lot A).
 *
 * Stratégie : on mock `apiFetch` au niveau du module — on n'a pas besoin
 * de vrai HTTP, juste de vérifier URL + méthode + body + options
 * (accessToken). Le contenu de la réponse est laissé au backend
 * (testé indépendamment).
 */
import {
  CHECK_CODE_LABELS_FR,
  closePeriod,
  getPeriodChecks,
  getPeriodEvents,
  listPeriods,
  precheckPeriod,
  reopenPeriod,
  runAccruals,
  runDedicatedFunds,
  runPrepayments,
  severityToBadgeVariant,
  type ClosePeriodInput,
  type ReopenPeriodInput,
  type RunPrepaymentsInput,
} from '../accounting';

jest.mock('../../api-client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../api-client';
const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue([] as never);
});

describe('lib/api/accounting — clients HTTP', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const opts = { accessToken: 'TOKEN' };

  describe('GET endpoints', () => {
    it('listPeriods → GET /accounting/periods + token transmis', async () => {
      await listPeriods(opts);
      expect(apiFetchMock).toHaveBeenCalledWith('/accounting/periods', opts);
    });

    it('getPeriodEvents → GET /accounting/periods/:id/events', async () => {
      await getPeriodEvents(periodId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/events`,
        opts,
      );
    });

    it('getPeriodChecks → GET /accounting/periods/:id/checks', async () => {
      await getPeriodChecks(periodId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/checks`,
        opts,
      );
    });
  });

  describe('POST endpoints simples (pas de body)', () => {
    it('precheckPeriod → POST sans body', async () => {
      await precheckPeriod(periodId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/precheck`,
        { accessToken: 'TOKEN', method: 'POST' },
      );
    });

    it('runAccruals → POST /accruals sans body', async () => {
      await runAccruals(periodId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/accruals`,
        { accessToken: 'TOKEN', method: 'POST' },
      );
    });

    it('runDedicatedFunds → POST /dedicated-funds sans body', async () => {
      await runDedicatedFunds(periodId, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/dedicated-funds`,
        { accessToken: 'TOKEN', method: 'POST' },
      );
    });
  });

  describe('POST endpoints avec body', () => {
    it('runPrepayments envoie { entries } dans le body', async () => {
      const input: RunPrepaymentsInput = {
        entries: [
          {
            direction: 'CCA',
            accountCode: '622',
            amount: 100_000,
            label: 'Loyer Q1 2027 prépayé',
          },
          {
            direction: 'PCA',
            accountCode: '754',
            amount: 50_000,
            label: 'Subvention non employée',
          },
        ],
      };
      await runPrepayments(periodId, input, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/prepayments`,
        { accessToken: 'TOKEN', method: 'POST', json: input },
      );
    });

    it('closePeriod transmet acknowledgeWarnings + reason', async () => {
      const input: ClosePeriodInput = {
        acknowledgeWarnings: true,
        reason: 'Override DAF — C006 résolu manuellement',
      };
      await closePeriod(periodId, input, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/close`,
        { accessToken: 'TOKEN', method: 'POST', json: input },
      );
    });

    it('reopenPeriod exige reason (transmis tel quel)', async () => {
      const input: ReopenPeriodInput = { reason: 'Correction erreur de saisie facture #123' };
      await reopenPeriod(periodId, input, opts);
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/accounting/periods/${periodId}/reopen`,
        { accessToken: 'TOKEN', method: 'POST', json: input },
      );
    });
  });

  describe('Helpers UI', () => {
    it('severityToBadgeVariant : BLOCKING → error, WARNING → warning', () => {
      expect(severityToBadgeVariant('BLOCKING')).toBe('error');
      expect(severityToBadgeVariant('WARNING')).toBe('warning');
    });

    it('CHECK_CODE_LABELS_FR couvre C001..C006 et W001..W003', () => {
      const codes = ['C001', 'C002', 'C003', 'C004', 'C005', 'C006', 'W001', 'W002', 'W003'];
      for (const c of codes) {
        expect(CHECK_CODE_LABELS_FR[c]).toBeDefined();
        expect(CHECK_CODE_LABELS_FR[c].length).toBeGreaterThan(5);
      }
    });
  });
});
