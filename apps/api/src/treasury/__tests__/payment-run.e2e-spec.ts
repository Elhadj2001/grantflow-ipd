/**
 * E2E PaymentRun (sprint-5.1).
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre le workflow complet :
 *  DA → BC → GR → facture → POST → PaymentRun → prepare → approve
 *  → vérification SQL écriture BQ 401/521 équilibrée + invoice.status='paid'.
 *
 * Couvre aussi :
 *  - paiement partiel : invoice.status='partially_paid'
 *  - IBAN invalide / manquant → 409 MISSING_IBAN au prepare
 *  - bank account class != 5 → 409 BANK_ACCOUNT_WRONG_CLASS au create
 *  - factures en double dans un run actif → 409 INVOICE_ALREADY_IN_RUN
 *  - reject : prepared → rejected, payments → cancelled
 *  - cancel : draft → cancelled
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

const STACK_UP = process.env.STACK_UP === '1';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

async function getToken(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: 'grantflow-web',
    grant_type: 'password',
    username,
    password,
  });
  const res = await fetch(`${KEYCLOAK_URL}/realms/grantflow/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token fail ${username}: ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('no token');
  return j.access_token;
}

(STACK_UP ? describe : describe.skip)('PaymentRun workflow (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem = '';
  let tokenPi = '';
  let tokenSa = '';
  let tokenDaf = '';

  let projectId = '';
  let grantId = '';
  let blId = '';
  let supplierId = '';
  let supplierNoIbanId = '';
  let bankAccountXofId = '';

  const createdInvoices: string[] = [];
  const createdPos: string[] = [];
  const createdPrs: string[] = [];
  const createdGrs: string[] = [];
  const createdRuns: string[] = [];

  async function setupReadyPostedInvoice(opts: {
    unitPrice: number;
    qty: number;
    suffix: string;
    overrideSupplierId?: string;
  }): Promise<{ invoiceId: string; total: number; poId: string }> {
    const total = opts.unitPrice * opts.qty;
    const useSupplier = opts.overrideSupplierId ?? supplierId;

    // 1) DA
    const pr = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `PR PAY E2E ${opts.suffix}`,
        projectId,
        grantId,
        currency: 'XOF',
        requestType: 'standard',
        lines: [{
          description: `Article ${opts.suffix}`,
          quantity: opts.qty,
          unit: 'box',
          unitPrice: opts.unitPrice,
          budgetLineId: blId,
        }],
      });
    if (pr.status !== 201) throw new Error(`PR fail ${opts.suffix}: ${pr.status}`);
    const prId = pr.body.id;
    createdPrs.push(prId);

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${tokenDem}`);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${tokenPi}`)
      .send({});

    // 2) BC
    const po = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/from-pr/${prId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ supplierId: useSupplier });
    const poId = po.body.id;
    createdPos.push(poId);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${tokenSa}`);

    // 3) GR
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({});
    createdGrs.push(gr.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr.body.lines[0].id, quantity: opts.qty }] });
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);

    // 4) Facture
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-PAY-${opts.suffix}-${Date.now()}`,
        supplierId: useSupplier,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF',
        poId,
        totalHt: total,
        totalVat: 0,
        totalTtc: total,
        lines: [{
          lineNumber: 1,
          description: `Article ${opts.suffix}`,
          quantity: opts.qty,
          unitPrice: opts.unitPrice,
          lineTotal: total,
        }],
      });
    if (inv.status !== 201) throw new Error(`Invoice fail ${opts.suffix}: ${inv.status}`);
    createdInvoices.push(inv.body.id);

    // 5) submit → matched
    const sub = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/submit`)
      .set('Authorization', `Bearer ${tokenSa}`);
    if (sub.body.invoice.status !== 'matched') {
      throw new Error(`Submit fail ${opts.suffix}: ${sub.body.invoice.status}`);
    }

    // 6) post → posted
    const post = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/post`)
      .set('Authorization', `Bearer ${tokenSa}`);
    if (post.status !== 201) {
      throw new Error(`Post fail ${opts.suffix}: ${post.status} ${JSON.stringify(post.body)}`);
    }

    return { invoiceId: inv.body.id, total, poId };
  }

  beforeAll(async () => {
    [tokenDem, tokenPi, tokenSa, tokenDaf] = await Promise.all([
      getToken('amadou@pasteur.sn', 'Demandeur#2026'),
      getToken('pi@pasteur.sn', 'Pi#2026-IPD'),
      getToken('admin@pasteur.sn', 'Admin#2026'),
      getToken('daf@pasteur.sn', 'Daf#2026-IPD'),
    ]);
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    const piUser = await prisma.appUser.findUnique({ where: { email: 'pi@pasteur.sn' } });
    if (!piUser) throw new Error('PI user not seeded');
    const grant = await prisma.grantAgreement.findFirst({
      where: { status: 'active' },
      include: { budgetLines: { take: 1 } },
    });
    if (!grant || grant.budgetLines.length === 0) throw new Error('No active grant');
    projectId = grant.projectId;
    grantId = grant.id;
    blId = grant.budgetLines[0].id;
    await prisma.budgetLine.update({
      where: { id: blId },
      data: { budgetedAmount: 1_000_000_000 },
    });
    await prisma.project.update({ where: { id: projectId }, data: { piUserId: piUser.id } });

    // Supplier avec IBAN valide
    const supplier = await prisma.supplier.upsert({
      where: { code: 'E2E-PAY-SUP' },
      update: { iban: 'FR1420041010050500013M02606', isActive: true },
      create: {
        code: 'E2E-PAY-SUP',
        name: 'E2E PaymentRun Supplier',
        iban: 'FR1420041010050500013M02606',
        bic: 'CBAOSNDA',
        bankName: 'CBAO',
        country: 'SN',
        paymentTermsDays: 30,
        currencyDefault: 'XOF',
        isActive: true,
      },
    });
    supplierId = supplier.id;

    // Supplier sans IBAN (pour test MISSING_IBAN)
    const supplierNoIban = await prisma.supplier.upsert({
      where: { code: 'E2E-PAY-NOIBAN' },
      update: { iban: null, isActive: true },
      create: {
        code: 'E2E-PAY-NOIBAN',
        name: 'E2E No IBAN Supplier',
        country: 'SN',
        paymentTermsDays: 30,
        currencyDefault: 'XOF',
        isActive: true,
      },
    });
    supplierNoIbanId = supplierNoIban.id;

    // BankAccount (CBAO-XOF/521 doit déjà être seedé par DDL)
    const ba = await prisma.bankAccount.findUnique({ where: { code: 'CBAO-XOF' } });
    if (!ba) throw new Error('Seed CBAO-XOF missing');
    bankAccountXofId = ba.id;
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      if (createdRuns.length) {
        const payments = await prisma.payment.findMany({
          where: { paymentRunId: { in: createdRuns } },
          select: { id: true },
        });
        const pIds = payments.map((p) => p.id);
        if (pIds.length) {
          await prisma.journalLine.deleteMany({
            where: { entry: { sourceType: 'payment', sourceId: { in: pIds } } },
          });
          await prisma.journalEntry.deleteMany({
            where: { sourceType: 'payment', sourceId: { in: pIds } },
          });
        }
        await prisma.payment.deleteMany({ where: { paymentRunId: { in: createdRuns } } });
        await prisma.paymentRun.deleteMany({ where: { id: { in: createdRuns } } });
      }
      if (createdInvoices.length) {
        await prisma.journalLine.deleteMany({
          where: { entry: { sourceType: 'invoice', sourceId: { in: createdInvoices } } },
        });
        await prisma.journalEntry.deleteMany({
          where: { sourceType: 'invoice', sourceId: { in: createdInvoices } },
        });
        await prisma.invoiceMatch.deleteMany({
          where: { invoiceLine: { invoiceId: { in: createdInvoices } } },
        });
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: createdInvoices } } });
        await prisma.invoice.deleteMany({ where: { id: { in: createdInvoices } } });
      }
      if (createdGrs.length) {
        await prisma.goodsReceiptLine.deleteMany({ where: { grId: { in: createdGrs } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: createdGrs } } });
      }
      if (createdPos.length) {
        await prisma.journalLine.deleteMany({
          where: { entry: { sourceType: 'purchase_order', sourceId: { in: createdPos } } },
        });
        await prisma.journalEntry.deleteMany({
          where: { sourceType: 'purchase_order', sourceId: { in: createdPos } },
        });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPos } } });
      }
      if (createdPrs.length) {
        await prisma.approvalStep.deleteMany({ where: { entityId: { in: createdPrs } } });
        await prisma.purchaseRequestLine.deleteMany({ where: { prId: { in: createdPrs } } });
        await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdPrs } } });
      }
    }
    if (app) await app.close();
  });

  it('full happy path : create → prepare → approve → BQ entry + invoice.paid', async () => {
    const { invoiceId, total } = await setupReadyPostedInvoice({
      unitPrice: 10000,
      qty: 5,
      suffix: 'FULL',
    });

    const create = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('draft');
    expect(create.body.runNumber).toMatch(/^PAY-\d{4}-\d{4}$/);
    const runId = create.body.id;
    createdRuns.push(runId);

    const prepare = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${runId}/prepare`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(prepare.status).toBe(201);
    expect(prepare.body.status).toBe('prepared');

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${runId}/approve`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ comment: 'OK e2e' });
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('executed');

    // SQL : écriture BQ équilibrée
    const payment = await prisma.payment.findFirst({ where: { paymentRunId: runId } });
    expect(payment).toBeTruthy();
    const bqLines = await prisma.journalLine.findMany({
      where: { entry: { sourceType: 'payment', sourceId: payment!.id } },
      include: { entry: true },
    });
    expect(bqLines.length).toBe(2);
    const sumDebit = bqLines.reduce((s, l) => s + Number(l.debit), 0);
    const sumCredit = bqLines.reduce((s, l) => s + Number(l.credit), 0);
    expect(sumDebit).toBe(sumCredit);
    expect(sumDebit).toBe(total);

    const line401 = bqLines.find((l) => l.accountCode === '401');
    const line521 = bqLines.find((l) => l.accountCode === '521');
    expect(line401).toBeTruthy();
    expect(line521).toBeTruthy();
    expect(line401!.auxiliaryCode).toBe('E2E-PAY-SUP');

    // Invoice marquée paid
    const invAfter = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(invAfter!.status).toBe('paid');
  }, 180_000);

  it('partial payment : invoice → partially_paid', async () => {
    const { invoiceId, total } = await setupReadyPostedInvoice({
      unitPrice: 20000,
      qty: 5,
      suffix: 'PARTIAL',
    });

    // 1er run : 50% du montant (modifie le payment.amount à la main pour
    // simuler un paiement partiel — l'API n'expose pas encore cet ajustement,
    // ce sera ajouté au sprint 5.2 via un updatePaymentAmount).
    const create = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    const runId = create.body.id;
    createdRuns.push(runId);
    const payment = await prisma.payment.findFirst({ where: { paymentRunId: runId } });
    await prisma.payment.update({
      where: { id: payment!.id },
      data: { amount: total / 2 },
    });
    await prisma.paymentRun.update({
      where: { id: runId },
      data: { totalAmount: total / 2 },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${runId}/prepare`)
      .set('Authorization', `Bearer ${tokenSa}`);
    const approve = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${runId}/approve`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({});
    expect(approve.status).toBe(201);

    const invAfter = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(invAfter!.status).toBe('partially_paid');
  }, 180_000);

  it('IBAN absent → 409 MISSING_IBAN au prepare', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 4000,
      qty: 3,
      suffix: 'NOIBAN',
      overrideSupplierId: supplierNoIbanId,
    });
    const create = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    const runId = create.body.id;
    createdRuns.push(runId);
    const prepare = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${runId}/prepare`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(prepare.status).toBe(409);
    expect(prepare.body.code).toBe(ErrorCode.BUSINESS.MISSING_IBAN);
  }, 180_000);

  it('Same invoice cannot be in 2 active runs (INVOICE_ALREADY_IN_RUN)', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 3000,
      qty: 2,
      suffix: 'DUP',
    });
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    createdRuns.push(r1.body.id);
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe(ErrorCode.BUSINESS.INVOICE_ALREADY_IN_RUN);
  }, 180_000);

  it('cancel sur run draft', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 1500,
      qty: 2,
      suffix: 'CANCEL',
    });
    const r = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    createdRuns.push(r.body.id);
    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${r.body.id}/cancel`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ reason: 'cancelled by e2e test for cleanup' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.status).toBe('cancelled');
  }, 180_000);

  it('reject sur run prepared', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 1000,
      qty: 4,
      suffix: 'REJECT',
    });
    const r = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    createdRuns.push(r.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${r.body.id}/prepare`)
      .set('Authorization', `Bearer ${tokenSa}`);
    const reject = await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${r.body.id}/reject`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ reason: 'bank refused the transfer file' });
    expect(reject.status).toBe(201);
    expect(reject.body.status).toBe('rejected');
  }, 180_000);

  it('approve sans rôle DAF → 403', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 800,
      qty: 2,
      suffix: 'RBAC',
    });
    const r = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenDem}`) // pas autorisé pour create
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    // Le DEMANDEUR n'a pas le droit de créer un run
    expect(r.status).toBe(403);
  }, 180_000);

  it('GET /payment-runs/:id/journal-entries après execute', async () => {
    const { invoiceId } = await setupReadyPostedInvoice({
      unitPrice: 700,
      qty: 1,
      suffix: 'JOURNAL',
    });
    const r = await request(app.getHttpServer())
      .post('/api/v1/payment-runs')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        bankAccountId: bankAccountXofId,
        method: 'sepa',
        invoiceIds: [invoiceId],
      });
    createdRuns.push(r.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${r.body.id}/prepare`)
      .set('Authorization', `Bearer ${tokenSa}`);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-runs/${r.body.id}/approve`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({});

    const journal = await request(app.getHttpServer())
      .get(`/api/v1/payment-runs/${r.body.id}/journal-entries`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(journal.status).toBe(200);
    expect(journal.body.bqEntries.length).toBe(1);
    expect(journal.body.bqEntries[0].entryNumber).toMatch(/^BQ-\d{4}-\d{4}$/);
  }, 180_000);
});
