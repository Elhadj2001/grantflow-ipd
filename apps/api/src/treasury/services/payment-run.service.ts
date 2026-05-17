import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { BankAccount, Payment, PaymentRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BankAccountInactiveException,
  BankAccountNotFoundException,
  EntityNotFoundException,
  InvoiceAlreadyInRunException,
  InvoiceNotPayableException,
  MissingIbanException,
  PaymentCurrencyMismatchException,
  PaymentRunCancelReasonRequiredException,
  PaymentRunEmptyException,
  PaymentRunNotApprovableException,
  PaymentRunNotCancellableException,
  PaymentRunNotEditableException,
  PaymentRunNotPreparableException,
  PaymentRunNotRejectableException,
  PaymentRunRejectReasonRequiredException,
} from '../../common/exceptions/business.exception';
import { isValidIban } from '../../referential/supplier/iban-bic.util';
import { PostingService, type PostingActor } from '../../accounting/services/posting.service';
import type {
  AddInvoicesToRunDto,
  CreatePaymentRunDto,
  PaymentRunQueryDto,
} from '../dto/payment-run.dto';

const ENTITY_NAME = 'PaymentRun';

/**
 * Statuts d'un run "actif" (consomment une facture, empêchent une nouvelle
 * inclusion). `rejected` et `cancelled` libèrent la facture.
 */
const ACTIVE_RUN_STATUSES = ['draft', 'prepared', 'executed'] as const;
type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

/** Statuts de facture qui autorisent la mise en paiement. */
const PAYABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.posted,
  InvoiceStatus.partially_paid,
];

export interface PaymentRunWithPayments extends PaymentRun {
  payments: (Payment & { invoice: { id: string; invoiceNumber: string; totalTtc: Prisma.Decimal } })[];
}

export interface PreparationWarning {
  paymentId: string;
  invoiceId: string;
  supplierCode: string;
  warning: string;
}

@Injectable()
export class PaymentRunService {
  private readonly logger = new Logger(PaymentRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  // ------------------------------------------------------------------
  // Lecture
  // ------------------------------------------------------------------

  async findMany(query: PaymentRunQueryDto) {
    const where: Prisma.PaymentRunWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.bankAccountId) where.bankAccountId = query.bankAccountId;
    if (query.fromDate || query.toDate) {
      where.runDate = {};
      if (query.fromDate) where.runDate.gte = query.fromDate;
      if (query.toDate) where.runDate.lte = query.toDate;
    }
    const orderBy: Prisma.PaymentRunOrderByWithRelationInput = {
      [query.sort]: query.order,
    };
    const skip = (query.page - 1) * query.pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.paymentRun.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.paymentRun.count({ where }),
    ]);
    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(runId: string): Promise<PaymentRunWithPayments> {
    const run = await this.prisma.paymentRun.findUnique({
      where: { id: runId },
      include: {
        payments: {
          orderBy: { createdAt: 'asc' },
          include: {
            invoice: { select: { id: true, invoiceNumber: true, totalTtc: true } },
          },
        },
      },
    });
    if (!run) throw new EntityNotFoundException(ENTITY_NAME, { id: runId });
    return run;
  }

  async listPayments(runId: string) {
    await this.ensureExists(runId);
    return this.prisma.payment.findMany({
      where: { paymentRunId: runId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, totalTtc: true, currency: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listJournalEntries(runId: string) {
    await this.ensureExists(runId);
    const payments = await this.prisma.payment.findMany({
      where: { paymentRunId: runId },
      select: { id: true },
    });
    const entries = await Promise.all(
      payments.map((p) => this.posting.listEntriesForPayment(p.id)),
    );
    return { bqEntries: entries.flat() };
  }

  // ------------------------------------------------------------------
  // Création / édition (status='draft')
  // ------------------------------------------------------------------

  async createRun(actor: PostingActor, dto: CreatePaymentRunDto): Promise<PaymentRunWithPayments> {
    const bankAccount = await this.loadBankAccount(dto.bankAccountId);
    const currency = bankAccount.currency;

    // Si l'utilisateur a passé une devise explicite, la valider
    if (dto.currency && dto.currency !== currency) {
      throw new PaymentCurrencyMismatchException('(run)', dto.currency, currency);
    }

    const invoices = await this.loadAndValidateInvoices(dto.invoiceIds, currency);

    const paymentDate = dto.paymentDate ?? new Date();
    const totalAmount = invoices.reduce(
      (s, i) => s + this.remainingAmount(i),
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      const runNumber = await this.generateRunNumber(tx);
      const run = await tx.paymentRun.create({
        data: {
          runNumber,
          runDate: paymentDate,
          currency,
          bankAccountId: bankAccount.id,
          preparedBy: actor.id,
          totalAmount,
          status: 'draft',
        },
      });

      await tx.payment.createMany({
        data: invoices.map((inv) => ({
          paymentRunId: run.id,
          invoiceId: inv.id,
          amount: this.remainingAmount(inv),
          currency: inv.currency,
          method: dto.method,
          paymentDate,
          status: 'queued',
        })),
      });

      this.logger.log(
        {
          runNumber,
          bankAccount: bankAccount.code,
          invoiceCount: invoices.length,
          totalAmount,
        },
        'payment run created (draft)',
      );

      return tx.paymentRun.findUniqueOrThrow({
        where: { id: run.id },
        include: {
          payments: {
            orderBy: { createdAt: 'asc' },
            include: {
              invoice: { select: { id: true, invoiceNumber: true, totalTtc: true } },
            },
          },
        },
      });
    });
  }

  async addInvoices(
    actor: PostingActor,
    runId: string,
    dto: AddInvoicesToRunDto,
  ): Promise<PaymentRunWithPayments> {
    const run = await this.ensureExists(runId);
    if (run.status !== 'draft') {
      throw new PaymentRunNotEditableException(runId, run.status);
    }
    const invoices = await this.loadAndValidateInvoices(dto.invoiceIds, run.currency);

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.createMany({
        data: invoices.map((inv) => ({
          paymentRunId: runId,
          invoiceId: inv.id,
          amount: this.remainingAmount(inv),
          currency: inv.currency,
          method: 'sepa',
          paymentDate: run.runDate,
          status: 'queued',
        })),
      });
      const allPayments = await tx.payment.findMany({ where: { paymentRunId: runId } });
      const totalAmount = allPayments.reduce((s, p) => s + Number(p.amount), 0);
      await tx.paymentRun.update({
        where: { id: runId },
        data: { totalAmount },
      });
      this.logger.log(
        { runId, added: invoices.length, actor: actor.email, totalAmount },
        'invoices added to payment run',
      );
      return tx.paymentRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          payments: {
            orderBy: { createdAt: 'asc' },
            include: {
              invoice: { select: { id: true, invoiceNumber: true, totalTtc: true } },
            },
          },
        },
      });
    });
  }

  async removeInvoices(
    actor: PostingActor,
    runId: string,
    paymentIds: string[],
  ): Promise<PaymentRunWithPayments> {
    const run = await this.ensureExists(runId);
    if (run.status !== 'draft') {
      throw new PaymentRunNotEditableException(runId, run.status);
    }
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.payment.deleteMany({
        where: { id: { in: paymentIds }, paymentRunId: runId },
      });
      const allPayments = await tx.payment.findMany({ where: { paymentRunId: runId } });
      const totalAmount = allPayments.reduce((s, p) => s + Number(p.amount), 0);
      await tx.paymentRun.update({
        where: { id: runId },
        data: { totalAmount },
      });
      this.logger.log(
        { runId, removed: deleted.count, actor: actor.email, totalAmount },
        'invoices removed from payment run',
      );
      return tx.paymentRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          payments: {
            orderBy: { createdAt: 'asc' },
            include: {
              invoice: { select: { id: true, invoiceNumber: true, totalTtc: true } },
            },
          },
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // Transitions d'état
  // ------------------------------------------------------------------

  /**
   * draft → prepared : vérifie qu'il y a au moins 1 paiement et que tous les
   * fournisseurs ont un IBAN au format valide. Stocke les warnings (IBAN
   * absent côté supplier mais paiement par chèque) dans `preparation_warnings`.
   *
   * En cas d'IBAN format invalide → 409 MISSING_IBAN.
   */
  async prepare(actor: PostingActor, runId: string): Promise<PaymentRun> {
    const run = await this.ensureExists(runId);
    if (run.status !== 'draft') {
      throw new PaymentRunNotPreparableException(runId, run.status);
    }
    const payments = await this.prisma.payment.findMany({
      where: { paymentRunId: runId },
      include: {
        invoice: { select: { id: true, supplier: { select: { id: true, code: true, iban: true } } } },
      },
    });
    if (payments.length === 0) {
      throw new PaymentRunEmptyException(runId);
    }

    const warnings: PreparationWarning[] = [];
    const missingIban: Array<Record<string, unknown>> = [];

    for (const p of payments) {
      const supplier = p.invoice.supplier;
      // Pour les méthodes SEPA/SWIFT/direct_debit on exige un IBAN valide
      const needsIban = ['sepa', 'swift', 'direct_debit'].includes(p.method);
      if (!supplier.iban) {
        if (needsIban) {
          missingIban.push({
            paymentId: p.id,
            invoiceId: p.invoiceId,
            supplierCode: supplier.code,
            method: p.method,
          });
        } else {
          // check / cash : pas d'IBAN requis, mais on trace un warning
          warnings.push({
            paymentId: p.id,
            invoiceId: p.invoiceId,
            supplierCode: supplier.code,
            warning: `No IBAN on file — accepted because method=${p.method}`,
          });
        }
      } else if (!isValidIban(supplier.iban)) {
        missingIban.push({
          paymentId: p.id,
          invoiceId: p.invoiceId,
          supplierCode: supplier.code,
          iban: supplier.iban,
          reason: 'invalid_format',
        });
      }
    }

    if (missingIban.length > 0) {
      throw new MissingIbanException(missingIban);
    }

    const updated = await this.prisma.paymentRun.update({
      where: { id: runId },
      data: {
        status: 'prepared',
        preparationWarnings:
          warnings.length > 0
            ? (warnings as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
    // Met les paiements en 'prepared'
    await this.prisma.payment.updateMany({
      where: { paymentRunId: runId },
      data: { status: 'prepared' },
    });

    this.logger.log(
      { runId, actor: actor.email, paymentCount: payments.length, warnings: warnings.length },
      'payment run prepared',
    );
    return updated;
  }

  /**
   * prepared → executed : pour chaque paiement, créer l'écriture BQ via
   * PostingService.postPayment, puis basculer le paiement en 'executed'.
   * Met à jour le statut de chaque facture (partially_paid / paid) en
   * fonction du cumul des paiements executed.
   */
  async approve(actor: PostingActor, runId: string, comment?: string): Promise<PaymentRun> {
    const run = await this.ensureExists(runId);
    if (run.status !== 'prepared') {
      throw new PaymentRunNotApprovableException(runId, run.status);
    }
    if (!run.bankAccountId) {
      throw new EntityNotFoundException('BankAccount', { runId, hint: 'No bankAccount linked' });
    }
    const bankAccount = await this.loadBankAccount(run.bankAccountId);

    const payments = await this.prisma.payment.findMany({
      where: { paymentRunId: runId },
      include: {
        invoice: {
          include: { supplier: { select: { code: true, name: true } } },
        },
      },
    });
    if (payments.length === 0) {
      throw new PaymentRunEmptyException(runId);
    }

    // Phase 1 (hors transaction) — créer les écritures BQ en série :
    // chaque postPayment ouvre sa propre transaction (numérotation
    // séquentielle + advisory lock par appel).
    const postingResults: Array<{ paymentId: string; entryId: string; entryNumber: string }> = [];
    for (const p of payments) {
      const r = await this.posting.postPayment(actor, p, bankAccount);
      postingResults.push({ paymentId: p.id, entryId: r.entryId, entryNumber: r.entryNumber });
    }

    // Phase 2 — bascule des paiements + factures + run dans une seule
    // transaction. Si une étape échoue, on rollbacke les statuts mais
    // les écritures BQ déjà postées restent (extournement manuel via DAF).
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const p of payments) {
        await tx.payment.update({
          where: { id: p.id },
          data: {
            status: 'executed',
            bankReference: comment ? comment.slice(0, 64) : null,
          },
        });

        // Mise à jour du statut de la facture en fonction du cumul payé.
        const totalPaidRow = await tx.payment.aggregate({
          where: { invoiceId: p.invoiceId, status: 'executed' },
          _sum: { amount: true },
        });
        const totalPaid = Number(totalPaidRow._sum.amount ?? 0);
        const totalTtc = Number(p.invoice.totalTtc);
        const fullyPaid = totalPaid >= totalTtc - 0.01;
        await tx.invoice.update({
          where: { id: p.invoiceId },
          data: { status: fullyPaid ? InvoiceStatus.paid : InvoiceStatus.partially_paid },
        });
      }

      await tx.paymentRun.update({
        where: { id: runId },
        data: {
          status: 'executed',
          approvedBy: actor.id,
          approvedAt: now,
          executedAt: now,
        },
      });
    });

    this.logger.log(
      { runId, actor: actor.email, paymentCount: payments.length, comment },
      'payment run approved + executed',
    );

    return this.prisma.paymentRun.findUniqueOrThrow({ where: { id: runId } });
  }

  async reject(actor: PostingActor, runId: string, reason: string): Promise<PaymentRun> {
    if (!reason || reason.trim().length < 5) {
      throw new PaymentRunRejectReasonRequiredException();
    }
    const run = await this.ensureExists(runId);
    if (run.status !== 'prepared') {
      throw new PaymentRunNotRejectableException(runId, run.status);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { paymentRunId: runId },
        data: { status: 'cancelled' },
      });
      return tx.paymentRun.update({
        where: { id: runId },
        data: { status: 'rejected', rejectionReason: reason },
      });
    });
    this.logger.warn({ runId, actor: actor.email, reason }, 'payment run rejected');
    return updated;
  }

  async cancel(actor: PostingActor, runId: string, reason: string): Promise<PaymentRun> {
    if (!reason || reason.trim().length < 5) {
      throw new PaymentRunCancelReasonRequiredException();
    }
    const run = await this.ensureExists(runId);
    if (run.status !== 'draft') {
      throw new PaymentRunNotCancellableException(runId, run.status);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { paymentRunId: runId },
        data: { status: 'cancelled' },
      });
      return tx.paymentRun.update({
        where: { id: runId },
        data: { status: 'cancelled', rejectionReason: reason },
      });
    });
    this.logger.warn({ runId, actor: actor.email, reason }, 'payment run cancelled (draft)');
    return updated;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Reste à payer = totalTtc − Σ(payments executed). Cas typique 1ʳᵉ
   *  passe : remaining = totalTtc. Cas paiement partiel : on reprend la
   *  différence. */
  private remainingAmount(
    invoice: { totalTtc: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] },
  ): number {
    const totalTtc = Number(invoice.totalTtc);
    const alreadyPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
    return Math.max(0, totalTtc - alreadyPaid);
  }

  private async loadAndValidateInvoices(
    invoiceIds: string[],
    runCurrency: string,
  ): Promise<
    Array<{
      id: string;
      currency: string;
      totalTtc: Prisma.Decimal;
      status: InvoiceStatus;
      payments: { amount: Prisma.Decimal }[];
    }>
  > {
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: {
        id: true,
        currency: true,
        totalTtc: true,
        status: true,
        payments: {
          where: { status: 'executed' },
          select: { amount: true },
        },
      },
    });

    if (invoices.length !== invoiceIds.length) {
      const missing = invoiceIds.filter((id) => !invoices.some((i) => i.id === id));
      throw new EntityNotFoundException('Invoice', { missingIds: missing });
    }

    for (const inv of invoices) {
      if (!PAYABLE_INVOICE_STATUSES.includes(inv.status)) {
        throw new InvoiceNotPayableException(inv.id, inv.status);
      }
      if (inv.currency !== runCurrency) {
        throw new PaymentCurrencyMismatchException(inv.id, inv.currency, runCurrency);
      }
    }

    // Aucune facture déjà liée à un run "actif" (draft/prepared/executed)
    const activeLinks = await this.prisma.payment.findMany({
      where: {
        invoiceId: { in: invoiceIds },
        paymentRun: { status: { in: ACTIVE_RUN_STATUSES as unknown as ActiveRunStatus[] } },
      },
      select: {
        invoiceId: true,
        paymentRunId: true,
        paymentRun: { select: { runNumber: true } },
      },
    });
    if (activeLinks.length > 0) {
      const conflict = activeLinks[0];
      throw new InvoiceAlreadyInRunException(
        conflict.invoiceId,
        conflict.paymentRunId ?? '',
        conflict.paymentRun?.runNumber ?? '(unknown)',
      );
    }

    return invoices;
  }

  private async loadBankAccount(bankAccountId: string): Promise<BankAccount> {
    const ba = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!ba) throw new BankAccountNotFoundException(bankAccountId);
    if (!ba.isActive) throw new BankAccountInactiveException(bankAccountId);
    return ba;
  }

  private async ensureExists(runId: string): Promise<PaymentRun> {
    const run = await this.prisma.paymentRun.findUnique({ where: { id: runId } });
    if (!run) throw new EntityNotFoundException(ENTITY_NAME, { id: runId });
    return run;
  }

  /**
   * Numéro de run : `PAY-YYYY-NNNN`. Verrou advisory pour concurrence
   * (même approche que generatePoNumber).
   */
  private async generateRunNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const lockKey = this.hashToBigInt(`payment_run_${year}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    // MAX au lieu de COUNT : resilient aux trous
    const last = await tx.paymentRun.findFirst({
      where: { runNumber: { startsWith: `PAY-${year}-` } },
      orderBy: { runNumber: 'desc' },
      select: { runNumber: true },
    });
    const lastSeq = last ? parseInt(last.runNumber.split('-')[2] ?? '0', 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `PAY-${year}-${String(next).padStart(4, '0')}`;
  }

  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }
}
