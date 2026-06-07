import { NoCrossProjectDuplicateRule } from '../rules/no-cross-project-duplicate.rule';
import type { EligibilityContext } from '../eligibility-context';
import { PrismaService } from '../../../prisma/prisma.service';
import { createPrismaMock, type PrismaMock } from '../../../test-utils/prisma-mock';

/**
 * Fabrique un EligibilityContext minimal pour US-046. Seuls les champs
 * pertinents à NoCrossProjectDuplicateRule sont renseignés ; le reste est cast.
 * `supplierInvoiceNumber` est lu défensivement par la règle (hors type partagé)
 * et injecté ici via le même cast.
 */
function makeContext(supplierInvoiceNumber?: string): EligibilityContext {
  return {
    pr: {
      grantId: 'grant-1',
      ...(supplierInvoiceNumber ? { supplierInvoiceNumber } : {}),
    },
  } as unknown as EligibilityContext;
}

describe('NoCrossProjectDuplicateRule (US-046)', () => {
  let prisma: PrismaMock;
  let rule: NoCrossProjectDuplicateRule;

  beforeEach(() => {
    prisma = createPrismaMock();
    rule = new NoCrossProjectDuplicateRule(prisma as unknown as PrismaService);
  });

  it('retourne OK sans interroger la DB quand la DA ne référence pas de facture', async () => {
    const verdict = await rule.check(makeContext());
    expect(verdict.kind).toBe('ok');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it('retourne OK quand aucune facture homonyme n existe', async () => {
    prisma.invoice.findMany.mockResolvedValue([] as never);
    const verdict = await rule.check(makeContext('F-1'));
    expect(verdict.kind).toBe('ok');
    expect(prisma.invoice.findMany).toHaveBeenCalled();
  });

  it('lève un warning quand une facture homonyme existe ailleurs', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'F-1' },
    ] as never);
    const verdict = await rule.check(makeContext('F-1'));
    expect(verdict.kind).toBe('warning');
    if (verdict.kind === 'warning') {
      expect(verdict.code).toBe('ELIG_CROSS_PROJECT_DUPLICATE');
    }
  });
});
