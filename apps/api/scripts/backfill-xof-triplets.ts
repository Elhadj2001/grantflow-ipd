/**
 * Backfill US-097 (F-S8-14, ADR-005) — matérialise les triplets XOF
 * (`*_amount_xof`, `fx_rate`, `fx_rate_date`) sur les entités créées AVANT
 * l'écriture systématique à la source :
 *
 *   - procurement.purchase_request  (total_amount_xof)  + lignes (unit_price_xof)
 *   - procurement.purchase_order    (total_ht/vat/ttc_xof) + lignes (unit_price_xof)
 *   - ap.invoice                    (total_ht/vat/ttc_xof) + lignes (unit_price_xof, line_total_xof)
 *   - ap.payment                    (amount_xof)
 *
 * Valorisation : taux à la DATE MÉTIER de l'entité (requested_at / order_date /
 * invoice_date / payment_date) via la logique de production
 * `ExchangeRateService.convertToXof` (parité BCEAO EUR, lookup ref.exchange_rate,
 * arrondi half-up US-095). **Fallback « taux du jour » documenté** : si aucun
 * taux BD n'existe À la date de l'entité (convertToXof renverrait le fallback
 * indicatif 600/800/700), on retente au jour d'exécution — si un taux seedé
 * existe (ex. USD 590,50 @2026-07-15), c'est LUI qui est figé (flag
 * `usedTodayRate` dans le rapport). L'indicatif ne reste qu'en dernier recours
 * (flag `isIndicativeFallback`).
 *
 * Idempotent : ne traite que les lignes où la colonne XOF cible est NULL.
 *
 * DRY-RUN PAR DÉFAUT (aucune écriture, rapport ligne à ligne sur stdout).
 * APPLY : variable d'env `BACKFILL_APPLY=on` (+ marqueur de session
 * `set_config('grantflow.backfill_apply','on')` — convention US-067).
 *
 * Lancement :
 *   dry-run : npx ts-node -r dotenv/config scripts/backfill-xof-triplets.ts
 *   apply   : BACKFILL_APPLY=on npx ts-node -r dotenv/config scripts/backfill-xof-triplets.ts
 * (DATABASE_URL via env — jamais en dur, jamais sur disque.)
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ExchangeRateService,
  type XofConversionResult,
} from '../src/referential/exchange-rate/exchange-rate.service';

const APPLY = process.env.BACKFILL_APPLY === 'on';

interface ReportLine {
  entity: string;
  id: string;
  ref: string;
  currency: string;
  date: string;
  amounts: Record<string, { raw: string; xof: number }>;
  fxRate: number;
  fxRateDate: string;
  usedTodayRate: boolean;
  isIndicativeFallback: boolean;
}

const report: ReportLine[] = [];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const fx = new ExchangeRateService(prisma);

  /**
   * convertToXof à la date métier, avec repli « taux du jour » si le seul
   * résultat à la date est le fallback indicatif (cf. en-tête).
   */
  async function convertAt(
    amount: number | Prisma.Decimal,
    currency: string,
    date: Date,
  ): Promise<XofConversionResult & { usedTodayRate: boolean }> {
    const atDate = await fx.convertToXof(amount, currency, date);
    if (!atDate.isIndicativeFallback) return { ...atDate, usedTodayRate: false };
    const today = await fx.convertToXof(amount, currency);
    if (!today.isIndicativeFallback) return { ...today, usedTodayRate: true };
    return { ...atDate, usedTodayRate: false };
  }

  if (APPLY) {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('grantflow.backfill_apply', 'on', false)`,
    );
  }
  console.log(`=== Backfill US-097 triplets XOF — mode ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);

  // ------------------------------------------------------------------
  // 1. Demandes d'achat + lignes
  // ------------------------------------------------------------------
  const prs = await prisma.purchaseRequest.findMany({
    where: { total_amount_xof: null },
    select: {
      id: true,
      prNumber: true,
      currency: true,
      totalAmount: true,
      requestedAt: true,
      lines: { where: { unit_price_xof: null }, select: { id: true, unitPrice: true } },
    },
  });
  for (const pr of prs) {
    const conv = await convertAt(pr.totalAmount, pr.currency, pr.requestedAt);
    report.push({
      entity: 'purchase_request',
      id: pr.id,
      ref: pr.prNumber,
      currency: pr.currency,
      date: iso(pr.requestedAt),
      amounts: { total_amount: { raw: pr.totalAmount.toString(), xof: conv.xofAmount } },
      fxRate: conv.fxRate,
      fxRateDate: iso(conv.fxRateDate),
      usedTodayRate: conv.usedTodayRate,
      isIndicativeFallback: conv.isIndicativeFallback,
    });
    if (APPLY) {
      await prisma.purchaseRequest.update({
        where: { id: pr.id },
        data: {
          total_amount_xof: BigInt(conv.xofAmount),
          fx_rate: conv.fxRate,
          fx_rate_date: conv.fxRateDate,
        },
      });
    }
    for (const line of pr.lines) {
      const lc = await convertAt(line.unitPrice, pr.currency, pr.requestedAt);
      report.push({
        entity: 'purchase_request_line',
        id: line.id,
        ref: pr.prNumber,
        currency: pr.currency,
        date: iso(pr.requestedAt),
        amounts: { unit_price: { raw: line.unitPrice.toString(), xof: lc.xofAmount } },
        fxRate: lc.fxRate,
        fxRateDate: iso(lc.fxRateDate),
        usedTodayRate: lc.usedTodayRate,
        isIndicativeFallback: lc.isIndicativeFallback,
      });
      if (APPLY) {
        await prisma.purchaseRequestLine.update({
          where: { id: line.id },
          data: {
            unit_price_xof: BigInt(lc.xofAmount),
            fx_rate: lc.fxRate,
            fx_rate_date: lc.fxRateDate,
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 2. Bons de commande + lignes
  // ------------------------------------------------------------------
  const pos = await prisma.purchaseOrder.findMany({
    where: { total_ht_xof: null },
    select: {
      id: true,
      poNumber: true,
      currency: true,
      totalHt: true,
      totalVat: true,
      totalTtc: true,
      orderDate: true,
      lines: { where: { unit_price_xof: null }, select: { id: true, unitPrice: true } },
    },
  });
  for (const po of pos) {
    const [ht, vat, ttc] = [
      await convertAt(po.totalHt, po.currency, po.orderDate),
      await convertAt(po.totalVat, po.currency, po.orderDate),
      await convertAt(po.totalTtc, po.currency, po.orderDate),
    ];
    report.push({
      entity: 'purchase_order',
      id: po.id,
      ref: po.poNumber,
      currency: po.currency,
      date: iso(po.orderDate),
      amounts: {
        total_ht: { raw: po.totalHt.toString(), xof: ht.xofAmount },
        total_vat: { raw: po.totalVat.toString(), xof: vat.xofAmount },
        total_ttc: { raw: po.totalTtc.toString(), xof: ttc.xofAmount },
      },
      fxRate: ttc.fxRate,
      fxRateDate: iso(ttc.fxRateDate),
      usedTodayRate: ttc.usedTodayRate,
      isIndicativeFallback: ttc.isIndicativeFallback,
    });
    if (APPLY) {
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          total_ht_xof: BigInt(ht.xofAmount),
          total_vat_xof: BigInt(vat.xofAmount),
          total_ttc_xof: BigInt(ttc.xofAmount),
          fx_rate: ttc.fxRate,
          fx_rate_date: ttc.fxRateDate,
        },
      });
    }
    for (const line of po.lines) {
      const lc = await convertAt(line.unitPrice, po.currency, po.orderDate);
      report.push({
        entity: 'purchase_order_line',
        id: line.id,
        ref: po.poNumber,
        currency: po.currency,
        date: iso(po.orderDate),
        amounts: { unit_price: { raw: line.unitPrice.toString(), xof: lc.xofAmount } },
        fxRate: lc.fxRate,
        fxRateDate: iso(lc.fxRateDate),
        usedTodayRate: lc.usedTodayRate,
        isIndicativeFallback: lc.isIndicativeFallback,
      });
      if (APPLY) {
        await prisma.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            unit_price_xof: BigInt(lc.xofAmount),
            fx_rate: lc.fxRate,
            fx_rate_date: lc.fxRateDate,
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Factures + lignes
  // ------------------------------------------------------------------
  const invoices = await prisma.invoice.findMany({
    where: { total_ht_xof: null },
    select: {
      id: true,
      invoiceNumber: true,
      currency: true,
      totalHt: true,
      totalVat: true,
      totalTtc: true,
      invoiceDate: true,
      lines: {
        where: { line_total_xof: null },
        select: { id: true, unitPrice: true, lineTotal: true },
      },
    },
  });
  for (const inv of invoices) {
    const [ht, vat, ttc] = [
      await convertAt(inv.totalHt, inv.currency, inv.invoiceDate),
      await convertAt(inv.totalVat, inv.currency, inv.invoiceDate),
      await convertAt(inv.totalTtc, inv.currency, inv.invoiceDate),
    ];
    report.push({
      entity: 'invoice',
      id: inv.id,
      ref: inv.invoiceNumber,
      currency: inv.currency,
      date: iso(inv.invoiceDate),
      amounts: {
        total_ht: { raw: inv.totalHt.toString(), xof: ht.xofAmount },
        total_vat: { raw: inv.totalVat.toString(), xof: vat.xofAmount },
        total_ttc: { raw: inv.totalTtc.toString(), xof: ttc.xofAmount },
      },
      fxRate: ttc.fxRate,
      fxRateDate: iso(ttc.fxRateDate),
      usedTodayRate: ttc.usedTodayRate,
      isIndicativeFallback: ttc.isIndicativeFallback,
    });
    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          total_ht_xof: BigInt(ht.xofAmount),
          total_vat_xof: BigInt(vat.xofAmount),
          total_ttc_xof: BigInt(ttc.xofAmount),
          fx_rate: ttc.fxRate,
          fx_rate_date: ttc.fxRateDate,
        },
      });
    }
    for (const line of inv.lines) {
      const lt = await convertAt(line.lineTotal, inv.currency, inv.invoiceDate);
      const up =
        line.unitPrice != null ? await convertAt(line.unitPrice, inv.currency, inv.invoiceDate) : null;
      report.push({
        entity: 'invoice_line',
        id: line.id,
        ref: inv.invoiceNumber,
        currency: inv.currency,
        date: iso(inv.invoiceDate),
        amounts: {
          line_total: { raw: line.lineTotal.toString(), xof: lt.xofAmount },
          ...(up && line.unitPrice != null
            ? { unit_price: { raw: line.unitPrice.toString(), xof: up.xofAmount } }
            : {}),
        },
        fxRate: lt.fxRate,
        fxRateDate: iso(lt.fxRateDate),
        usedTodayRate: lt.usedTodayRate,
        isIndicativeFallback: lt.isIndicativeFallback,
      });
      if (APPLY) {
        await prisma.invoiceLine.update({
          where: { id: line.id },
          data: {
            line_total_xof: BigInt(lt.xofAmount),
            unit_price_xof: up ? BigInt(up.xofAmount) : null,
            fx_rate: lt.fxRate,
            fx_rate_date: lt.fxRateDate,
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. Paiements
  // ------------------------------------------------------------------
  const payments = await prisma.payment.findMany({
    where: { amount_xof: null },
    select: { id: true, amount: true, currency: true, paymentDate: true, bankReference: true },
  });
  for (const p of payments) {
    const conv = await convertAt(p.amount, p.currency, p.paymentDate);
    report.push({
      entity: 'payment',
      id: p.id,
      ref: p.bankReference ?? p.id.slice(0, 8),
      currency: p.currency,
      date: iso(p.paymentDate),
      amounts: { amount: { raw: p.amount.toString(), xof: conv.xofAmount } },
      fxRate: conv.fxRate,
      fxRateDate: iso(conv.fxRateDate),
      usedTodayRate: conv.usedTodayRate,
      isIndicativeFallback: conv.isIndicativeFallback,
    });
    if (APPLY) {
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          amount_xof: BigInt(conv.xofAmount),
          fx_rate: conv.fxRate,
          fx_rate_date: conv.fxRateDate,
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // Rapport
  // ------------------------------------------------------------------
  for (const l of report) {
    console.log(JSON.stringify(l));
  }
  const byEntity = report.reduce<Record<string, number>>((acc, l) => {
    acc[l.entity] = (acc[l.entity] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    JSON.stringify({
      mode: APPLY ? 'APPLY' : 'DRY-RUN',
      total: report.length,
      byEntity,
      usedTodayRate: report.filter((l) => l.usedTodayRate).length,
      indicativeFallback: report.filter((l) => l.isIndicativeFallback).length,
    }),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
