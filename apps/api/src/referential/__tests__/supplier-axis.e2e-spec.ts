/**
 * Tests E2E combinés Supplier + AnalyticalAxis (Sprint 1.3).
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - Suppliers : RBAC, recherche trigramme "therm", soft-delete sans PO
 *  - AnalyticalAxis : création parent + enfants, asTree=true, cycle prevention,
 *    delete bloqué par enfants, restore
 *  - Audit trail : success + denied + failed_validation
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

(STACK_UP ? describe : describe.skip)('Supplier + AnalyticalAxis (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDaf: string;
  let tokenDemandeur: string;

  const stamp = Date.now();
  const SUPPLIER_CODE = `E2E-SUP-${stamp}`;
  const AXIS_ROOT_CODE = `E2E-AXIS-${stamp}`;
  const AXIS_CHILD_CODE = `E2E-AXIS-${stamp}-CH`;

  let supplierId = '';
  let axisRootId = '';
  let axisChildId = '';

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
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.supplier.deleteMany({ where: { code: SUPPLIER_CODE } });
      await prisma.analyticalAxis.deleteMany({
        where: { code: { in: [AXIS_ROOT_CODE, AXIS_CHILD_CODE] } },
      });
    }
    if (app) await app.close();
  });

  // ----------------------------------------------------------------
  describe('Suppliers', () => {
    it('GET /suppliers without token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/suppliers');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
    });

    it('POST /suppliers as DEMANDEUR → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${tokenDemandeur}`)
        .send({ code: SUPPLIER_CODE, name: 'no' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    });

    it('POST /suppliers DAF empty body → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /suppliers DAF valid → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: SUPPLIER_CODE,
          name: 'Thermo Fisher Scientific E2E',
          country: 'USA',
          currencyDefault: 'USD',
          paymentTermsDays: 60,
        });
      expect(res.status).toBe(201);
      supplierId = res.body.id;
    });

    it('POST /suppliers with same code → 409 DUPLICATE_CODE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: SUPPLIER_CODE, name: 'dup' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.DUPLICATE_CODE);
    });

    it('GET /suppliers?q=therm returns trigram match', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?q=therm')
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((s: { code: string }) => s.code === SUPPLIER_CODE)).toBe(true);
    });

    it('POST /suppliers with invalid IBAN → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: `${SUPPLIER_CODE}-BAD`,
          name: 'Bad iban supplier',
          iban: 'GB99 WEST 1234 5698 7654 32',
        });
      expect(res.status).toBe(400);
    });

    it('DELETE /suppliers/:id as DAF → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${supplierId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });

    it('Restore inactive supplier → 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/suppliers/${supplierId}/restore`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  describe('AnalyticalAxis', () => {
    it('POST /analytical-axes root (no parent) → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytical-axes')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          type: 'cost_center',
          code: AXIS_ROOT_CODE,
          label: 'E2E root cost center',
        });
      expect(res.status).toBe(201);
      axisRootId = res.body.id;
    });

    it('POST child with wrong type → 409 AXIS_PARENT_WRONG_TYPE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytical-axes')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          type: 'activity',
          code: `${AXIS_ROOT_CODE}-WRONG`,
          label: 'wrong type child',
          parentId: axisRootId,
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.AXIS_PARENT_WRONG_TYPE);
    });

    it('POST child with same type → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytical-axes')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          type: 'cost_center',
          code: AXIS_CHILD_CODE,
          label: 'E2E child node',
          parentId: axisRootId,
        });
      expect(res.status).toBe(201);
      axisChildId = res.body.id;
    });

    it('PATCH child with parentId = own id → 409 AXIS_CYCLE', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/analytical-axes/${axisChildId}`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ parentId: axisChildId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.AXIS_CYCLE);
    });

    it('GET asTree=true returns 2-level tree containing our pair', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytical-axes?type=cost_center&asTree=true')
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      const ours = (res.body as Array<{ id: string; children: { id: string }[] }>).find(
        (n) => n.id === axisRootId,
      );
      expect(ours).toBeDefined();
      expect(ours!.children.some((c) => c.id === axisChildId)).toBe(true);
    });

    it('DELETE root with active child → 409 AXIS_HAS_CHILDREN', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/analytical-axes/${axisRootId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.AXIS_HAS_CHILDREN);
    });

    it('DELETE child first → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/analytical-axes/${axisChildId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });

    it('DELETE root after child gone → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/analytical-axes/${axisRootId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });
  });

  // ----------------------------------------------------------------
  describe('Audit trail', () => {
    it('event_log contains entries for suppliers + axes', async () => {
      const rows = await prisma.eventLog.findMany({
        where: {
          OR: [
            { action: { contains: '/api/v1/suppliers' } },
            { action: { contains: '/api/v1/analytical-axes' } },
          ],
        },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      });
      expect(rows.length).toBeGreaterThan(0);
      const results = new Set(rows.map((r) => r.result));
      expect(results.has('success')).toBe(true);
      expect(results.has('denied')).toBe(true);
      expect(results.has('failed_validation')).toBe(true);
    });
  });
});
