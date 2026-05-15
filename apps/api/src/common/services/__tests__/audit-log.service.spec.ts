import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditLogService, type AuditRequest } from '../audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ForbiddenRoleException,
  UnauthenticatedException,
} from '../../exceptions/business.exception';
import { ErrorCode } from '../../exceptions/error-codes';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

/**
 * Tests unitaires du service d'audit centralisé.
 *
 * Couvre :
 *  - `trackSuccess` (chemin 2xx, mutations only, skip @Public)
 *  - `trackException` (chemin 401/403/4xx, skip 5xx + non-HTTP, anonymous 401 OK)
 *  - Helpers statiques (classifyError, deriveEntityType, deriveEntityId, summarize)
 *  - Robustesse persist (DB down ne casse pas la requête)
 */
describe('AuditLogService', () => {
  let prisma: { eventLog: { create: jest.Mock } };
  let service: AuditLogService;

  const actor: AuthenticatedUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'demandeur@pasteur.sn',
    fullName: 'Test Demandeur',
    roles: ['DEMANDEUR'],
  };

  const baseReq: AuditRequest = {
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
    service = new AuditLogService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('trackSuccess', () => {
    it('persists result=success on a mutation with a known actor', () => {
      service.trackSuccess(baseReq, { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'draft' });
      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toMatchObject({
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'POST /api/v1/purchase-requests',
        entityType: 'purchase-requests',
        entityId: null,
        result: 'success',
        errorCode: null,
        requestId: 'req-abc',
      });
      expect(data).not.toHaveProperty('hashChain');
      expect((data.payloadAfter as Record<string, unknown>).response).toMatchObject({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        status: 'draft',
      });
    });

    it('skips GET requests', () => {
      service.trackSuccess({ ...baseReq, method: 'GET' }, { id: 1 });
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('skips when no authenticated user (e.g. @Public route)', () => {
      service.trackSuccess({ ...baseReq, user: undefined }, { id: 1 });
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('captures route :id only when UUID', () => {
      const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      service.trackSuccess(
        { ...baseReq, originalUrl: `/api/v1/purchase-requests/${id}/submit`, params: { id } },
        {},
      );
      expect(prisma.eventLog.create.mock.calls[0][0].data.entityId).toBe(id);
    });

    it('ignores non-UUID route :id (slug)', () => {
      service.trackSuccess({ ...baseReq, params: { id: 'not-a-uuid' } }, {});
      expect(prisma.eventLog.create.mock.calls[0][0].data.entityId).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  describe('trackException', () => {
    it('persists result=denied on UnauthenticatedException (401)', () => {
      const err = new UnauthenticatedException(ErrorCode.AUTH.EXPIRED_TOKEN, 'expired');
      service.trackException(baseReq, err);
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.result).toBe('denied');
      expect(data.errorCode).toBe(ErrorCode.AUTH.EXPIRED_TOKEN);
    });

    it('persists result=denied on ForbiddenRoleException (403)', () => {
      const err = new ForbiddenRoleException(['DAF'], ['DEMANDEUR']);
      service.trackException(baseReq, err);
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.result).toBe('denied');
      expect(data.errorCode).toBe(ErrorCode.AUTH.FORBIDDEN_ROLE);
    });

    it('persists result=denied on plain UnauthorizedException (no business code)', () => {
      service.trackException(baseReq, new UnauthorizedException());
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.result).toBe('denied');
      expect(data.errorCode).toBeNull();
    });

    it('persists result=denied on plain ForbiddenException', () => {
      service.trackException(baseReq, new ForbiddenException());
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.result).toBe('denied');
    });

    it('persists result=failed_validation on 400 (BadRequest)', () => {
      service.trackException(baseReq, new BadRequestException());
      expect(prisma.eventLog.create.mock.calls[0][0].data.result).toBe('failed_validation');
    });

    it('persists result=failed_validation on 404 (NotFound)', () => {
      service.trackException(baseReq, new NotFoundException());
      expect(prisma.eventLog.create.mock.calls[0][0].data.result).toBe('failed_validation');
    });

    it('audits even ANONYMOUS 401 (no actor)', () => {
      // C'est exactement le cas critique du sprint-1 : un attaquant qui
      // POST sans token doit laisser une trace, actor_id = null.
      const err = new UnauthenticatedException();
      service.trackException({ ...baseReq, user: undefined }, err);
      const data = prisma.eventLog.create.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.actorId).toBeNull();
      expect(data.actorEmail).toBeNull();
      expect(data.result).toBe('denied');
    });

    it('does NOT persist 5xx (reserved to pino)', () => {
      service.trackException(baseReq, new InternalServerErrorException());
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('does NOT persist non-HTTP errors', () => {
      service.trackException(baseReq, new Error('boom'));
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('skips GET requests (lecture refusée — bruit non audité au sprint 1)', () => {
      service.trackException({ ...baseReq, method: 'GET' }, new ForbiddenException());
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  describe('helpers (static)', () => {
    it('classifyError: 401 → denied', () => {
      expect(AuditLogService.classifyError(new UnauthorizedException()).result).toBe('denied');
    });
    it('classifyError: 422 → failed_validation', () => {
      const err = new BadRequestException();
      Object.defineProperty(err, 'status', { value: 422 });
      expect(AuditLogService.classifyError(new BadRequestException()).result).toBe(
        'failed_validation',
      );
    });
    it('classifyError: 500 → null', () => {
      expect(AuditLogService.classifyError(new InternalServerErrorException()).result).toBeNull();
    });
    it('deriveEntityType: /api/v1/...', () => {
      expect(AuditLogService.deriveEntityType('/api/v1/purchase-requests/abc')).toBe(
        'purchase-requests',
      );
      expect(AuditLogService.deriveEntityType('/health')).toBe('health');
      expect(AuditLogService.deriveEntityType('/')).toBe('unknown');
    });
    it('summarize: opaque object → marker, primitives → preserved', () => {
      expect(AuditLogService.summarize(null)).toBeNull();
      expect(AuditLogService.summarize(42)).toBe(42);
      expect(AuditLogService.summarize({ name: 'X' })).toEqual({ _opaque: true });
      expect(AuditLogService.summarize({ id: 'u', status: 's', extra: 1 })).toEqual({
        id: 'u',
        status: 's',
      });
    });
  });

  // ------------------------------------------------------------------
  describe('resilience', () => {
    it('swallows DB errors so the user-facing request never crashes', async () => {
      prisma.eventLog.create.mockRejectedValueOnce(new Error('DB unreachable'));
      const internals = service as unknown as {
        logger: { error: (...args: unknown[]) => void };
      };
      const spy = jest.spyOn(internals.logger, 'error').mockImplementation(() => undefined);
      service.trackSuccess(baseReq, { id: 1 });
      // Attendre que la microtask de catch s'exécute.
      await new Promise((r) => setImmediate(r));
      expect(spy).toHaveBeenCalled();
    });
  });
});
