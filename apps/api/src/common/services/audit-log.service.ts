import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../exceptions/business.exception';
import type { ErrorCodeValue } from '../exceptions/error-codes';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { AuditResult } from '../interceptors/audit-result';

/**
 * Forme minimale de la requête HTTP utilisée par l'audit.
 * Évite d'importer `express` directement pour rester portable
 * (et compatible avec un éventuel transport Fastify).
 */
export interface AuditRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  params?: Record<string, string | undefined>;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  id?: string;
}

/**
 * Contexte capturé pour une requête donnée — sert de base aux 3 chemins
 * d'audit (success / failed_validation / denied).
 */
export interface AuditBaseContext {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const MUTATIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service centralisé d'écriture dans `audit.event_log`.
 *
 * Utilisé par deux étages du pipeline Nest :
 *  - `AuditLogInterceptor`  → mutations 2xx     (chemin success)
 *  - `AuditExceptionFilter` → HttpException 4xx (chemin denied / failed_validation)
 *
 * Garanties :
 *  - N'écrit JAMAIS `hash_chain` — c'est le trigger PG qui le calcule.
 *  - Un échec d'INSERT ne casse JAMAIS la requête utilisateur (log pino + swallow).
 *  - Auditeur unique : la même base de calcul (action, entity, etc.) est utilisée
 *    par les deux étages, garantissant la cohérence en cas de re-jeu / corrélation.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Audit d'une mutation réussie. Appelé par `AuditLogInterceptor`. */
  trackSuccess(req: AuditRequest, response: unknown): void {
    if (!AuditLogService.isMutative(req)) return;
    if (!req.user) return; // pas d'acteur identifié : skip
    const ctx = this.buildBaseContext(req);
    this.persistSafe({
      ...ctx,
      result: 'success',
      errorCode: null,
      payloadAfter: { requestId: ctx.requestId, response: AuditLogService.summarize(response) },
    });
  }

  /**
   * Audit d'une exception HTTP. Appelé par `AuditExceptionFilter`.
   *
   * Important : on AUDITE même quand `req.user` est absent (cas 401), pour
   * tracer les tentatives anonymes refusées — exigence SOC 2 / SOX. Dans
   * ce cas `actor_id` reste NULL (DDL le permet).
   */
  trackException(req: AuditRequest, err: unknown): void {
    if (!AuditLogService.isMutative(req)) return;
    const { result, errorCode } = AuditLogService.classifyError(err);
    if (result === null) return; // 5xx ou non-HTTP → laissé à pino

    const ctx = this.buildBaseContext(req);
    this.persistSafe({
      ...ctx,
      result,
      errorCode,
      payloadAfter: {
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : 'unknown',
      },
    });
  }

  /**
   * Mappe une exception → ({ result, errorCode }).
   * `result === null` signifie "ne pas auditer".
   */
  static classifyError(err: unknown): {
    result: AuditResult | null;
    errorCode: ErrorCodeValue | null;
  } {
    const errorCode = err instanceof BusinessException ? err.code : null;
    if (!(err instanceof HttpException)) {
      return { result: null, errorCode };
    }
    const status = err.getStatus();
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      return { result: 'denied', errorCode };
    }
    if (status >= 400 && status < 500) {
      return { result: 'failed_validation', errorCode };
    }
    return { result: null, errorCode };
  }

  /**
   * Première segment significative après `/api/vN/`.
   *   /api/v1/purchase-requests/abc/submit → 'purchase-requests'
   *   /api/v1/donors                        → 'donors'
   *   /health                               → 'health'
   */
  static deriveEntityType(pathOnly: string): string {
    const segments = pathOnly.split('/').filter(Boolean);
    const apiIdx = segments.findIndex((s) => /^v\d+$/.test(s));
    const slice = apiIdx >= 0 ? segments.slice(apiIdx + 1) : segments;
    return slice[0] ?? 'unknown';
  }

  /** Récupère le `:id` UUID des params de route, ignore les slugs/codes. */
  static deriveEntityId(req: AuditRequest): string | null {
    const idParam = req.params?.id;
    if (idParam && UUID_REGEX.test(idParam)) return idParam;
    return null;
  }

  private static isMutative(req: AuditRequest): boolean {
    const method = req.method?.toUpperCase();
    return !!method && MUTATIVE_METHODS.has(method);
  }

  private static headerString(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  /** Compacte la response : ne garde que id/status/code/reference, ou marqueur. */
  static summarize(response: unknown): unknown {
    if (response === null || response === undefined) return null;
    if (typeof response !== 'object') return response;
    const obj = response as Record<string, unknown>;
    const compact: Record<string, unknown> = {};
    for (const key of ['id', 'status', 'code', 'reference'] as const) {
      if (key in obj) compact[key] = obj[key];
    }
    return Object.keys(compact).length > 0 ? compact : { _opaque: true };
  }

  buildBaseContext(req: AuditRequest): AuditBaseContext {
    const url = req.originalUrl ?? req.url ?? '';
    const pathOnly = url.split('?')[0];
    return {
      actorId: req.user?.id ?? null,
      actorEmail: req.user?.email || null,
      action: `${req.method ?? ''} ${pathOnly}`.trim(),
      entityType: AuditLogService.deriveEntityType(pathOnly),
      entityId: AuditLogService.deriveEntityId(req),
      ipAddress: req.ip ?? null,
      userAgent: AuditLogService.headerString(req.headers?.['user-agent']),
      requestId: req.id ?? null,
    };
  }

  private persistSafe(data: AuditBaseContext & {
    result: AuditResult;
    errorCode: ErrorCodeValue | null;
    payloadAfter: Record<string, unknown>;
  }): void {
    this.prisma.eventLog
      .create({
        data: {
          actorId: data.actorId,
          actorEmail: data.actorEmail,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          requestId: data.requestId,
          result: data.result,
          errorCode: data.errorCode,
          // Cast légitime : on contrôle la forme (clés string + primitives).
          payloadAfter: data.payloadAfter as Prisma.InputJsonValue,
          // hash_chain : volontairement omis — le trigger PG le calcule.
        },
      })
      .catch((e: unknown) => {
        this.logger.error(
          { err: e, action: data.action, actorId: data.actorId, result: data.result },
          'audit-log persist failed (event lost — investigate trigger or DB connectivity)',
        );
      });
  }
}
