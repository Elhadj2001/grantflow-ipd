/**
 * Tests d'intégration HTTP réels pour le pipeline auth + RBAC.
 *
 * Tous SKIPPED tant que la stack n'est pas démarrée localement (Keycloak
 * doit servir un JWKS valide). Activation :
 *
 *   1. `docker compose up -d`
 *   2. Attendre Keycloak healthy + import du realm
 *   3. Retirer le `.skip` ci-dessous
 *
 * Sprint suivant : créer des helpers qui obtiennent un access_token via
 * Direct Access Grant (utiliser les utilisateurs de docker/keycloak/realm.json,
 * ex: amadou@pasteur.sn / Demandeur#2026 pour DEMANDEUR, daf@pasteur.sn pour DAF).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ErrorCode } from '../../common/exceptions/error-codes';

// TODO: enable when stack is running (docker compose up + Keycloak realm imported)
describe.skip('Auth & RBAC — integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/me without token → 401 AUTH.UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.AUTH.UNAUTHENTICATED);
  });

  it('GET /auth/me with expired token → 401 AUTH.EXPIRED_TOKEN', async () => {
    // TODO: obtenir un token via Keycloak puis attendre son expiration,
    // ou injecter un token signé avec exp passé via clé KEY de test.
    const expiredJwt = 'PLACEHOLDER_EXPIRED_TOKEN';
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredJwt}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.AUTH.EXPIRED_TOKEN);
  });

  it('GET /auth/me with valid token → 200 + profile (id, email, fullName, roles)', async () => {
    // TODO: appeler /realms/grantflow/protocol/openid-connect/token (password grant)
    // avec amadou@pasteur.sn / Demandeur#2026 pour récupérer un access_token.
    const validJwt = 'PLACEHOLDER_VALID_TOKEN';
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${validJwt}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
      fullName: expect.any(String),
      roles: expect.arrayContaining(['DEMANDEUR']),
    });
  });

  it('POST /purchase-requests without DEMANDEUR/PI/SUPER_ADMIN role → 403 AUTH.FORBIDDEN_ROLE', async () => {
    // TODO: utiliser un token d'un user BAILLEUR (read-only, pas de rôle mutatif).
    const bailleurJwt = 'PLACEHOLDER_BAILLEUR_TOKEN';
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${bailleurJwt}`)
      .send({
        description: 'tentative refusée',
        projectId: '00000000-0000-0000-0000-000000000000',
        grantId: '00000000-0000-0000-0000-000000000000',
        currency: 'XOF',
        lines: [
          {
            description: 'fixture',
            quantity: 1,
            unit: 'unit',
            unitPrice: 100,
            budgetLineId: '00000000-0000-0000-0000-000000000000',
          },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
  });
});
