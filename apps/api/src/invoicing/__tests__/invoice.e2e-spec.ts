/**
 * E2E Invoicing (capture + matching 3-way) — Sprint 4.2a.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - Upload PDF fixture (via pdfkit en RAM) → status captured, payload OCR
 *    pré-rempli (n° facture, totaux).
 *  - Création manuelle → status captured.
 *  - submit avec écart prix → status exception_price.
 *  - submit OK (BC + GR cohérents) → status matched + match_summary.details.
 *  - force-match (DAF) → status matched + match_summary.forcedMatch tracé.
 *  - Tentative de submit sans poId → 409 INVOICE_NO_PO_LINKED.
 *  - Duplicate (même supplier+invoice_number) → 409.
 *  - reject → status rejected.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { AppModule } from '../../app.module';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

const STACK_UP = process.env.STACK_UP === '1';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

async function getToken(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: 'grantflow-web', grant_type: 'password', username, password,
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

/** Fabrique un PDF facture minimaliste en mémoire. */
function buildInvoicePdf(opts: {
  invoiceNumber: string;
  totalHt: number;
  totalTtc: number;
  poNumber?: string;
}): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument();
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text(`Facture n° ${opts.invoiceNumber}`);
    doc.text('Date facture : 14/05/2026');
    doc.text('Échéance : 13/06/2026');
    doc.text(`Total HT  : ${opts.totalHt} XOF`);
    doc.text(`Total TTC : ${opts.totalTtc} XOF`);
    if (opts.poNumber) doc.text(`Votre BC : ${opts.poNumber}`);
    doc.end();
  });
}

(STACK_UP ? describe : describe.skip)('Invoicing workflow (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem: string;
  let tokenPi: string;
  let tokenSa: string;
  let tokenDaf: string;

  let projectId = '';
  let grantId = '';
  let blId = '';
  let supplierId = '';
  const createdInvoices: string[] = [];
  const createdPos: string[] = [];
  const createdPrs: string[] = [];
  const createdGrs: string[] = [];

  /** Crée un PR + approve + PO + send + GR complete pour rendre matching possible. */
  async function setupReadyChain(unitPrice: number, qty: number): Promise<{ poId: string; poNumber: string }> {
    const pr = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `PR INV E2E ${unitPrice}`,
        projectId, grantId, currency: 'XOF', requestType: 'standard',
        lines: [{ description: `Article ${unitPrice}`, quantity: qty, unit: 'unit', unitPrice, budgetLineId: blId }],
      });
    if (pr.status !== 201) throw new Error(`PR fail: ${pr.status}`);
    const prId = pr.body.id;
    createdPrs.push(prId);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${tokenDem}`);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${tokenPi}`).send({});
    const po = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/from-pr/${prId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({ supplierId });
    const poId = po.body.id;
    createdPos.push(poId);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${tokenSa}`);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr.body.lines[0].id, quantity: qty }] });
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    return { poId, poNumber: po.body.poNumber };
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
    await prisma.budgetLine.update({ where: { id: blId }, data: { budgetedAmount: 100_000_000 } });
    await prisma.project.update({ where: { id: projectId }, data: { piUserId: piUser.id } });

    const supplier = await prisma.supplier.upsert({
      where: { code: 'E2E-INV-SUP' },
      update: { isActive: true },
      create: {
        code: 'E2E-INV-SUP', name: 'E2E Invoice Supplier',
        country: 'SN', address: 'Dakar',
        paymentTermsDays: 30, currencyDefault: 'XOF', isActive: true,
      },
    });
    supplierId = supplier.id;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      if (createdInvoices.length) {
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

  it('upload PDF → status captured + payload OCR pré-rempli', async () => {
    const pdf = await buildInvoicePdf({ invoiceNumber: 'INV-E2E-001', totalHt: 100000, totalTtc: 118000 });
    const res = await request(app.getHttpServer())
      .post('/api/v1/invoices/upload')
      .set('Authorization', `Bearer ${tokenSa}`)
      .field('supplierId', supplierId)
      .attach('file', pdf, 'inv-001.pdf');
    expect([200, 201]).toContain(res.status);
    expect(res.body.invoice.status).toBe('captured');
    expect(res.body.invoice.invoiceNumber).toBe('INV-E2E-001');
    expect(Number(res.body.invoice.totalTtc)).toBe(118000);
    expect(res.body.ocr.confidence).toBeGreaterThan(50);
    createdInvoices.push(res.body.invoice.id);
  });

  it('createManual + submit OK (3-way OK) → status matched', async () => {
    const { poId } = await setupReadyChain(5000, 10);
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-OK-${Date.now()}`,
        supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', poId,
        totalHt: 50000, totalVat: 0, totalTtc: 50000,
        lines: [{ lineNumber: 1, description: 'Article 5000', quantity: 10, unitPrice: 5000, lineTotal: 50000 }],
      });
    expect(inv.status).toBe(201);
    createdInvoices.push(inv.body.id);
    const submit = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/submit`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(submit.status).toBe(201);
    expect(submit.body.invoice.status).toBe('matched');
    expect(submit.body.outcome.summary.totalLinesMatched).toBe(1);
  });

  it('submit avec écart prix > 2% → status exception_price', async () => {
    const { poId } = await setupReadyChain(5000, 10);
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-PRX-${Date.now()}`,
        supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', poId,
        totalHt: 60000, totalVat: 0, totalTtc: 60000,
        lines: [{ lineNumber: 1, description: 'Article', quantity: 10, unitPrice: 6000, lineTotal: 60000 }],
      });
    createdInvoices.push(inv.body.id);
    const submit = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/submit`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(submit.body.invoice.status).toBe('exception_price');
    expect(submit.body.outcome.summary.priceVarianceMax).toBeCloseTo(20, 1);
  });

  it('force-match DAF → status matched + forcedMatch tracé', async () => {
    const { poId } = await setupReadyChain(5000, 10);
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-FORCE-${Date.now()}`,
        supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', poId,
        totalHt: 55000, totalVat: 0, totalTtc: 55000,
        lines: [{ lineNumber: 1, description: 'Article', quantity: 10, unitPrice: 5500, lineTotal: 55000 }],
      });
    createdInvoices.push(inv.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/submit`)
      .set('Authorization', `Bearer ${tokenSa}`);
    const forced = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/force-match`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ reason: 'remise commerciale validée hors-contrat' });
    expect(forced.status).toBe(201);
    expect(forced.body.status).toBe('matched');
    expect(forced.body.matchSummary.forcedMatch.reason).toBe('remise commerciale validée hors-contrat');
  });

  it('submit sans poId → 409 INVOICE_NO_PO_LINKED', async () => {
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-NOPO-${Date.now()}`,
        supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', totalHt: 100, totalVat: 0, totalTtc: 100,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 100 }],
      });
    createdInvoices.push(inv.body.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/submit`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.BUSINESS.INVOICE_NO_PO_LINKED);
  });

  it('duplicate (même supplier + invoice_number) → 409', async () => {
    const num = `INV-DUP-${Date.now()}`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: num, supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', totalHt: 100, totalVat: 0, totalTtc: 100,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 100 }],
      });
    createdInvoices.push(first.body.id);
    const dup = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: num, supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', totalHt: 100, totalVat: 0, totalTtc: 100,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 100 }],
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe(ErrorCode.BUSINESS.INVOICE_DUPLICATE_NUMBER);
  });

  it('reject une facture captured → status rejected', async () => {
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        invoiceNumber: `INV-REJ-${Date.now()}`,
        supplierId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: 'XOF', totalHt: 100, totalVat: 0, totalTtc: 100,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 100 }],
      });
    createdInvoices.push(inv.body.id);
    const rej = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${inv.body.id}/reject`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ reason: 'service jamais rendu' });
    expect(rej.status).toBe(201);
    expect(rej.body.status).toBe('rejected');
  });
});
