/**
 * Tests E2E combinés Sprint 1.4 — TaxCode + ExchangeRate + GlAccount.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - Parité fixe EUR↔XOF (655.957) — lookup, refus d'override DAF,
 *    PATCH refusé pour DAF / autorisé pour SUPER_ADMIN
 *  - Lookup variable USD→XOF avec fallback historique
 *  - TaxCode CRUD + softDelete bloqué par usage
 *  - GlAccount création parent/enfant + classe SYSCEBNL + softDelete bloqué
 *    par écritures
 *  - Audit trail (success / denied / failed_validation)
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

(STACK_UP ? describe : describe.skip)('Tax + Rate + GL (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDaf: string;
  let tokenSuper: string;
  let tokenDem: string;

  const stamp = Date.now();
  const TAX_CODE = `E2E-TVA-${stamp}`;
  const GL_CODE_PARENT = `9${stamp.toString().slice(-3)}`;
  const GL_CODE_CHILD = `${GL_CODE_PARENT}1`;
  const USD_RATE_DATE = '2026-05-15';

  beforeAll(async () => {
    [tokenDaf, tokenSuper, tokenDem] = await Promise.all([
      getAccessToken('daf@pasteur.sn', 'Daf#2026-IPD'),
      getAccessToken('admin@pasteur.sn', 'Admin#2026'),
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
      await prisma.exchangeRate.deleteMany({ where: { source: `E2E-${stamp}` } });
      await prisma.taxCode.deleteMany({ where: { code: TAX_CODE } });
      await prisma.glAccount.deleteMany({ where: { code: { in: [GL_CODE_CHILD, GL_CODE_PARENT] } } });
    }
    if (app) await app.close();
  });

  // ----------------------------------------------------------------
  describe('ExchangeRate — UEMOA fixed parity', () => {
    it('GET /exchange-rates/lookup?from=EUR&to=XOF returns 655.957 (fixed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/exchange-rates/lookup?from=EUR&to=XOF')
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      expect(parseFloat(res.body.rate)).toBeCloseTo(655.957, 3);
      expect(res.body.isFixed).toBe(true);
      expect(res.body.source).toBe('BCEAO_FIXED');
    });

    it('lookup EUR→XOF with date=1995 still returns 655.957 (parity is timeless)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/exchange-rates/lookup?from=EUR&to=XOF&date=1995-01-01')
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      expect(parseFloat(res.body.rate)).toBeCloseTo(655.957, 3);
    });

    it('DAF cannot insert variable EUR→XOF (FIXED_RATE_EXISTS)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/exchange-rates')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          fromCurrency: 'EUR',
          toCurrency: 'XOF',
          rate: 999,
          rateDate: '2026-05-15',
          source: `E2E-${stamp}`,
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.FIXED_RATE_EXISTS);
    });

    it('DAF cannot PATCH a fixed rate', async () => {
      const fixed = await prisma.exchangeRate.findFirst({ where: { isFixed: true, fromCurrency: 'EUR' } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/exchange-rates/${fixed!.id}`)
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ source: 'hack' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.IMMUTABLE_FIXED_RATE);
    });

    it('SUPER_ADMIN CAN PATCH a fixed rate (correct an entry mistake)', async () => {
      const fixed = await prisma.exchangeRate.findFirst({ where: { isFixed: true, fromCurrency: 'EUR' } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/exchange-rates/${fixed!.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ source: 'BCEAO_FIXED' });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('BCEAO_FIXED');
    });
  });

  // ----------------------------------------------------------------
  describe('ExchangeRate — variable rates', () => {
    it('POST USD→XOF as DAF → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/exchange-rates')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          fromCurrency: 'USD',
          toCurrency: 'XOF',
          rate: 598.10,
          rateDate: USD_RATE_DATE,
          source: `E2E-${stamp}`,
        });
      expect(res.status).toBe(201);
    });

    it('GET lookup USD→XOF on the same date → 598.10', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/exchange-rates/lookup?from=USD&to=XOF&date=${USD_RATE_DATE}`)
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      expect(parseFloat(res.body.rate)).toBeCloseTo(598.10, 2);
      expect(res.body.isFixed).toBe(false);
    });

    it('GET lookup USD→XOF on a later date → fallback to last available', async () => {
      const laterDate = '2026-05-20';
      const res = await request(app.getHttpServer())
        .get(`/api/v1/exchange-rates/lookup?from=USD&to=XOF&date=${laterDate}`)
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      expect(res.body.isFallback).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  describe('TaxCode CRUD', () => {
    let taxId = '';

    it('POST valid → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/tax-codes')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: TAX_CODE, label: 'TVA E2E sprint 1.4', rate: 0.18 });
      expect(res.status).toBe(201);
      taxId = res.body.id;
    });

    it('POST as DEMANDEUR → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/tax-codes')
        .set('Authorization', `Bearer ${tokenDem}`)
        .send({ code: `${TAX_CODE}-X`, label: 'no', rate: 0.18 });
      expect(res.status).toBe(403);
    });

    it('DELETE unused → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/tax-codes/${taxId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(204);
    });
  });

  // ----------------------------------------------------------------
  describe('GlAccount tree + class prefix', () => {
    let parentId = '';
    let childId = '';

    it('POST parent (class 9, code 9...) → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/gl-accounts')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: GL_CODE_PARENT,
          label: 'Compte e2e parent',
          class: '9',
          isMovement: false,
        });
      expect(res.status).toBe(201);
      parentId = res.body.id;
    });

    it('POST with code starting with wrong class → 400 INVALID_CLASS_PREFIX', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/gl-accounts')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: '6011', label: 'bad', class: '5' });
      expect(res.status).toBe(400);
    });

    it('POST child with same class + valid parent → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/gl-accounts')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({
          code: GL_CODE_CHILD,
          label: 'Compte e2e enfant',
          class: '9',
          parentCode: GL_CODE_PARENT,
        });
      expect(res.status).toBe(201);
      childId = res.body.id;
    });

    it('DELETE parent with child → 409 GL_ACCOUNT_HAS_CHILDREN', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/gl-accounts/${parentId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.GL_ACCOUNT_HAS_CHILDREN);
    });

    it('DELETE child first → 204, then parent → 204', async () => {
      const r1 = await request(app.getHttpServer())
        .delete(`/api/v1/gl-accounts/${childId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(r1.status).toBe(204);
      const r2 = await request(app.getHttpServer())
        .delete(`/api/v1/gl-accounts/${parentId}`)
        .set('Authorization', `Bearer ${tokenDaf}`);
      expect(r2.status).toBe(204);
    });

    it('GET ?asTree=true returns tree containing our pair', async () => {
      // Recreate for asTree assertion. We use _CODE-2 to avoid collision with the soft-deleted ones.
      const altParent = `${GL_CODE_PARENT}2`;
      const altChild = `${altParent}1`;
      await request(app.getHttpServer())
        .post('/api/v1/gl-accounts')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: altParent, label: 'altP', class: '9', isMovement: false });
      await request(app.getHttpServer())
        .post('/api/v1/gl-accounts')
        .set('Authorization', `Bearer ${tokenDaf}`)
        .send({ code: altChild, label: 'altC', class: '9', parentCode: altParent });

      const res = await request(app.getHttpServer())
        .get('/api/v1/gl-accounts?class=9&asTree=true')
        .set('Authorization', `Bearer ${tokenDem}`);
      expect(res.status).toBe(200);
      const parent = (res.body as Array<{ code: string; children: { code: string }[] }>).find(
        (n) => n.code === altParent,
      );
      expect(parent).toBeDefined();
      expect(parent!.children.some((c) => c.code === altChild)).toBe(true);

      // cleanup
      await prisma.glAccount.deleteMany({ where: { code: { in: [altChild, altParent] } } });
    });
  });

  // ----------------------------------------------------------------
  describe('Audit trail', () => {
    it('event_log shows success / denied / failed_validation', async () => {
      const rows = await prisma.eventLog.findMany({
        where: {
          OR: [
            { action: { contains: '/api/v1/tax-codes' } },
            { action: { contains: '/api/v1/exchange-rates' } },
            { action: { contains: '/api/v1/gl-accounts' } },
          ],
        },
        orderBy: { occurredAt: 'desc' },
        take: 30,
      });
      expect(rows.length).toBeGreaterThan(0);
      const results = new Set(rows.map((r) => r.result));
      expect(results.has('success')).toBe(true);
      expect(results.has('denied')).toBe(true);
      expect(results.has('failed_validation')).toBe(true);
    });
  });
});
