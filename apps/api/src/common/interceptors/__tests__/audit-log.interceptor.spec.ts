import { firstValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditLogInterceptor } from '../audit-log.interceptor';
import { AuditLogService } from '../../services/audit-log.service';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Tests unitaires du `AuditLogInterceptor` après refactor sprint-1.
 *
 * L'interceptor est désormais un thin wrapper : il délègue ENTIÈREMENT
 * à `AuditLogService.trackSuccess` côté 2xx. Les chemins d'erreur sont
 * pris en charge par `AuditExceptionFilter` (testé ailleurs).
 *
 * On vérifie donc juste :
 *  - `trackSuccess` est appelé avec (req, response) sur 2xx
 *  - L'interceptor laisse passer la réponse intacte
 *  - L'interceptor ne capture PLUS les exceptions (elles remontent au filter)
 */
describe('AuditLogInterceptor (post-refactor sprint-1)', () => {
  let auditService: { trackSuccess: jest.Mock };
  let interceptor: AuditLogInterceptor;

  const req = { method: 'POST', originalUrl: '/api/v1/x', user: { id: 'u' } };

  function ctxOf(): ExecutionContext {
    return {
      getHandler: jest.fn().mockReturnValue(function h(): void {}),
      getClass: jest.fn().mockReturnValue(class C {}),
      switchToHttp: jest.fn().mockReturnValue({ getRequest: jest.fn().mockReturnValue(req) }),
    } as unknown as ExecutionContext;
  }

  function handlerOf(value: unknown): CallHandler {
    return { handle: jest.fn().mockReturnValue(of(value)) } as unknown as CallHandler;
  }

  function failingHandlerOf(err: unknown): CallHandler {
    return { handle: jest.fn().mockReturnValue(throwError(() => err)) } as unknown as CallHandler;
  }

  beforeEach(() => {
    auditService = { trackSuccess: jest.fn() };
    interceptor = new AuditLogInterceptor(auditService as unknown as AuditLogService);
  });

  it('calls auditService.trackSuccess on a 2xx response', async () => {
    const response = { id: 'aaa', status: 'ok' };
    const result = await firstValueFrom(interceptor.intercept(ctxOf(), handlerOf(response)));
    expect(result).toBe(response);
    expect(auditService.trackSuccess).toHaveBeenCalledTimes(1);
    expect(auditService.trackSuccess).toHaveBeenCalledWith(req, response);
  });

  it('does NOT call trackSuccess when the handler throws (errors are filter territory)', async () => {
    const err = new UnauthorizedException();
    await expect(
      firstValueFrom(interceptor.intercept(ctxOf(), failingHandlerOf(err))),
    ).rejects.toBe(err);
    expect(auditService.trackSuccess).not.toHaveBeenCalled();
  });

  it('propagates the exception (does not swallow)', async () => {
    const err = new Error('handler crash');
    await expect(
      firstValueFrom(interceptor.intercept(ctxOf(), failingHandlerOf(err))),
    ).rejects.toBe(err);
  });
});
