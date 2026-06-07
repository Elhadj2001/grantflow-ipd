/**
 * Backfill US-024 (ADR-005) — matérialise budgeted_amount_xof / fx_rate /
 * fx_rate_date / currency sur les ref.budget_line existantes.
 *
 * Contexte : la migration Sprint S3 ajoute ces colonnes (NULL par défaut).
 * Ce script fige rétroactivement l'équivalent XOF + le taux pour les lignes
 * créées avant US-024, en valorisant à la date de la convention
 * (grant.startDate, à défaut grant.createdAt). La conversion réutilise la
 * même logique de production (ExchangeRateService.convertToXof) : parité fixe
 * BCEAO pour EUR, lookup ref.exchange_rate sinon, fallback indicatif tracé.
 *
 * Idempotent : ne traite que les lignes où budgeted_amount_xof IS NULL ;
 * relancer le script ne re-touche aucune ligne déjà matérialisée.
 *
 * Lancement :
 *   npx ts-node apps/api/scripts/backfill-budget-line-xof.ts
 * (ou, depuis apps/api : npx ts-node scripts/backfill-budget-line-xof.ts)
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExchangeRateService } from '../src/referential/exchange-rate/exchange-rate.service';

async function main(): Promise<void> {
  const logger = new Logger('backfill-budget-line-xof');
  const prisma = new PrismaService();
  await prisma.$connect();
  const fx = new ExchangeRateService(prisma);

  // Idempotence : seules les lignes non encore matérialisées.
  const rows = await prisma.budgetLine.findMany({
    where: { budgetedAmountXof: null },
    select: {
      id: true,
      code: true,
      budgetedAmount: true,
      currency: true,
      grant: { select: { currency: true, startDate: true, createdAt: true } },
    },
  });

  logger.log({ event: 'backfill_start', candidates: rows.length });

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const currency = row.currency ?? row.grant.currency;
    const valuationDate = row.grant.startDate ?? row.grant.createdAt ?? new Date();
    try {
      const conv = await fx.convertToXof(row.budgetedAmount, currency, valuationDate);
      await prisma.budgetLine.update({
        where: { id: row.id },
        data: {
          budgetedAmountXof: BigInt(Math.round(conv.xofAmount)),
          fxRate: new Prisma.Decimal(conv.fxRate),
          fxRateDate: conv.fxRateDate,
          currency,
        },
      });
      updated += 1;
      logger.log({
        event: 'backfill_line',
        budgetLineId: row.id,
        code: row.code,
        currency,
        xofAmount: conv.xofAmount,
        fxRate: conv.fxRate,
        fxRateDate: conv.fxRateDate,
        isIndicativeFallback: conv.isIndicativeFallback,
      });
    } catch (err) {
      failed += 1;
      logger.error({
        event: 'backfill_line_failed',
        budgetLineId: row.id,
        code: row.code,
        currency,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.log({ event: 'backfill_done', candidates: rows.length, updated, failed });
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
