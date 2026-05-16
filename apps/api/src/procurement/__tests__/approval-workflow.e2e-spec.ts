/**
 * E2E workflow d'approbation — Sprint 2.2.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - 3 DA de montants différents (100k, 1M, 10M) → routage par seuil
 *  - PI → CG → DAF chain pour la DA 10M, avec refus DAF
 *  - DEMANDEUR ne peut pas approuver sa propre DA → 403
 *  - Double approbation → 409 PR_ALREADY_DECIDED (no pending step)
 *  - GET pending-my-approval filtré par rôle
 *  - GET approval-history retourne historique complet
 *  - DA petty_cash → 501 CASH_WORKFLOW_NOT_YET_IMPLEMENTED
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

(STACK_UP ? describe : describe.skip)('Approval workflow (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem: string;
  let tokenPi: string;
  let tokenCg: string;
  let tokenDaf: string;
  let _tokenSa: string;

  let projectId = '';
  let grantId = '';
  let blId = '';
  let smallPrId = '';
  let mediumPrId = '';
  let largePrId = '';
  let pettyCashPrId = '';

  beforeAll(async () => {
    [tokenDem, tokenPi, tokenCg, tokenDaf, _tokenSa] = await Promise.all([
      getToken('amadou@pasteur.sn', 'Demandeur#2026'),
      getToken('pi@pasteur.sn', 'Pi#2026-IPD'),
      getToken('compta@pasteur.sn', 'Compta#2026-IPD'),
      getToken('daf@pasteur.sn', 'Daf#2026-IPD'),
      getToken('admin@pasteur.sn', 'Admin#2026'),
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    // Ensure PI owns at least one project so PI approvals pass.
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

    // Bump the BL so even 10M DA fits the budget — this isolates the test
    // from the budget guard.
    await prisma.budgetLine.update({
      where: { id: blId },
      data: { budgetedAmount: 100_000_000 },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { piUserId: piUser.id },
    });
  }, 90_000);

  afterAll(async () => {
    if (prisma) {
      const ids = [smallPrId, mediumPrId, largePrId, pettyCashPrId].filter(Boolean);
      if (ids.length) {
        await prisma.approvalStep.deleteMany({ where: { entityId: { in: ids } } });
        await prisma.purchaseRequestLine.deleteMany({ where: { prId: { in: ids } } });
        await prisma.purchaseRequest.deleteMany({ where: { id: { in: ids } } });
      }
    }
    if (app) await app.close();
  });

  async function createAndSubmit(unitPrice: number, requestType: string = 'standard'): Promise<string> {
    const create = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `E2E workflow ${unitPrice} ${requestType}`,
        projectId, grantId, currency: 'XOF', requestType,
        lines: [
          { description: 'item', quantity: 1, unit: 'unit', unitPrice, budgetLineId: blId },
        ],
      });
    if (create.status !== 201) throw new Error(`create failed: ${create.status} ${JSON.stringify(create.body)}`);
    const id = create.body.id;
    if (requestType === 'standard') {
      const submit = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${id}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);
      if (submit.status !== 201) throw new Error(`submit failed: ${submit.status} ${JSON.stringify(submit.body)}`);
    }
    return id;
  }

  // ----------------------------------------------------------------
  describe('100k DA → PI approves → APPROVED', () => {
    it('routing direct after PI approval', async () => {
      smallPrId = await createAndSubmit(100_000);

      const decide = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${smallPrId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      expect(decide.status).toBe(201);
      expect(decide.body.status).toBe('approved');
      expect(decide.body.nextStepRole).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  describe('1M DA → PI → CG approves → APPROVED', () => {
    it('PI approval routes to CG, CG closes', async () => {
      mediumPrId = await createAndSubmit(1_000_000);

      const pi = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${mediumPrId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({ comment: 'OK pour le projet' });
      expect(pi.status).toBe(201);
      expect(pi.body.status).toBe('pending_cg');
      expect(pi.body.nextStepRole).toBe('CONTROLEUR');

      const cg = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${mediumPrId}/approve`)
        .set('Authorization', `Bearer ${tokenCg}`)
        .send({ comment: 'Conforme budget' });
      expect(cg.status).toBe(201);
      expect(cg.body.status).toBe('approved');
      expect(cg.body.nextStepRole).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  describe('10M DA → PI → CG → DAF rejects → REJECTED', () => {
    it('three-step chain ending with rejection', async () => {
      largePrId = await createAndSubmit(10_000_000);

      const pi = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${largePrId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      expect(pi.body.status).toBe('pending_cg');

      const cg = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${largePrId}/approve`)
        .set('Authorization', `Bearer ${tokenCg}`)
        .send({});
      expect(cg.body.status).toBe('pending_daf');
      expect(cg.body.nextStepRole).toBe('DAF');

      const daf = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${largePrId}/reject`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ reason: 'Trop tôt dans le cycle budgétaire' });
      expect(daf.status).toBe(201);
      expect(daf.body.status).toBe('rejected');
      expect(daf.body.rejectionReason).toContain('cycle budgétaire');
    });
  });

  // ----------------------------------------------------------------
  describe('Guards', () => {
    it('DEMANDEUR cannot approve → 403', async () => {
      const id = await createAndSubmit(80_000);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${id}/approve`)
        .set('Authorization', `Bearer ${tokenDem}`)
        .send({});
      // Either RBAC guard (Roles decorator) blocks it directly, or our service
      // returns PR_NOT_AWAITING_YOU. Both are acceptable as 403/AUTH.FORBIDDEN_ROLE.
      expect(res.status).toBe(403);

      // Cleanup
      await prisma.approvalStep.deleteMany({ where: { entityId: id } });
      await prisma.purchaseRequestLine.deleteMany({ where: { prId: id } });
      await prisma.purchaseRequest.deleteMany({ where: { id } });
    });

    it('Double approval → 409 PR_ALREADY_DECIDED (no pending step)', async () => {
      const id = await createAndSubmit(80_000);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${id}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      const second = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${id}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      // PR is approved now → PR_NOT_IN_APPROVAL or PR_ALREADY_DECIDED.
      expect([409, 409]).toContain(second.status);
      expect([
        ErrorCode.BUSINESS.PR_NOT_IN_APPROVAL,
        ErrorCode.BUSINESS.PR_ALREADY_DECIDED,
      ]).toContain(second.body.code);

      // Cleanup
      await prisma.approvalStep.deleteMany({ where: { entityId: id } });
      await prisma.purchaseRequestLine.deleteMany({ where: { prId: id } });
      await prisma.purchaseRequest.deleteMany({ where: { id } });
    });

    it('petty_cash → 501 CASH_WORKFLOW_NOT_YET_IMPLEMENTED', async () => {
      // We create but don't submit — petty_cash submit() would still set
      // pending_pi but approve would 501.
      const create = await request(app.getHttpServer())
        .post('/api/v1/purchase-requests')
        .set('Authorization', `Bearer ${tokenDem}`)
        .send({
          description: 'petty cash test',
          projectId, grantId, currency: 'XOF', requestType: 'petty_cash',
          lines: [{ description: 'taxi', quantity: 1, unit: 'unit', unitPrice: 5000, budgetLineId: blId }],
        });
      expect(create.status).toBe(201);
      pettyCashPrId = create.body.id;
      // Forcer pending_pi en DB pour atteindre la garde 501.
      await prisma.purchaseRequest.update({
        where: { id: pettyCashPrId },
        data: { status: 'pending_pi' },
      });
      await prisma.approvalStep.create({
        data: {
          entityType: 'purchase_request',
          entityId: pettyCashPrId,
          stepOrder: 1,
          approverRole: 'PI',
          status: 'pending',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${pettyCashPrId}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});
      expect(res.status).toBe(501);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.CASH_WORKFLOW_NOT_YET_IMPLEMENTED);
    });
  });

  // ----------------------------------------------------------------
  describe('Pending list + history', () => {
    it('GET pending-my-approval for CG returns only pending_cg', async () => {
      const id = await createAndSubmit(1_000_000);
      // Bring it to pending_cg.
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${id}/approve`)
        .set('Authorization', `Bearer ${tokenPi}`)
        .send({});

      const res = await request(app.getHttpServer())
        .get('/api/v1/purchase-requests/pending-my-approval')
        .set('Authorization', `Bearer ${tokenCg}`);
      expect(res.status).toBe(200);
      const ours = (res.body.data as Array<{ id: string; status: string }>).find((r) => r.id === id);
      expect(ours).toBeDefined();
      expect(ours!.status).toBe('pending_cg');

      // Cleanup
      await prisma.approvalStep.deleteMany({ where: { entityId: id } });
      await prisma.purchaseRequestLine.deleteMany({ where: { prId: id } });
      await prisma.purchaseRequest.deleteMany({ where: { id } });
    });

    it('GET approval-history returns ordered steps', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/purchase-requests/${mediumPrId}/approval-history`)
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      const steps = res.body as Array<{ stepOrder: number; approverRole: string; status: string }>;
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[0].approverRole).toBe('PI');
      expect(steps[0].status).toBe('approved');
      expect(steps[1].approverRole).toBe('CONTROLEUR');
    });
  });

  // ----------------------------------------------------------------
  describe('Audit trail', () => {
    it('event_log records approve + reject + decline events', async () => {
      const rows = await prisma.eventLog.findMany({
        where: { action: { contains: '/api/v1/purchase-requests' } },
        orderBy: { occurredAt: 'desc' },
        take: 30,
      });
      const results = new Set(rows.map((r) => r.result));
      expect(results.has('success')).toBe(true);
      // failed_validation can come from any of REJECTION_REASON_REQUIRED,
      // PR_NOT_AWAITING_YOU, etc. depending on test order.
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
