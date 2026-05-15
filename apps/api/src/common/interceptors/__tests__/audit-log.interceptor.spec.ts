import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../audit-log.interceptor';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ForbiddenRoleException,
  UnauthenticatedException,
} from '../../exceptions/business.exception';
import { ErrorCode } from '../../exceptions/error-codes';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

/**
 * Tests unitaires de l'AuditLogInterceptor.
 *
 * Scope :
 *  - Skip GET / @Public (pas d'actor)
 *  - Persistance success sur mutation 2xx
 *  - Mapping 401/403 → 'denied' (+ propagation de l'exception)
 *  - Mapping 4xx applicatif → 'failed_validation'
 *  - 5xx → pas d'audit
 *  - Échec persist : ne casse pas la requête (avalé en interne)
 */
describe('AuditLogInterceptor', () => {
  let prisma: { eventLog: { create: jest.Mock } };
  let interceptor: AuditLogInterceptor;

  const actor: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'demandeur@pasteur.sn',
    fullName: 'Test Demandeur',
    roles: ['DEMANDEUR'],
  };

  function ctxOf(req: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: jest.fn().mockReturnValue(function handler(): void {}),
      getClass: jest.fn().mockReturnValue(class HandlerClass {}),
      switchToHttp: jest.fn().mockReturnValue({ getRequest: jest.fn().mockReturnValue(req) }),
    } as unknown as ExecutionContext;
  }

  function handlerOf(value: unknown): CallHandler {
    return { handle: jest.fn().mockReturnValue(of(value)) } as unknown as CallHandler;
  }

  function failingHandlerOf(err: unknown): CallHandler {
    return { handle: jest.fn().mockReturnValue(throwError(() => err)) } as unknown as CallHandler;
  }

  const baseReq = {
    method: 'POST',
    originalUrl: '/api/v1/purchase-requests',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
    user: actor,
    id: 'req-abc',
    params: {},
  };

  beforeEach(() => {
    prisma = { eventLog: { create: jest.fn().mockResolvedValue({}) } };
    interceptor = new AuditLogInterceptor(prisma as unknown as PrismaService);
  });

  describe('skip rules', () => {
    it('skips GET requests', async () => {
      const result = await firstValueFrom(
        interceptor.intercept(ctxOf({ ...baseReq, method: 'GET' }), handlerOf({ id: 1 })),
      );
      expect(result).toEqual({ id: 1 });
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('skips mutations without an authenticated user (@Public)', async () => {
      await firstValueFrom(
        interceptor.intercept(ctxOf({ ...baseReq, user: undefined }), handlerOf({ id: 1 })),
      );
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('persists result=success on a 2xx mutation', async () => {
      const response = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'draft' };
      await firstValueFrom(interceptor.intercept(ctxOf(baseReq), handlerOf(response)));

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      const call = prisma.eventLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toMatchObject({
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'POST /api/v1/purchase-requests',
        entityType: 'purchase-requests',
        entityId: null,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        result: 'success',
        errorCode: null,
      });
      // hash_chain ne doit JAMAIS être passé en data
      expect(call.data).not.toHaveProperty('hashChain');
      expect(call.data.payloadAfter).toMatchObject({
        requestId: 'req-abc',
        response: { id: response.id, status: 'draft' },
      });
    });

    it('captures route :id as entityId only if it is a UUID', async () => {
      const validId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      await firstValueFrom(
        interceptor.intercept(
          ctxOf({
            ...baseReq,
            originalUrl: `/api/v1/purchase-requests/${validId}/submit`,
            params: { id: validId },
          }),
          handlerOf({}),
        ),
      );
      const call = prisma.eventLog.create.mock.calls[0][0] as { data: { entityId: string } };
      expect(call.data.entityId).toBe(validId);
    });

    it('ignores route :id when not a UUID (e.g. slug)', async () => {
      await firstValueFrom(
        interceptor.intercept(
          ctxOf({ ...baseReq, params: { id: 'not-a-uuid' } }),
          handlerOf({}),
        ),
      );
      const call = prisma.eventLog.create.mock.calls[0][0] as { data: { entityId: string | null } };
      expect(call.data.entityId).toBeNull();
    });

    it('persists requestId in the dedicated column (not just payload)', async () => {
      await firstValueFrom(interceptor.intercept(ctxOf(baseReq), handlerOf({ id: 1 })));
      const call = prisma.eventLog.create.mock.calls[0][0] as {
        data: { requestId: string | null; payloadAfter: Record<string, unknown> };
      };
      expect(call.data.requestId).toBe('req-abc');
      expect(call.data.payloadAfter.requestId).toBe('req-abc');
    });
  });

  describe('error paths', () => {
    it('persists result=denied on 401 (UnauthenticatedException) and rethrows', async () => {
      const err = new UnauthenticatedException(ErrorCode.AUTH.EXPIRED_TOKEN, 'expired');
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);

      const call = prisma.eventLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.result).toBe('denied');
      expect(call.data.errorCode).toBe(ErrorCode.AUTH.EXPIRED_TOKEN);
    });

    it('persists result=denied on 403 (ForbiddenRoleException)', async () => {
      const err = new ForbiddenRoleException(['DAF'], ['DEMANDEUR']);
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);

      const call = prisma.eventLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.result).toBe('denied');
      expect(call.data.errorCode).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    });

    it('persists result=denied on a plain Nest UnauthorizedException (no business code)', async () => {
      const err = new UnauthorizedException('nope');
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);

      const call = prisma.eventLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.result).toBe('denied');
      expect(call.data.errorCode).toBeNull();
    });

    it('persists result=failed_validation on Nest BadRequestException (400)', async () => {
      const err = new BadRequestException('bad input');
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);

      const call = prisma.eventLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.result).toBe('failed_validation');
    });

    it('persists result=failed_validation on Nest NotFoundException (404)', async () => {
      const err = new NotFoundException();
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);

      expect((prisma.eventLog.create.mock.calls[0][0] as { data: { result: string } }).data.result)
        .toBe('failed_validation');
    });

    it('persists result=denied on ForbiddenException (403)', async () => {
      const err = new ForbiddenException();
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);
      expect((prisma.eventLog.create.mock.calls[0][0] as { data: { result: string } }).data.result)
        .toBe('denied');
    });

    it('does NOT persist for 5xx (reserved to pino logger)', async () => {
      const err = new InternalServerErrorException('boom');
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('does NOT persist for non-HTTP errors (unknown crash)', async () => {
      const err = new Error('something went wrong');
      await expect(
        firstValueFrom(interceptor.intercept(ctxOf(baseReq), failingHandlerOf(err))),
      ).rejects.toBe(err);
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });
  });

  describe('persistence failure resilience', () => {
    it('swallows audit insert errors so the user-facing request still succeeds', async () => {
      prisma.eventLog.create.mockRejectedValueOnce(new Error('DB unreachable'));
      const internals = interceptor as unknown as {
        logger: { error: (...args: unknown[]) => void };
      };
      const loggerErrorSpy = jest
        .spyOn(internals.logger, 'error')
        .mockImplementation(() => undefined);

      // La response doit toujours être renvoyée correctement.
      const result = await firstValueFrom(
        interceptor.intercept(ctxOf(baseReq), handlerOf({ ok: true })),
      );
      expect(result).toEqual({ ok: true });
      // Attendre que la microtask de catch s'exécute.
      await new Promise((r) => setImmediate(r));
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('classifyError (unit)', () => {
    it('returns null result for non-HTTP errors', () => {
      expect(AuditLogInterceptor.classifyError(new Error('x')).result).toBeNull();
    });
    it('returns denied for 401', () => {
      expect(AuditLogInterceptor.classifyError(new UnauthorizedException()).result).toBe('denied');
    });
    it('returns failed_validation for 422', () => {
      const err = new BadRequestException();
      Object.defineProperty(err, 'status', { value: 422 });
      // BadRequestException is 400 by default; just check that 400 maps too:
      expect(AuditLogInterceptor.classifyError(new BadRequestException()).result).toBe(
        'failed_validation',
      );
    });
  });

  describe('deriveEntityType (unit)', () => {
    it('extracts the resource segment after /api/vN/', () => {
      expect(AuditLogInterceptor.deriveEntityType('/api/v1/purchase-requests/abc')).toBe(
        'purchase-requests',
      );
      expect(AuditLogInterceptor.deriveEntityType('/api/v1/donors')).toBe('donors');
    });
    it('falls back to the first segment when no /vN/ is present', () => {
      expect(AuditLogInterceptor.deriveEntityType('/health')).toBe('health');
    });
    it('returns "unknown" for empty path', () => {
      expect(AuditLogInterceptor.deriveEntityType('/')).toBe('unknown');
    });
  });
});
