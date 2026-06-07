/**
 * Backfill US-140 (I1, ADR-005) — renseigne fx_rate / fx_rate_date sur les
 * gl.journal_line en devise étrangère (currency != 'XOF') où elles sont NULL.
 *
 * Contexte : avant US-020/US-140, certaines lignes étrangères (4 lignes USD
 * du seed) ont été créées sans taux. Le CHECK chk_fx_consistency (US-140)
 * exige fx_rate renseigné pour toute ligne non-XOF ; ce backfill fige donc
 * rétroactivement le taux à la date de l'écriture parente (journal_entry.
 * entryDate), via la logique de production ExchangeRateService.convertToXof
 * (parité BCEAO pour EUR, lookup ref.exchange_rate sinon, fallback indicatif
 * tracé). On NE modifie PAS debit/credit (déjà figés, écritures possiblement
 * posted/équilibrées) : seul le taux est matérialisé.
 *
 * Idempotent : ne traite que currency != 'XOF' AND fx_rate IS NULL.
 *
 * Lancement (à exécuter AVANT d'ajouter le CHECK chk_fx_consistency) :
 *   npx ts-node -r dotenv/config apps/api/scripts/backfill-journal-line-fx-rate.ts
 *   (depuis apps/api : npx ts-node -r dotenv/config scripts/backfill-journal-line-fx-rate.ts)
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExchangeRateService } from '../src/referential/exchange-rate/exchange-rate.service';

async function main(): Promise<void> {
  const logger = new Logger('backfill-journal-line-fx-rate');
  const prisma = new PrismaService();
  await prisma.$connect();
  const fx = new ExchangeRateService(prisma);

  // Idempotence : lignes étrangères sans taux uniquement.
  const rows = await prisma.journalLine.findMany({
    where: { currency: { not: 'XOF' }, fx_rate: null },
    select: {
      id: true,
      accountCode: true,
      currency: true,
      entry: { select: { entryDate: true } },
    },
  });

  logger.log({ event: 'backfill_start', candidates: rows.length });

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const valuationDate = row.entry?.entryDate ?? new Date();
    try {
      // Le taux est indépendant du montant pour EUR/USD/fallback ; on convertit
      // une unité pour récupérer fxRate + fxRateDate.
      const conv = await fx.convertToXof(1, row.currency, valuationDate);
      await prisma.journalLine.update({
        where: { id: row.id },
        data: {
          fx_rate: new Prisma.Decimal(conv.fxRate),
          fx_rate_date: conv.fxRateDate,
        },
      });
      updated += 1;
      logger.log({
        event: 'backfill_line',
        journalLineId: row.id,
        accountCode: row.accountCode,
        currency: row.currency,
        fxRate: conv.fxRate,
        fxRateDate: conv.fxRateDate,
        isIndicativeFallback: conv.isIndicativeFallback,
      });
    } catch (err) {
      failed += 1;
      logger.error({
        event: 'backfill_line_failed',
        journalLineId: row.id,
        currency: row.currency,
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
