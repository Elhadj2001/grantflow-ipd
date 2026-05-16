/**
 * Tests E2E combinés Project + Grant + BudgetLine.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`
 * (nécessite Postgres + Keycloak + DDL appliqué — voir docs/SETUP_WINDOWS.md).
 *
 * Couvre :
 *  - Projects : GET 200, POST 201/403/400/409, DELETE → 409 si grant actif
 *  - Grants : GET, POST avec donor/project actifs, dashboard
 *  - BudgetLines : CRUD scoped sous /grants/:grantId/budget-lines, import xlsx
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { AppModule } from '../../app.module';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

const STACK_UP = process.env.STACK_UP === '1';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

async function getAccessToken(username: string, password: string): Promise<string> {
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak token failed for ${username}: ${res.status} — ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('No access_token');
  return json.access_token;
}

(STACK_UP ? describe : describe.skip)('Project + Grant + BudgetLine (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDaf: string;
  let tokenDemandeur: string;

  const stamp = Date.now();
  const PROJECT_CODE = `E2E-PRJ-${stamp}`;
  const GRANT_REF = `E2E-GR-${stamp}`;

  let donorId = '';
  let projectId = '';
  let grantId = '';

  beforeAll(async () => {
    [tokenDaf, tokenDemandeur] = await Promise.all([
      getAccessToken('daf@pasteur.sn', 'Daf#2026-IPD'),
      getAccessToken('amadou@pasteur.sn', 'Demandeur#2026'),
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    // On a besoin d'un donor actif réel pour créer un grant.
    const donor = await prisma.donor.findFirst({ where: { isActive: true } });
    if (!donor) throw new Error('Pas de donor actif en seed — impossible de tester');
    donorId = donor.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      // Cascade : delete grants → budget_line(cascade) → project last.
      await prisma.budgetLine.deleteMany({ where: { grant: { reference: GRANT_REF } } });
      await prisma.grantAgreement.deleteMany({ where: { reference: GRANT_REF } });
      await prisma.project.deleteMany({ where: { code: PROJECT_CODE } });
    }
    if (app) await app.close();
  });

  // ----------------------------------------------------------------
  describe('Projects', () => {
    it('GET /projects without token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/projects');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
    });

    it('POST /projects as DEMANDEUR → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenDemandeur}`)
        .send({ code: PROJECT_CODE, title: 'No', startDate: '2026-01-01' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    });

    it('POST /projects empty body → 400 (Zod)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /projects valid → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: PROJECT_CODE,
          title: 'E2E project under sprint-1.2',
          startDate: '2026-01-01',
          endDate: '2028-12-31',
          status: 'active',
        });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(PROJECT_CODE);
      projectId = res.body.id;
    });

    it('POST same code → 409 BUSINESS.DUPLICATE_CODE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: PROJECT_CODE, title: 'dup', startDate: '2026-01-01' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.DUPLICATE_CODE);
    });

    it('GET /projects/by-code/:code → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/by-code/${PROJECT_CODE}`)
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(PROJECT_CODE);
      expect(typeof res.body.grantCount).toBe('number');
    });
  });

  // ----------------------------------------------------------------
  describe('Grants', () => {
    it('POST /grants valid → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/grants')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          reference: GRANT_REF,
          donorId,
          projectId,
          amount: '500000',
          currency: 'USD',
          overheadRate: 0.15,
          startDate: '2026-01-01',
          endDate: '2027-12-31',
          status: 'active',
        });
      expect(res.status).toBe(201);
      grantId = res.body.id;
    });

    it('POST /grants with inactive project → 409 BUSINESS.INACTIVE_PROJECT', async () => {
      // On crée un projet, on le ferme, puis on tente d'y rattacher un grant.
      const closedProjectRes = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: `${PROJECT_CODE}-CLOSED`,
          title: 'Closed project for inactive test',
          startDate: '2026-01-01',
          status: 'closed',
        });
      const closedProjectId = closedProjectRes.body.id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/grants')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          reference: `${GRANT_REF}-X`,
          donorId,
          projectId: closedProjectId,
          amount: '1000',
          currency: 'XOF',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.INACTIVE_PROJECT);

      // cleanup
      await prisma.project.deleteMany({ where: { id: closedProjectId } });
    });

    it('GET /grants/:id/dashboard → 200 with totals (zero before any budget line)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/grants/${grantId}/dashboard`)
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body.grantRef).toBe(GRANT_REF);
      expect(res.body.totalBudgeted).toBe(0);
      expect(Array.isArray(res.body.byBudgetLine)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  describe('Project soft-delete protection', () => {
    it('DELETE /projects/:id while active grant exists → 409 PROJECT_HAS_ACTIVE_GRANTS', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PROJECT_HAS_ACTIVE_GRANTS);
    });
  });

  // ----------------------------------------------------------------
  describe('Budget lines', () => {
    let createdLineId = '';

    it('POST .../budget-lines valid → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/grants/${grantId}/budget-lines`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: 'L01',
          label: 'Consommables labo',
          budgetedAmount: '38000',
          isOverheadEligible: true,
        });
      expect(res.status).toBe(201);
      createdLineId = res.body.id;
    });

    it('POST overflow → 409 BUDGET_LINES_EXCEED_GRANT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/grants/${grantId}/budget-lines`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: 'L-OVER',
          label: 'Way too big',
          budgetedAmount: '600000',
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.BUDGET_LINES_EXCEED_GRANT);
    });

    it('POST bulk xlsx with 5 valid rows → 201/200 created=5', async () => {
      const ws = XLSX.utils.json_to_sheet([
        { code: 'L02', label: 'Personnel', budgeted_amount: 120000, is_overhead_eligible: true },
        { code: 'L03', label: 'Equipement', budgeted_amount: 80000, is_overhead_eligible: true },
        { code: 'L04', label: 'Voyages internationaux', budgeted_amount: 25000, is_overhead_eligible: true },
        { code: 'L05', label: 'Formation et ateliers', budgeted_amount: 40000, is_overhead_eligible: true },
        { code: 'L06', label: 'Coordination scientifique', budgeted_amount: 30000, is_overhead_eligible: true },
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/grants/${grantId}/budget-lines/bulk`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .attach('file', buffer, { filename: 'lines.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(res.body.created).toBe(5);
      expect(res.body.errors).toEqual([]);
    });

    it('GET .../budget-lines → 200 with 6 active lines', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/grants/${grantId}/budget-lines`)
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(6);
    });

    it('GET dashboard after bulk → totals match', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/grants/${grantId}/dashboard`)
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      // 38000 + 120000 + 80000 + 25000 + 40000 + 30000 = 333000
      expect(res.body.totalBudgeted).toBe(333000);
      expect(res.body.byBudgetLine).toHaveLength(6);
    });

    it('DELETE budget-line without usage → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/grants/${grantId}/budget-lines/${createdLineId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });

    it('Restore inactive → 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/grants/${grantId}/budget-lines/${createdLineId}/restore`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  describe('Audit trail', () => {
    it('event_log contains entries for projects/grants/budget-lines mutations', async () => {
      const rows = await prisma.eventLog.findMany({
        where: {
          OR: [
            { action: { contains: '/api/v1/projects' } },
            { action: { contains: '/api/v1/grants' } },
          ],
        },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      });
      expect(rows.length).toBeGreaterThan(0);
      const results = new Set(rows.map((r) => r.result));
      expect(results.has('success')).toBe(true);
      expect(results.has('denied')).toBe(true);
    });
  });
});
