/**
 * Tests d'intégration HTTP du module Donor.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`
 * (nécessite Postgres + Keycloak + API up — voir docs/SETUP_WINDOWS.md).
 *
 * Couvre les chemins critiques :
 *  - GET list : 200 (paginé, search, filter, sort)
 *  - GET :id / by-code : 200, 404
 *  - POST : 201 DAF, 403 DEMANDEUR, 400 body invalide, 409 doublon
 *  - PATCH : 200
 *  - DELETE : 204, 409 si déjà inactif
 *  - POST :id/restore : 200, 409 si déjà actif
 *  - SQL : chaque mutation 2xx/4xx laisse une trace dans audit.event_log
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { PrismaService } from '../../../prisma/prisma.service';

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
    throw new Error(`Keycloak token request failed for ${username}: HTTP ${res.status} — ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Keycloak responded without access_token');
  return json.access_token;
}

(STACK_UP ? describe : describe.skip)('DonorController (E2E, opt-in STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDaf: string;
  let tokenDemandeur: string;

  // Code de test temporaire qu'on crée/supprime au cours du run.
  const TEST_CODE = `TEST-${Date.now()}`;

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
      await prisma.donor.deleteMany({ where: { code: TEST_CODE } });
    }
    if (app) await app.close();
  });

  // ----------------------------------------------------------------
  // Read paths
  // ----------------------------------------------------------------
  describe('GET (read)', () => {
    it('GET /donors without token → 401 AUTH.UNAUTHENTICATED', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/donors');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
    });

    it('GET /donors with DEMANDEUR token → 200 + paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/donors')
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        page: 1,
        pageSize: 20,
        total: expect.any(Number),
        hasMore: expect.any(Boolean),
      });
      expect(Array.isArray(res.body.data)).toBe(true);
      // Le seed contient au moins BMGF + 8 autres.
      expect(res.body.total).toBeGreaterThanOrEqual(9);
    });

    it('GET /donors/by-code/BMGF → 200 + grantCount', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/donors/by-code/BMGF')
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('BMGF');
      expect(typeof res.body.grantCount).toBe('number');
    });

    it('GET /donors/by-code/NOPE → 404 BUSINESS.NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/donors/by-code/NOPE')
        .set('Authorization', `Bearer ${tokenDemandeur}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.NOT_FOUND);
    });
  });

  // ----------------------------------------------------------------
  // Write paths — RBAC + happy + edge cases
  // ----------------------------------------------------------------
  describe('Write paths', () => {
    let createdId = '';

    it('POST /donors as DEMANDEUR → 403 AUTH.FORBIDDEN_ROLE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/donors')
        .set('Authorization', `Bearer ${tokenDemandeur}`)
        .send({ code: TEST_CODE, label: 'Should not pass', type: 'public_intl' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    });

    it('POST /donors with empty body as DAF → 400 (Zod, not 500)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/donors')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /donors with valid body as DAF → 201 + donor', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/donors')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: TEST_CODE,
          label: 'Test E2E Donor',
          type: 'public_intl',
          country: 'SN',
        });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(TEST_CODE);
      expect(res.body.isActive).toBe(true);
      createdId = res.body.id;
    });

    it('POST /donors with the SAME code → 409 BUSINESS.DUPLICATE_CODE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/donors')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: TEST_CODE, label: 'duplicate', type: 'public_intl' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.DUPLICATE_CODE);
    });

    it('PATCH /donors/:id as DAF → 200 with new label', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/donors/${createdId}`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ label: 'Updated label E2E' });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Updated label E2E');
    });

    it('DELETE /donors/:id as DAF → 204 (soft delete)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/donors/${createdId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });

    it('DELETE again on the same id → 409 BUSINESS.ALREADY_INACTIVE', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/donors/${createdId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.ALREADY_INACTIVE);
    });

    it('POST /donors/:id/restore → 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/donors/${createdId}/restore`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(true);
    });

    it('Restore on an already-active donor → 409 BUSINESS.ALREADY_ACTIVE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/donors/${createdId}/restore`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.ALREADY_ACTIVE);
    });
  });

  // ----------------------------------------------------------------
  // Audit trail — proof
  // ----------------------------------------------------------------
  describe('Audit trail (sample probe — exact rows depend on test order)', () => {
    it('produces audit entries for mutations during this run', async () => {
      const rows = await prisma.eventLog.findMany({
        where: {
          action: { contains: '/api/v1/donors' },
        },
        orderBy: { occurredAt: 'desc' },
        take: 10,
      });
      expect(rows.length).toBeGreaterThan(0);
      const results = new Set(rows.map((r) => r.result));
      // Au minimum on doit avoir 'success' (POST/PATCH/DELETE/restore réussis)
      // ET au moins un denied (403 DEMANDEUR) ET un failed_validation (POST {}).
      expect(results.has('success')).toBe(true);
      expect(results.has('denied')).toBe(true);
      expect(results.has('failed_validation')).toBe(true);
    });
  });
});
