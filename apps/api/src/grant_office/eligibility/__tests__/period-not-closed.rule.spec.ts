import { PeriodNotClosedRule } from '../rules/period-not-closed.rule';
import type { EligibilityContext } from '../eligibility-context';
import { createPrismaMock, type PrismaMock } from '../../../test-utils/prisma-mock';
import type { PrismaService } from '../../../prisma/prisma.service';

/**
 * Fabrique un EligibilityContext minimal pour US-047. Seuls les champs lus par
 * PeriodNotClosedRule sont renseignés (`pr.requestedAt`, `now`) ; le reste est
 * cast.
 */
function makeContext(requestedAt: Date, now: Date): EligibilityContext {
  return {
    pr: { requestedAt },
    now,
  } as unknown as EligibilityContext;
}

describe('PeriodNotClosedRule (US-047)', () => {
  let prisma: PrismaMock;
  let rule: PeriodNotClosedRule;

  beforeEach(() => {
    prisma = createPrismaMock();
    rule = new PeriodNotClosedRule(prisma as unknown as PrismaService);
  });

  it('retourne OK quand une période ouverte couvre la date', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue({
      id: 'p1',
      code: '2026-06',
    } as never);

    const verdict = await rule.check(
      makeContext(new Date('2026-06-15'), new Date('2026-06-20')),
    );

    expect(verdict.kind).toBe('ok');
  });

  it("bloque quand aucune période ouverte ne couvre la date (période close)", async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue(null as never);

    const verdict = await rule.check(
      makeContext(new Date('2026-06-15'), new Date('2026-06-20')),
    );

    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_PERIOD_CLOSED');
    }
  });

  it('bloque quand la date est hors de toute période fiscale', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue(null as never);

    const verdict = await rule.check(
      makeContext(new Date('2030-01-01'), new Date('2030-01-05')),
    );

    expect(verdict.kind).toBe('blocked');
    if (verdict.kind === 'blocked') {
      expect(verdict.code).toBe('ELIG_PERIOD_CLOSED');
    }
  });
});
