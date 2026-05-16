/**
 * E2E Goods Receipt — Sprint 4.1.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - PO sent → GR draft créé (lignes init à 0)
 *  - PATCH /lines avec qty partielle → 200
 *  - PATCH /lines qty > commandé → 409 GR_QTY_EXCEEDS_ORDER
 *  - POST /complete partiel → PO partially_received
 *  - PO toujours réceptionnable → 2e GR créé
 *  - POST /complete total → PO received
 *  - Cold chain : POST /lines sans batch puis complete → 409 BATCH_INFO_REQUIRED
 *  - Cold chain : coldChainOk=false → 409 COLD_CHAIN_BROKEN
 *  - Reject : status=rejected, PO reste sent
 *  - GR vide (qty=0 partout) → 409 GR_EMPTY_LINES
 *  - GET /purchase-orders/:id/remaining cohérent
 *  - Numérotation GR-YYYY-NNNN séquentielle
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

(STACK_UP ? describe : describe.skip)('Goods Receipt workflow (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem: string;
  let tokenPi: string;
  let tokenSa: string;

  let projectId = '';
  let grantId = '';
  let blId = '';
  let supplierId = '';
  const createdPos: string[] = [];
  const createdGrs: string[] = [];
  const createdPrs: string[] = [];

  async function setupPoSent(unitPrice: number, qty: number): Promise<{ poId: string; lines: Array<{ id: string; quantity: number }> }> {
    // Crée une DA + approve + BC + send
    const prRes = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `PR GR test ${unitPrice}`,
        projectId, grantId, currency: 'XOF', requestType: 'standard',
        lines: [{ description: `Item ${unitPrice}`, quantity: qty, unit: 'unit', unitPrice, budgetLineId: blId }],
      });
    if (prRes.status !== 201) throw new Error(`PR fail ${prRes.status} ${JSON.stringify(prRes.body)}`);
    const prId = prRes.body.id;
    createdPrs.push(prId);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${tokenDem}`);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${tokenPi}`)
      .send({});
    const poRes = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/from-pr/${prId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ supplierId });
    if (poRes.status !== 201) throw new Error(`PO fail ${poRes.status} ${JSON.stringify(poRes.body)}`);
    const poId = poRes.body.id;
    createdPos.push(poId);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${tokenSa}`);
    // Récupère les lignes
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`);
    return {
      poId,
      lines: detail.body.lines.map((l: { id: string; quantity: number | string }) => ({ id: l.id, quantity: Number(l.quantity) })),
    };
  }

  beforeAll(async () => {
    [tokenDem, tokenPi, tokenSa] = await Promise.all([
      getToken('amadou@pasteur.sn', 'Demandeur#2026'),
      getToken('pi@pasteur.sn', 'Pi#2026-IPD'),
      getToken('admin@pasteur.sn', 'Admin#2026'),
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
    if (!grant || grant.budgetLines.length === 0) throw new Error('No active grant in seed');
    projectId = grant.projectId;
    grantId = grant.id;
    blId = grant.budgetLines[0].id;
    await prisma.budgetLine.update({ where: { id: blId }, data: { budgetedAmount: 100_000_000 } });
    await prisma.project.update({ where: { id: projectId }, data: { piUserId: piUser.id } });

    const supplier = await prisma.supplier.upsert({
      where: { code: 'E2E-GR-SUP' },
      update: { isActive: true },
      create: {
        code: 'E2E-GR-SUP', name: 'E2E GR Supplier',
        country: 'SN', address: 'Dakar',
        paymentTermsDays: 30, currencyDefault: 'XOF', isActive: true,
      },
    });
    supplierId = supplier.id;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
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

  it('happy path : PO sent → GR draft, lignes initialisées à 0', async () => {
    const { poId } = await setupPoSent(5000, 10);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ deliveryNoteRef: 'BL-2026-0001', notes: 'livraison ok' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.grNumber).toMatch(/^GR-\d{4}-\d{4}$/);
    expect(res.body.lines.length).toBeGreaterThanOrEqual(1);
    res.body.lines.forEach((l: { quantity: string | number }) => expect(Number(l.quantity)).toBe(0));
    createdGrs.push(res.body.id);
  });

  it('PATCH /lines : qty > commandé → 409 GR_QTY_EXCEEDS_ORDER', async () => {
    const { poId, lines } = await setupPoSent(2000, 5);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr.body.id);
    const grLineId = gr.body.lines[0].id;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: grLineId, quantity: lines[0].quantity + 999 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.BUSINESS.GR_QTY_EXCEEDS_ORDER);
  });

  it('complete partiel → PO partially_received, complete final → PO received', async () => {
    const { poId, lines } = await setupPoSent(1000, 10);
    // GR 1 : 6 unités
    const gr1 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr1.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr1.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr1.body.lines[0].id, quantity: 6 }] });
    const c1 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr1.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(c1.status).toBe(201);
    expect(c1.body.poStatus).toBe('partially_received');

    // GR 2 : 4 unités → total 10 = received
    const gr2 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr2.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr2.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr2.body.lines[0].id, quantity: 4 }] });
    const c2 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr2.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(c2.status).toBe(201);
    expect(c2.body.poStatus).toBe('received');
    expect(lines).toBeDefined();
  });

  it('cold chain : sans batchNumber → 409 BATCH_INFO_REQUIRED', async () => {
    const { poId } = await setupPoSent(3000, 3);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ coldChainRequired: true });
    createdGrs.push(gr.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr.body.lines[0].id, quantity: 2 }] });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.BUSINESS.BATCH_INFO_REQUIRED);
  });

  it('cold chain : coldChainOk=false → 409 COLD_CHAIN_BROKEN', async () => {
    const { poId } = await setupPoSent(4000, 2);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ coldChainRequired: true });
    createdGrs.push(gr.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({
        lines: [{
          lineId: gr.body.lines[0].id,
          quantity: 1,
          batchNumber: 'LOT-2026-A',
          expiryDate: new Date('2027-12-31').toISOString(),
          coldChainOk: false,
        }],
      });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.BUSINESS.COLD_CHAIN_BROKEN);
  });

  it('complete sans aucune ligne reçue → 409 GR_EMPTY_LINES', async () => {
    const { poId } = await setupPoSent(2500, 2);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr.body.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.BUSINESS.GR_EMPTY_LINES);
  });

  it('reject une livraison → status rejected, PO reste sent', async () => {
    const { poId } = await setupPoSent(1500, 5);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr.body.id);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/reject`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ reason: 'colis endommagé à la livraison' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejected');
    const po = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(po.body.status).toBe('sent');
  });

  it('GET /purchase-orders/:id/remaining cohérent après complete partiel', async () => {
    const { poId } = await setupPoSent(2000, 8);
    const gr = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(gr.body.id);
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/lines`)
      .set('Authorization', `Bearer ${tokenSa}`)
      .send({ lines: [{ lineId: gr.body.lines[0].id, quantity: 3 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${gr.body.id}/complete`)
      .set('Authorization', `Bearer ${tokenSa}`);

    const rem = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${poId}/remaining`)
      .set('Authorization', `Bearer ${tokenSa}`);
    expect(rem.status).toBe(200);
    const line0 = rem.body[0];
    expect(line0.ordered).toBe(8);
    expect(line0.received).toBe(3);
    expect(line0.remaining).toBe(5);
  });

  it('Numérotation GR-YYYY-NNNN séquentielle', async () => {
    const { poId } = await setupPoSent(1200, 1);
    const grA = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(grA.body.id);
    const grB = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/from-po/${poId}`)
      .set('Authorization', `Bearer ${tokenSa}`).send({});
    createdGrs.push(grB.body.id);
    const numA = parseInt(grA.body.grNumber.split('-')[2], 10);
    const numB = parseInt(grB.body.grNumber.split('-')[2], 10);
    expect(numB).toBeGreaterThan(numA);
  });
});
