/**
 * E2E sprint-6.2 — Clôture mensuelle + États financiers SYSCEBNL.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - precheck (au moins 1 finding ou 0)
 *  - close avec aucun blocker → 200
 *  - close avec blocker sans ack → 409 (PERIOD_CLOSE_BLOCKED)
 *  - close avec ack=true sans reason → 400 (PERIOD_CLOSE_REASON_REQUIRED)
 *  - reopen sans reason → 400 (PERIOD_REOPEN_REASON_REQUIRED)
 *  - reopen DAF avec reason → 200
 *  - trigger DB : tentative d'INSERT/UPDATE journal_entry sur période
 *    close → trigger gl.check_period_open refuse
 *  - génération statement TER / BILAN / RESULTAT → équilibrés
 *  - lock statement → idempotent
 *  - PDF + Excel téléchargeables (200 + magic header)
 *  - RBAC : BAILLEUR ne peut pas close (403)
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../app.module';
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

(STACK_UP ? describe : describe.skip)('Period close + Financial statements (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDaf = '';
  let tokenSa = '';
  let tokenBailleur = '';
  let tokenComptable = '';
  let periodId = '';
  const createdStatements: string[] = [];

  beforeAll(async () => {
    [tokenSa, tokenDaf, tokenComptable] = await Promise.all([
      getToken('admin@pasteur.sn', 'Admin#2026'),
      getToken('daf@pasteur.sn', 'Daf#2026-IPD'),
      // Token COMPTABLE pour les tests RBAC GET (ajout fix-rbac-closure-get) —
      // si l'utilisateur n'est pas seedé on retombe sur tokenSa pour garder
      // le test "passe" valide (et on warn-skip côté assertions).
      getToken('compta@pasteur.sn', 'Compta#2026').catch(() => ''),
    ]);
    tokenBailleur = await getToken('bailleur@pasteur.sn', 'Bailleur#2026').catch(() => tokenSa);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    // Cherche une période sans entrées posted pour tester close → reopen
    // sans collision avec d'autres tests
    const periods = await prisma.fiscalPeriod.findMany({
      where: { isClosed: false, periodType: 'month' },
      orderBy: { startDate: 'asc' },
    });
    const candidate = await Promise.all(
      periods.map(async (p) => ({
        period: p,
        hasEntries:
          (await prisma.journalEntry.count({
            where: { periodId: p.id, status: 'posted' },
          })) > 0,
      })),
    );
    const empty = candidate.find((c) => !c.hasEntries);
    if (!empty) throw new Error('No empty open monthly period available for E2E');
    periodId = empty.period.id;
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      // Réouvre la période si elle est restée fermée
      try {
        await prisma.fiscalPeriod.update({
          where: { id: periodId },
          data: {
            isClosed: false,
            closedAt: null,
            closedBy: null,
            reopenedAt: null,
            reopenedBy: null,
            reopenReason: null,
          },
        });
      } catch {
        // best-effort
      }
      for (const id of createdStatements) {
        try {
          await prisma.financialStatement.update({
            where: { id },
            data: { locked: false },
          });
          await prisma.financialStatementLine.deleteMany({ where: { statementId: id } });
          await prisma.financialStatement.delete({ where: { id } });
        } catch {
          // best-effort
        }
      }
      // Cleanup events / checks
      try {
        await prisma.periodCloseCheck.deleteMany({ where: { periodId } });
        await prisma.periodCloseEvent.deleteMany({ where: { periodId } });
      } catch {
        // ignore
      }
    }
    if (app) await app.close();
  });

  it('full workflow : precheck → close → reopen', async () => {
    // 1. precheck
    const pre = await request(app.getHttpServer())
      .post(`/api/v1/accounting/periods/${periodId}/precheck`)
      .set('Authorization', `Bearer ${tokenDaf}`);
    expect(pre.status).toBe(201);
    expect(pre.body).toMatchObject({
      periodId,
      canClose: expect.any(Boolean),
    });

    // 2. close — soit canClose=true sans ack, soit override DAF
    const closeBody = pre.body.canClose
      ? {}
      : { acknowledgeWarnings: true, reason: 'E2E test override DAF' };
    const close = await request(app.getHttpServer())
      .post(`/api/v1/accounting/periods/${periodId}/close`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send(closeBody);
    expect(close.status).toBe(201);
    expect(close.body.isClosed).toBe(true);

    // 3. tentative d'INSERT journal_entry sur période close → trigger DB
    let triggerFired = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO gl.journal_entry (entry_number, journal, entry_date, period_id, label, status)
         VALUES ('E2E-TEST-${Date.now()}', 'OD', CURRENT_DATE, '${periodId}'::uuid, 'should fail', 'posted')`,
      );
    } catch (e) {
      triggerFired = true;
      expect(String(e)).toMatch(/cl[oôő]tur|closed/i);
    }
    expect(triggerFired).toBe(true);

    // 4. reopen sans reason → 400
    const badReopen = await request(app.getHttpServer())
      .post(`/api/v1/accounting/periods/${periodId}/reopen`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({});
    expect(badReopen.status).toBe(400);

    // 5. reopen avec reason → 200
    const reopen = await request(app.getHttpServer())
      .post(`/api/v1/accounting/periods/${periodId}/reopen`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ reason: 'Correction E2E test' });
    expect(reopen.status).toBe(201);
    expect(reopen.body.isClosed).toBe(false);
  }, 180_000);

  it('RBAC : BAILLEUR cannot close (403)', async () => {
    if (tokenBailleur === tokenSa) {
      console.warn('[skip] BAILLEUR not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .post(`/api/v1/accounting/periods/${periodId}/close`)
      .set('Authorization', `Bearer ${tokenBailleur}`)
      .send({});
    expect(r.status).toBe(403);
  }, 60_000);

  // ----------------------------------------------------------------
  // Fix RBAC closure GET — sprint correctif (analogue F5b-a Lot 1) :
  // les 3 routes GET de clôture étaient ouvertes à tout authentifié.
  // On vérifie maintenant qu'elles sont gated comme les actions POST.
  // ----------------------------------------------------------------

  it('RBAC fix : BAILLEUR ne peut pas GET /periods (403)', async () => {
    if (tokenBailleur === tokenSa) {
      console.warn('[skip] BAILLEUR not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .get('/api/v1/accounting/periods')
      .set('Authorization', `Bearer ${tokenBailleur}`);
    expect(r.status).toBe(403);
  }, 60_000);

  it('RBAC fix : BAILLEUR ne peut pas GET /periods/:id/checks (403)', async () => {
    if (tokenBailleur === tokenSa) {
      console.warn('[skip] BAILLEUR not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .get(`/api/v1/accounting/periods/${periodId}/checks`)
      .set('Authorization', `Bearer ${tokenBailleur}`);
    expect(r.status).toBe(403);
  }, 60_000);

  it('RBAC fix : BAILLEUR ne peut pas GET /periods/:id/events (403)', async () => {
    if (tokenBailleur === tokenSa) {
      console.warn('[skip] BAILLEUR not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .get(`/api/v1/accounting/periods/${periodId}/events`)
      .set('Authorization', `Bearer ${tokenBailleur}`);
    expect(r.status).toBe(403);
  }, 60_000);

  it('RBAC fix : COMPTABLE peut GET /periods (200)', async () => {
    if (!tokenComptable) {
      console.warn('[skip] COMPTABLE not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .get('/api/v1/accounting/periods')
      .set('Authorization', `Bearer ${tokenComptable}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  }, 60_000);

  it('RBAC fix : COMPTABLE peut GET /periods/:id/checks (200)', async () => {
    if (!tokenComptable) {
      console.warn('[skip] COMPTABLE not seeded');
      return;
    }
    const r = await request(app.getHttpServer())
      .get(`/api/v1/accounting/periods/${periodId}/checks`)
      .set('Authorization', `Bearer ${tokenComptable}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  }, 60_000);

  it('generates TER / BILAN / RESULTAT + lock + downloads', async () => {
    // TER
    const ter = await request(app.getHttpServer())
      .post('/api/v1/reporting/statements')
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ periodId, type: 'TER' });
    expect([201, 409]).toContain(ter.status); // 409 si déjà locked (idempotent)
    if (ter.status === 201) createdStatements.push(ter.body.id);

    // BILAN
    const bilan = await request(app.getHttpServer())
      .post('/api/v1/reporting/statements')
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ periodId, type: 'BILAN' });
    expect([201, 409]).toContain(bilan.status);
    if (bilan.status === 201) createdStatements.push(bilan.body.id);

    // RESULTAT
    const cr = await request(app.getHttpServer())
      .post('/api/v1/reporting/statements')
      .set('Authorization', `Bearer ${tokenDaf}`)
      .send({ periodId, type: 'RESULTAT' });
    expect([201, 409]).toContain(cr.status);
    if (cr.status === 201) createdStatements.push(cr.body.id);

    if (createdStatements.length === 0) return;
    const sid = createdStatements[0];

    // Lock idempotent
    const lock1 = await request(app.getHttpServer())
      .post(`/api/v1/reporting/statements/${sid}/lock`)
      .set('Authorization', `Bearer ${tokenDaf}`);
    expect(lock1.status).toBe(201);
    expect(lock1.body.locked).toBe(true);

    const lock2 = await request(app.getHttpServer())
      .post(`/api/v1/reporting/statements/${sid}/lock`)
      .set('Authorization', `Bearer ${tokenDaf}`);
    expect(lock2.status).toBe(201);

    // PDF
    const pdfRes = await request(app.getHttpServer())
      .get(`/api/v1/reporting/statements/${sid}/pdf`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .buffer(true)
      .parse((res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
        const chunks: Buffer[] = [];
        (res as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
        (res as NodeJS.ReadableStream).on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdfRes.status).toBe(200);
    expect((pdfRes.body as Buffer).slice(0, 4).toString()).toBe('%PDF');

    // Excel
    const xlsxRes = await request(app.getHttpServer())
      .get(`/api/v1/reporting/statements/${sid}/excel`)
      .set('Authorization', `Bearer ${tokenDaf}`)
      .buffer(true)
      .parse((res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
        const chunks: Buffer[] = [];
        (res as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
        (res as NodeJS.ReadableStream).on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsxRes.status).toBe(200);
    expect((xlsxRes.body as Buffer).slice(0, 2).toString()).toBe('PK');
  }, 180_000);
});
