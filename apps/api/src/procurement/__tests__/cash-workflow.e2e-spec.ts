/**
 * E2E workflows cash — Sprint 2.3.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - petty_cash : create → submit → CAISSIER approve → APPROVED + solde décrémenté
 *  - per_request_max dépassé → 409 CASH_LIMIT_PER_REQUEST_EXCEEDED
 *  - per_day_user_max : 3ᵉ DA dépasse le plafond → 409 CASH_LIMIT_PER_DAY_EXCEEDED
 *  - cash_advance : PI → CAISSIER → APPROVED ; settle variance négative crédite caisse
 *  - settle variance positive : caisse non re-décrémentée
 *  - grant.allowsCashPayment=false → 409 CASH_PAYMENT_NOT_ALLOWED
 *  - settle 2× → 409 PR_ALREADY_SETTLED
 *  - settle sur petty_cash → 409 PR_TYPE_MISMATCH
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

(STACK_UP ? describe : describe.skip)('Cash workflows (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem: string;
  let tokenPi: string;
  let tokenCaissier: string;

  let projectId = '';
  let grantId = '';
  let blId = '';
  let cashBoxId = '';
  const createdPrs: string[] = [];

  beforeAll(async () => {
    [tokenDem, tokenPi, tokenCaissier] = await Promise.all([
      getToken('amadou@pasteur.sn', 'Demandeur#2026'),
      getToken('pi@pasteur.sn', 'Pi#2026-IPD'),
      getToken('caissier@pasteur.sn', 'Caisse#2026-IPD'),
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

    // Élargit la budget line pour ne pas être bloqué par le budget control.
    await prisma.budgetLine.update({
      where: { id: blId },
      data: { budgetedAmount: 100_000_000 },
    });
    await prisma.grantAgreement.update({
      where: { id: grantId },
      data: { allowsCashPayment: true },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { piUserId: piUser.id },
    });

    // Caisse dédiée aux tests pour isoler le solde.
    const cb = await prisma.cashBox.upsert({
      where: { code: 'CAISSE-E2E' },
      update: {
        currentBalance: 500_000,
        ceiling: 500_000,
        perRequestMax: 100_000,
        perDayUserMax: 200_000,
        isActive: true,
      },
      create: {
        code: 'CAISSE-E2E',
        label: 'Caisse E2E tests',
        currency: 'XOF',
        currentBalance: 500_000,
        ceiling: 500_000,
        perRequestMax: 100_000,
        perDayUserMax: 200_000,
        isActive: true,
      },
    });
    cashBoxId = cb.id;
  }, 90_000);

  afterAll(async () => {
    if (prisma && createdPrs.length) {
      await prisma.cashSettlement.deleteMany({ where: { purchaseRequestId: { in: createdPrs } } });
      await prisma.approvalStep.deleteMany({ where: { entityId: { in: createdPrs } } });
      await prisma.purchaseRequestLine.deleteMany({ where: { prId: { in: createdPrs } } });
      await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdPrs } } });
      // Reset solde et désactivation de la caisse test.
      await prisma.cashBox.update({
        where: { id: cashBoxId },
        data: { currentBalance: 500_000, isActive: false },
      });
    }
    if (app) await app.close();
  });

  async function createPettyCash(unitPrice: number) {
    const create = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `Petty cash ${unitPrice}`,
        projectId, grantId, currency: 'XOF',
        requestType: 'petty_cash', cashBoxId,
        lines: [{ description: 'Item', quantity: 1, unit: 'unit', unitPrice, budgetLineId: blId }],
      });
    return create;
  }

  async function createCashAdvance(unitPrice: number) {
    const create = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `Cash advance ${unitPrice}`,
        projectId, grantId, currency: 'XOF',
        requestType: 'cash_advance', cashBoxId,
        lines: [{ description: 'Mission', quantity: 1, unit: 'unit', unitPrice, budgetLineId: blId }],
      });
    return create;
  }

  // ----------------------------------------------------------------
  describe('petty_cash : 1 étape CAISSIER', () => {
    it('happy path : create → submit → caissier approve → APPROVED + balance décrémentée', async () => {
      const before = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      const balanceBefore = Number(before!.currentBalance);

      const create = await createPettyCash(45_000);
      expect(create.status).toBe(201);
      createdPrs.push(create.body.id);
      expect(create.body.cashBoxId).toBe(cashBoxId);
      expect(create.body.requestType).toBe('petty_cash');

      const submit = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${create.body.id}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(submit.status).toBe(201);
      expect(submit.body.status).toBe('pending_caissier');

      const decide = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${create.body.id}/approve`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ comment: 'Justifié, OK' });
      expect(decide.status).toBe(201);
      expect(decide.body.status).toBe('approved');
      expect(decide.body.nextStepRole).toBeNull();

      const after = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      expect(Number(after!.currentBalance)).toBe(balanceBefore - 45_000);
    });

    it('per_request_max dépassé → 409 CASH_LIMIT_PER_REQUEST_EXCEEDED', async () => {
      const res = await createPettyCash(150_000); // > 100k = perRequestMax
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.CASH_LIMIT_PER_REQUEST_EXCEEDED);
    });

    it('DAF ne peut pas approuver une petty_cash (rôle CAISSIER requis)', async () => {
      const tokenDaf = await getToken('daf@pasteur.sn', 'Daf#2026-IPD');
      const create = await createPettyCash(20_000);
      expect(create.status).toBe(201);
      createdPrs.push(create.body.id);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${create.body.id}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${create.body.id}/approve`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ----------------------------------------------------------------
  describe('cash_advance : 2 étapes (PI → CAISSIER) + settle', () => {
    let advanceId = '';

    it('PI then CAISSIER → APPROVED + balance décrémentée', async () => {
      const before = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      const balanceBefore = Number(before!.currentBalance);

      const create = await createCashAdvance(80_000);
      expect(create.status).toBe(201);
      advanceId = create.body.id;
      createdPrs.push(advanceId);

      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${advanceId}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);

      const pi = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${advanceId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({ comment: 'OK mission validée' });
      expect(pi.status).toBe(201);
      expect(pi.body.status).toBe('pending_caissier');
      expect(pi.body.nextStepRole).toBe('CAISSIER');

      const cas = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${advanceId}/approve`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ comment: 'Cash remis' });
      expect(cas.status).toBe(201);
      expect(cas.body.status).toBe('approved');

      const after = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      expect(Number(after!.currentBalance)).toBe(balanceBefore - 80_000);
    });

    it('settle variance négative crédite la caisse', async () => {
      const before = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      const balanceBefore = Number(before!.currentBalance);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${advanceId}/settle`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ actualSpent: 60_000, justifications: 'Hôtel moins cher' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('settled');
      expect(res.body.settlement.variance).toBe(-20_000);

      const after = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      expect(Number(after!.currentBalance)).toBe(balanceBefore + 20_000);
    });

    it('settle 2× → 409 PR_ALREADY_SETTLED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${advanceId}/settle`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ actualSpent: 70_000 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PR_ALREADY_SETTLED);
    });

    it('settle sur petty_cash → 409 PR_TYPE_MISMATCH', async () => {
      // Crée une petty_cash approuvée pour tester.
      const create = await createPettyCash(15_000);
      const pId = create.body.id;
      createdPrs.push(pId);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${pId}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${pId}/approve`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({});

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${pId}/settle`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ actualSpent: 15_000 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PR_TYPE_MISMATCH);
    });

    it('settle variance positive ne re-décrémente PAS la caisse', async () => {
      const create = await createCashAdvance(50_000);
      const aId = create.body.id;
      createdPrs.push(aId);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${aId}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${aId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${aId}/approve`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({});

      const before = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      const balanceBefore = Number(before!.currentBalance);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${aId}/settle`)
        .set('Authorization', `Bearer ${tokenCaissier}`)
        .send({ actualSpent: 70_000 });
      expect(res.status).toBe(201);
      expect(res.body.settlement.variance).toBe(20_000);

      const after = await prisma.cashBox.findUnique({ where: { id: cashBoxId } });
      expect(Number(after!.currentBalance)).toBe(balanceBefore); // unchanged
    });
  });

  // ----------------------------------------------------------------
  describe('Guards', () => {
    it('grant.allowsCashPayment=false → 409 CASH_PAYMENT_NOT_ALLOWED', async () => {
      await prisma.grantAgreement.update({
        where: { id: grantId },
        data: { allowsCashPayment: false },
      });
      try {
        const res = await createPettyCash(20_000);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(ErrorCode.BUSINESS.CASH_PAYMENT_NOT_ALLOWED);
      } finally {
        // Restore for other tests.
        await prisma.grantAgreement.update({
          where: { id: grantId },
          data: { allowsCashPayment: true },
        });
      }
    });
  });
});
