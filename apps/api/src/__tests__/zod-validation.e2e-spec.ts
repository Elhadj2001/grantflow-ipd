/**
 * Test d'intégration ciblé sur la `ZodValidationPipe` globale (sprint-1 B).
 *
 * Activation : exécuter avec la stack lancée :
 *   docker compose up -d            # postgres + keycloak + redis + minio
 *   STACK_UP=1 npm run test --workspace=apps/api
 *
 * Sans `STACK_UP=1`, le `describe` est skippé → la CI reste verte sans
 * dépendance docker.
 *
 * Couvre uniquement le cas critique du sprint-1 :
 *   POST /api/v1/purchase-requests avec body vide → 400, pas 500.
 *
 * Le test obtient un access_token via Direct Access Grant sur le client
 * `grantflow-web` (utilisateur DEMANDEUR seedé dans realm.json). Cf.
 * docker/keycloak/realm.json L182-189.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../app.module';

const STACK_UP = process.env.STACK_UP === '1';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const TOKEN_USERNAME = 'amadou@pasteur.sn';
const TOKEN_PASSWORD = 'Demandeur#2026';

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: 'grantflow-web',
    grant_type: 'password',
    username: TOKEN_USERNAME,
    password: TOKEN_PASSWORD,
  });
  const res = await fetch(`${KEYCLOAK_URL}/realms/grantflow/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak token request failed: HTTP ${res.status} — ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Keycloak responded without access_token');
  }
  return json.access_token;
}

(STACK_UP ? describe : describe.skip)('ZodValidationPipe (E2E, opt-in STACK_UP=1)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    token = await getAccessToken();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /purchase-requests with empty body → 400 (NOT 500)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    // Le body Zod-validation expose au minimum une indication d'erreurs structurées.
    expect(res.body).toBeDefined();
  });
});
