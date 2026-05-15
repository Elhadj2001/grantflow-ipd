import { ForbiddenException, type ArgumentsHost, type HttpException } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { AuditExceptionFilter } from '../audit-exception.filter';
import { AuditLogService } from '../../services/audit-log.service';

/**
 * Test unitaire du filter d'audit.
 *
 * Le rôle du filter : appeler `auditService.trackException(req, err)` (effet
 * de bord) puis déléguer à `BaseExceptionFilter.catch` pour produire la
 * réponse HTTP standard de Nest. Ces deux invariants sont testés
 * indépendamment ; on ne re-teste pas la logique d'audit elle-même
 * (couverte par `audit-log.service.spec.ts`).
 */
describe('AuditExceptionFilter', () => {
  let auditService: { trackException: jest.Mock };
  let httpAdapterHost: HttpAdapterHost;
  let filter: AuditExceptionFilter;

  beforeEach(() => {
    auditService = { trackException: jest.fn() };
    // Stub minimal du HttpAdapter pour que BaseExceptionFilter puisse
    // construire la réponse sans crasher (interrogé via .replyXxx).
    httpAdapterHost = {
      httpAdapter: {
        getRequestUrl: jest.fn().mockReturnValue('/api/v1/purchase-requests'),
        reply: jest.fn(),
        end: jest.fn(),
      },
    } as unknown as HttpAdapterHost;
    filter = new AuditExceptionFilter(auditService as unknown as AuditLogService, httpAdapterHost);
  });

  function mockHost(req: Record<string, unknown>, res: Record<string, unknown>): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getType: () => 'http',
    } as unknown as ArgumentsHost;
  }

  it('calls auditService.trackException with the request + the exception', () => {
    const req = { method: 'POST', originalUrl: '/api/v1/purchase-requests', user: { id: 'u' } };
    const res = {};
    const err = new ForbiddenException();
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(filter)), 'catch')
      .mockImplementation(() => undefined);

    filter.catch(err, mockHost(req, res));

    expect(auditService.trackException).toHaveBeenCalledTimes(1);
    expect(auditService.trackException).toHaveBeenCalledWith(req, err);
    superSpy.mockRestore();
  });

  it('delegates to BaseExceptionFilter.catch to keep the standard Nest response shape', () => {
    const err = new ForbiddenException();
    const host = mockHost({ method: 'POST', originalUrl: '/api/v1/purchase-requests' }, {});
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(filter)), 'catch')
      .mockImplementation(() => undefined);

    filter.catch(err, host);

    expect(superSpy).toHaveBeenCalledTimes(1);
    expect(superSpy).toHaveBeenCalledWith(err, host);
    superSpy.mockRestore();
  });

  it('still delegates to super.catch even if auditService throws (audit must never break response)', () => {
    const err = new ForbiddenException();
    auditService.trackException.mockImplementation(() => {
      throw new Error('audit broken');
    });
    const host = mockHost({ method: 'POST', originalUrl: '/api/v1/purchase-requests' }, {});
    const internals = filter as unknown as { logger: { error: (...args: unknown[]) => void } };
    const logSpy = jest.spyOn(internals.logger, 'error').mockImplementation(() => undefined);
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(filter)), 'catch')
      .mockImplementation(() => undefined);

    expect(() => filter.catch(err as HttpException, host)).not.toThrow();
    expect(superSpy).toHaveBeenCalledTimes(1);
    expect(superSpy).toHaveBeenCalledWith(err, host);
    expect(logSpy).toHaveBeenCalled();
    superSpy.mockRestore();
  });
});
