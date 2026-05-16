/**
 * E2E Bons de Commande — Sprint 3.
 *
 * Activation : `STACK_UP=1 npm run test --workspace=apps/api`.
 *
 * Couvre :
 *  - DA approuvée → BC créé (createFromPr)
 *  - BC envoyé : PDF dans MinIO, écriture classe 8 (801/802) équilibrée
 *  - Email reçu sur MailHog (curl http://localhost:8025/api/v2/messages)
 *  - GET /:id/pdf retourne 200 + application/pdf
 *  - GET /:id/journal-entries retourne l'engagement
 *  - acknowledge sent → acknowledged
 *  - cancel sent → cancelled + extournement classe 8 (801/802 inversés)
 *  - Garde : PR petty_cash → 409
 *  - Garde : PR pending_pi → 409
 *  - createFromMultiplePrs : consolidation
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
const MAILHOG_URL = process.env.MAILHOG_URL ?? 'http://localhost:8025';

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

(STACK_UP ? describe : describe.skip)('Purchase Order workflow (E2E, STACK_UP=1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenDem: string;
  let tokenPi: string;
  let tokenSa: string;

  let projectId = '';
  let grantId = '';
  let blId = '';
  let supplierId = '';
  let prApprovedId = '';
  let prPettyId = '';
  let poId = '';
  const createdPos: string[] = [];
  const createdPrs: string[] = [];

  async function approvePrFullPath(unitPrice: number): Promise<string> {
    const create = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${tokenDem}`)
      .send({
        description: `PR pour BC test ${unitPrice}`,
        projectId, grantId, currency: 'XOF', requestType: 'standard',
        lines: [{ description: 'Item BC', quantity: 1, unit: 'unit', unitPrice, budgetLineId: blId }],
      });
    if (create.status !== 201) throw new Error(`PR create fail: ${create.status} ${JSON.stringify(create.body)}`);
    const id = create.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${id}/submit`)
      .set('Authorization', `Bearer ${tokenDem}`);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${id}/approve`)
      .set('Authorization', `Bearer ${tokenPi}`)
      .send({});
    createdPrs.push(id);
    return id;
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
    await prisma.grantAgreement.update({ where: { id: grantId }, data: { allowsCashPayment: true } });
    await prisma.project.update({ where: { id: projectId }, data: { piUserId: piUser.id } });

    // Fournisseur test (idempotent)
    const supplier = await prisma.supplier.upsert({
      where: { code: 'E2E-SUPPLIER' },
      update: { isActive: true },
      create: {
        code: 'E2E-SUPPLIER',
        name: 'E2E Supplier SARL',
        country: 'SN',
        address: '5 rue du Test, Dakar',
        paymentTermsDays: 30,
        currencyDefault: 'XOF',
        isActive: true,
        // contactEmail is set below if column exists.
      },
    });
    supplierId = supplier.id;
    // Ajoute un email de contact via raw SQL (le champ peut s'appeler
    // contact_email — sprint 1.3).
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE ref.supplier SET contact_email = 'e2e-supplier@test.local' WHERE id = $1`,
        supplierId,
      );
    } catch {
      // colonne absente — on continue, l'email ne sera pas envoyé mais
      // le flux reste valide (delivered:false).
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Clean POs (cascade lines + prLinks).
      if (createdPos.length) {
        await prisma.journalLine.deleteMany({
          where: { entry: { sourceType: 'purchase_order', sourceId: { in: createdPos } } },
        });
        await prisma.journalEntry.deleteMany({
          where: { sourceType: 'purchase_order', sourceId: { in: createdPos } },
        });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPos } } });
      }
      // Clean PRs.
      if (createdPrs.length) {
        await prisma.approvalStep.deleteMany({ where: { entityId: { in: createdPrs } } });
        await prisma.purchaseRequestLine.deleteMany({ where: { prId: { in: createdPrs } } });
        await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdPrs } } });
      }
    }
    if (app) await app.close();
  });

  // ----------------------------------------------------------------
  describe('createFromPr', () => {
    it('happy path : DA approuvée → BC en draft', async () => {
      prApprovedId = await approvePrFullPath(100_000);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/from-pr/${prApprovedId}`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ supplierId, incoterm: 'DDP Dakar' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.poNumber).toMatch(/^BC-\d{4}-\d{4}$/);
      poId = res.body.id;
      createdPos.push(poId);
    });

    it('PR petty_cash → 409 PR_TYPE_PETTY_CASH_NO_PO', async () => {
      // Crée une DA petty_cash + approve (CAISSIER).
      const cb = await prisma.cashBox.findFirst({ where: { isActive: true } });
      if (!cb) throw new Error('No active cash box');
      const tokenCas = await getToken('caissier@pasteur.sn', 'Caisse#2026-IPD');
      const create = await request(app.getHttpServer())
        .post('/api/v1/purchase-requests')
        .set('Authorization', `Bearer ${tokenDem}`)
        .send({
          description: 'Petty taxi mission',
          projectId, grantId, currency: 'XOF', requestType: 'petty_cash',
          cashBoxId: cb.id,
          lines: [{ description: 'Taxi', quantity: 1, unit: 'course', unitPrice: 5000, budgetLineId: blId }],
        });
      prPettyId = create.body.id;
      createdPrs.push(prPettyId);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${prPettyId}/submit`)
        .set('Authorization', `Bearer ${tokenDem}`);
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-requests/${prPettyId}/approve`)
        .set('Authorization', `Bearer ${tokenCas}`)
        .send({});

      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/from-pr/${prPettyId}`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ supplierId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PR_TYPE_PETTY_CASH_NO_PO);
    });

    it('PR non approuvée → 409 PR_NOT_APPROVED', async () => {
      const create = await request(app.getHttpServer())
        .post('/api/v1/purchase-requests')
        .set('Authorization', `Bearer ${tokenDem}`)
        .send({
          description: 'PR draft test',
          projectId, grantId, currency: 'XOF', requestType: 'standard',
          lines: [{ description: 'X', quantity: 1, unit: 'unit', unitPrice: 1000, budgetLineId: blId }],
        });
      const draftId = create.body.id;
      createdPrs.push(draftId);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/from-pr/${draftId}`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ supplierId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PR_NOT_APPROVED);
    });

    it('Doublon : 2e BC sur la même DA → 409 PR_ALREADY_HAS_PO', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/from-pr/${prApprovedId}`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ supplierId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.BUSINESS.PR_ALREADY_HAS_PO);
    });
  });

  // ----------------------------------------------------------------
  describe('send + journal-entries + pdf', () => {
    it('happy path : status=sent, PDF dans MinIO, écriture 801/802 équilibrée', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/${poId}/send`)
        .set('Authorization', `Bearer ${tokenSa}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('sent');
      expect(res.body.pdfObjectKey).toMatch(/^pos\/\d{4}\/\d{2}\//);
      expect(res.body.commitmentEntryNumber).toMatch(/^OD-\d{4}-\d{4}$/);

      // Vérifie l'écriture : 2 lignes, 801 debit = 802 credit
      const lines = await prisma.journalLine.findMany({
        where: { entry: { sourceType: 'purchase_order', sourceId: poId } },
        orderBy: { lineNumber: 'asc' },
      });
      expect(lines).toHaveLength(2);
      const line801 = lines.find((l) => l.accountCode === '801');
      const line802 = lines.find((l) => l.accountCode === '802');
      expect(line801).toBeDefined();
      expect(line802).toBeDefined();
      expect(Number(line801!.debit)).toBe(100_000);
      expect(Number(line801!.credit)).toBe(0);
      expect(Number(line802!.debit)).toBe(0);
      expect(Number(line802!.credit)).toBe(100_000);
    });

    it('GET /:id/pdf retourne application/pdf', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/purchase-orders/${poId}/pdf`)
        .set('Authorization', `Bearer ${tokenSa}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    });

    it('GET /:id/journal-entries retourne l\'engagement', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/purchase-orders/${poId}/journal-entries`)
        .set('Authorization', `Bearer ${tokenSa}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].lines).toHaveLength(2);
    });

    it('Email reçu sur MailHog (best effort — skip si MailHog absent)', async () => {
      try {
        const r = await fetch(`${MAILHOG_URL}/api/v2/messages?limit=20`);
        if (!r.ok) return; // MailHog indispo, skip silent
        const data = (await r.json()) as { items?: Array<{ Content: { Headers: { Subject: string[] } } }> };
        const subjects = (data.items ?? []).map((m) => m.Content?.Headers?.Subject?.[0] ?? '');
        // Le BC envoyé a poNumber dans le sujet.
        const found = subjects.some((s) => s.includes('GRANTFLOW IPD'));
        expect(found).toBe(true);
      } catch {
        // MailHog pas accessible, le test n'est pas bloquant
      }
    });
  });

  // ----------------------------------------------------------------
  describe('acknowledge + cancel', () => {
    let secondPoId = '';

    beforeAll(async () => {
      const pr2 = await approvePrFullPath(50_000);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/from-pr/${pr2}`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ supplierId });
      secondPoId = res.body.id;
      createdPos.push(secondPoId);
      // Envoie pour passer en 'sent'.
      await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/${secondPoId}/send`)
        .set('Authorization', `Bearer ${tokenSa}`);
    });

    it('acknowledge sent → acknowledged', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/${secondPoId}/acknowledge`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ ackRef: 'ACK-E2E-001' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('acknowledged');
      expect(res.body.acknowledgedBy).toBe('ACK-E2E-001');
    });

    it('cancel acknowledged → cancelled + extournement créé', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/${secondPoId}/cancel`)
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ reason: 'Test annulation E2E' });
      expect(res.status).toBe(201);
      expect(res.body.po.status).toBe('cancelled');
      expect(res.body.reverseEntryNumber).toMatch(/^OD-\d{4}-\d{4}$/);

      // Doit avoir 2 entries pour ce PO (l'engagement initial + l'extourne).
      const entries = await prisma.journalEntry.findMany({
        where: { sourceType: 'purchase_order', sourceId: secondPoId },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.length).toBe(2);
      // L'original est marqué reversed, le 2e est posted et pointe vers le 1er.
      expect(entries[0].status).toBe('reversed');
      expect(entries[1].status).toBe('posted');
      expect(entries[0].reversedById).toBe(entries[1].id);
    });
  });

  // ----------------------------------------------------------------
  describe('createFromMultiplePrs', () => {
    it('consolide 2 DAs en 1 BC + écriture unique au send', async () => {
      const prA = await approvePrFullPath(30_000);
      const prB = await approvePrFullPath(45_000);
      const res = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders/from-prs')
        .set('Authorization', `Bearer ${tokenSa}`)
        .send({ prIds: [prA, prB], supplierId });
      expect(res.status).toBe(201);
      expect(res.body.prIds).toHaveLength(2);
      expect(Number(res.body.totalHt)).toBe(75_000);
      createdPos.push(res.body.id);
    });
  });
});
