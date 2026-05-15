import { AuthController } from '../auth.controller';
import { AuthenticatedUserDto } from '../dto/authenticated-user.dto';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Test unitaire pur — pas besoin de TestingModule, le controller n'a
 * aucune dépendance injectée. L'objectif est de vérifier que la
 * réponse n'expose QUE les 4 champs publics (id, email, fullName, roles)
 * — pas de fuite de claim Keycloak (exp, iat, azp, realm_access…).
 */
describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
  });

  const user: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'pi@pasteur.sn',
    fullName: 'Dr SARR',
    roles: ['PI'],
  };

  it('returns an AuthenticatedUserDto instance', () => {
    const result = controller.me(user);
    expect(result).toBeInstanceOf(AuthenticatedUserDto);
  });

  it('exposes only id / email / fullName / roles — no Keycloak internals leak', () => {
    const result = controller.me(user);
    expect(Object.keys(result).sort()).toEqual(['email', 'fullName', 'id', 'roles']);
  });

  it('preserves all 4 fields verbatim from the authenticated user', () => {
    const result = controller.me(user);
    expect(result.id).toBe(user.id);
    expect(result.email).toBe(user.email);
    expect(result.fullName).toBe(user.fullName);
    expect(result.roles).toEqual(user.roles);
  });

  it('rejects any extra claim injected into the user object', () => {
    // Cas pathologique : si JwtStrategy retourne accidentellement un objet
    // avec des champs en trop (extension future incorrecte), le DTO doit
    // les ignorer pour empêcher la fuite.
    const userWithExtra = {
      ...user,
      exp: 1234567890,
      realm_access: { roles: ['hidden-role'] },
      tokenInternals: 'should-not-leak',
    } as unknown as AuthenticatedUser;
    const result = controller.me(userWithExtra);
    expect(result).not.toHaveProperty('exp');
    expect(result).not.toHaveProperty('realm_access');
    expect(result).not.toHaveProperty('tokenInternals');
  });
});
