/**
 * Sprint F-ADMIN-USERS Lot C — tests api client admin/users.
 *
 * On mock `apiFetch` : pas de vrai HTTP. Vérifie URL + méthode + body
 * + accessToken pour chaque endpoint. La forme de la réponse côté wire
 * est testée côté backend.
 */
import {
  activateAdminUser,
  createAdminUser,
  deactivateAdminUser,
  getAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setUserRoles,
  updateAdminUser,
  type CreateAdminUserInput,
  type ListAdminUsersQuery,
  type UpdateAdminUserInput,
} from '../admin-users';

jest.mock('../../api-client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../api-client';
const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({} as never);
});

const opts = { accessToken: 'TOKEN-XYZ' };
const userId = '11111111-2222-3333-4444-555555555555';

describe('lib/api/admin-users — Lecture', () => {
  it('listAdminUsers sans query → GET /admin/users', async () => {
    await listAdminUsers({}, opts);
    expect(apiFetchMock).toHaveBeenCalledWith('/admin/users', { accessToken: 'TOKEN-XYZ' });
  });

  it('listAdminUsers avec filtres → query-string complète', async () => {
    const query: ListAdminUsersQuery = {
      q: 'diop',
      role: 'COMPTABLE',
      status: 'active',
      page: 2,
      pageSize: 50,
      sort: 'email',
      order: 'desc',
    };
    await listAdminUsers(query, opts);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const url = apiFetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('/admin/users?')).toBe(true);
    expect(url).toContain('q=diop');
    expect(url).toContain('role=COMPTABLE');
    expect(url).toContain('status=active');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sort=email');
    expect(url).toContain('order=desc');
  });

  it('listAdminUsers ignore undefined/null dans la qs', async () => {
    await listAdminUsers({ q: undefined, page: 1 }, opts);
    const url = apiFetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe('/admin/users?page=1');
  });

  it('getAdminUser → GET /admin/users/:id', async () => {
    await getAdminUser(userId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}`, {
      accessToken: 'TOKEN-XYZ',
    });
  });
});

describe('lib/api/admin-users — Mutations', () => {
  it('createAdminUser → POST /admin/users + body + token', async () => {
    const input: CreateAdminUserInput = {
      email: 'new@pasteur.sn',
      fullName: 'Aïssatou DIALLO',
      department: 'Finance',
      roles: ['COMPTABLE', 'CONTROLEUR'],
    };
    await createAdminUser(input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith('/admin/users', {
      accessToken: 'TOKEN-XYZ',
      method: 'POST',
      json: input,
    });
  });

  it('updateAdminUser → PATCH /admin/users/:id + body partiel', async () => {
    const input: UpdateAdminUserInput = {
      fullName: 'Aïssatou DIALLO-NDIAYE',
      department: null, // null = clear
    };
    await updateAdminUser(userId, input, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}`, {
      accessToken: 'TOKEN-XYZ',
      method: 'PATCH',
      json: input,
    });
  });

  it('setUserRoles → PUT /admin/users/:id/roles + roles', async () => {
    await setUserRoles(userId, { roles: ['DAF', 'CONTROLEUR'] }, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}/roles`, {
      accessToken: 'TOKEN-XYZ',
      method: 'PUT',
      json: { roles: ['DAF', 'CONTROLEUR'] },
    });
  });

  it('activateAdminUser → POST /admin/users/:id/activate', async () => {
    await activateAdminUser(userId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}/activate`, {
      accessToken: 'TOKEN-XYZ',
      method: 'POST',
    });
  });

  it('deactivateAdminUser → POST /admin/users/:id/deactivate', async () => {
    await deactivateAdminUser(userId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}/deactivate`, {
      accessToken: 'TOKEN-XYZ',
      method: 'POST',
    });
  });

  it('resetAdminUserPassword → POST /admin/users/:id/reset-password (void)', async () => {
    await resetAdminUserPassword(userId, opts);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/users/${userId}/reset-password`, {
      accessToken: 'TOKEN-XYZ',
      method: 'POST',
    });
  });
});
