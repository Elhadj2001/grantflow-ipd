import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

/**
 * Smoke test du graphe DI complet.
 *
 *  - Détecte les wiring cassés (APP_GUARD mal référencés, dépendance
 *    cyclique, provider manquant) — situation que les tests unitaires
 *    isolés ne couvrent pas.
 *  - N'instancie volontairement PAS l'application HTTP (pas d'`init()`)
 *    pour éviter de déclencher `PrismaService.$connect()` et `JwksClient`
 *    (qui nécessiteraient Postgres + Keycloak up).
 *
 * Si ce test échoue, c'est probablement le signe d'un import incorrect
 * ou d'un APP_GUARD/APP_INTERCEPTOR mal câblé dans `auth.module.ts`.
 */
describe('AppModule (smoke / DI)', () => {
  const originalEnv = { ...process.env };
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // Stubs minimaux pour que les constructors @Injectable utilisant
    // ConfigService.getOrThrow ne plantent pas (JwtStrategy notamment).
    process.env.KEYCLOAK_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'grantflow';
    process.env.KEYCLOAK_CLIENT_ID = 'grantflow-api';
    process.env.DATABASE_URL = 'postgresql://stub:stub@localhost:5432/stub?schema=public';
    process.env.JWT_SECRET = 'smoke-test-secret';

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
    process.env = originalEnv;
  });

  it('compiles — full DI graph resolved without errors', () => {
    expect(moduleRef).toBeDefined();
  });

  it('resolves both guard classes (JwtAuthGuard + RolesGuard) — proof they are providers', () => {
    // APP_GUARD est un token Nest spécial non résolvable directement.
    // Vérifier la résolution par classe suffit : si les classes ne sont
    // pas dans le tableau `providers` de AuthModule, `get()` lève.
    // L'ordre d'enregistrement (Jwt avant Roles) est garanti par le code
    // source de `auth.module.ts` — un test runtime de l'ordre nécessiterait
    // un vrai pipeline HTTP, ce qui sort du scope smoke.
    expect(moduleRef.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(moduleRef.get(RolesGuard)).toBeInstanceOf(RolesGuard);
  });

  it('resolves AuditLogInterceptor as a provider (APP_INTERCEPTOR target)', () => {
    expect(moduleRef.get(AuditLogInterceptor)).toBeInstanceOf(AuditLogInterceptor);
  });
});
