import { ApiError } from '../api-client';
import { mapApiErrorToToast } from '../use-api';

const mockSignOut = jest.fn();
const mockToast = jest.fn();

jest.mock('next-auth/react', () => ({
  signOut: (args: unknown) => mockSignOut(args),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: (args: unknown) => mockToast(args),
}));

describe('mapApiErrorToToast', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockToast.mockReset();
  });

  it('on 401 → toast info + signOut to /login', () => {
    mapApiErrorToToast(new ApiError(401, { message: 'unauth' }));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Session expirée' }),
    );
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('on 403 → toast destructive permission, no signOut', () => {
    mapApiErrorToToast(new ApiError(403, { message: 'forbidden' }));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Permission refusée' }),
    );
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('on 500 → toast destructive serveur + logs', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mapApiErrorToToast(new ApiError(503, { message: 'boom' }));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Erreur serveur' }),
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('on non-ApiError → toast destructive inattendu', () => {
    mapApiErrorToToast(new Error('boom'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Erreur inattendue' }),
    );
  });

  it('on 404 (other 4xx) → no toast (caller decides)', () => {
    mapApiErrorToToast(new ApiError(404, { message: 'not found' }));
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('ApiError', () => {
  it('exposes status + body and inherits Error', () => {
    const err = new ApiError(409, { code: 'BUSINESS.PERIOD_CLOSED', message: 'closed' });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.body.code).toBe('BUSINESS.PERIOD_CLOSED');
    expect(err.message).toBe('closed');
  });

  it('falls back on HTTP {status} when no message', () => {
    const err = new ApiError(500, {});
    expect(err.message).toBe('HTTP 500');
  });
});
