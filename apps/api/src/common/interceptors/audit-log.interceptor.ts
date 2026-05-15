import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, tap, throwError, type Observable } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../exceptions/business.exception';
import type { ErrorCodeValue } from '../exceptions/error-codes';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { type AuditResult } from './audit-result';

/**
 * Forme minimale de la requête HTTP utilisée par l'interceptor.
 * Évite d'importer `express` directement pour rester portable
 * (et compatible avec un éventuel transport Fastify).
 */
interface AuditRequest {
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
 * Intercepteur global qui persiste une trace d'audit pour toute mutation
 * (POST/PUT/PATCH/DELETE) effectuée par un utilisateur authentifié.
 *
 * Couverture des cas (cf. validation Cowork Q2) :
 *  - 2xx          → result='success'
 *  - 401 / 403    → result='denied'
 *  - 400/404/409/422 → result='failed_validation'
 *  - 5xx          → NON audité ici (laissé au logger pino — voir DDL `result`)
 *  - GET et @Public(): skip silencieux
 *
 * Garanties :
 *  - N'écrit JAMAIS la colonne `hash_chain` — c'est le trigger PG
 *    `audit.compute_hash_chain` (cf. DDL ligne 92-116) qui s'en charge.
 *  - Un échec d'insertion d'audit ne casse JAMAIS la requête utilisateur :
 *    erreur loguée via pino, propagée nulle part. Compromis acceptable
 *    pour le sprint 0.3 — un sprint futur pourra introduire un retry
 *    via BullMQ pour garantir le 100 %.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private static readonly MUTATIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditRequest>();
    const method = req.method?.toUpperCase();

    if (!method || !AuditLogInterceptor.MUTATIVE_METHODS.has(method)) {
      return next.handle();
    }
    if (!req.user) {
      // Route @Public() ou phase pré-auth : pas d'acteur identifié, on n'audite pas.
      return next.handle();
    }

    const baseContext = this.buildBaseContext(req);

    return next.handle().pipe(
      tap({
        next: (response: unknown) => {
          this.persistSafe({
            ...baseContext,
            result: 'success',
            errorCode: null,
            payloadAfter: { requestId: baseContext.requestId, response: this.summarize(response) },
          });
        },
      }),
      catchError((err: unknown) => {
        const { result, errorCode } = AuditLogInterceptor.classifyError(err);
        if (result !== null) {
          this.persistSafe({
            ...baseContext,
            result,
            errorCode,
            payloadAfter: {
              requestId: baseContext.requestId,
              error: err instanceof Error ? err.message : 'unknown',
            },
          });
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Classe HTTP exception → ({ result, errorCode }).
   * `result === null` signifie "ne pas auditer" (5xx ou erreur non-HTTP).
   */
  static classifyError(err: unknown): { result: AuditResult | null; errorCode: ErrorCodeValue | null } {
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

  private buildBaseContext(req: AuditRequest): {
    actorId: string;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string | null;
  } {
    const url = req.originalUrl ?? req.url ?? '';
    const pathOnly = url.split('?')[0];
    const user = req.user as AuthenticatedUser;
    return {
      actorId: user.id,
      actorEmail: user.email || null,
      action: `${req.method ?? ''} ${pathOnly}`.trim(),
      entityType: AuditLogInterceptor.deriveEntityType(pathOnly),
      entityId: AuditLogInterceptor.deriveEntityId(req),
      ipAddress: req.ip ?? null,
      userAgent: AuditLogInterceptor.headerString(req.headers?.['user-agent']),
      requestId: req.id ?? null,
    };
  }

  /**
   * Première segment significative après le préfixe d'API.
   *   /api/v1/purchase-requests/abc/submit → 'purchase-requests'
   *   /api/v1/donors                        → 'donors'
   *   /health                               → 'health'
   *
   * Un décorateur dédié `@AuditEntity('xxx')` pourra surcharger cette
   * dérivation dans un sprint futur.
   */
  static deriveEntityType(pathOnly: string): string {
    const segments = pathOnly.split('/').filter(Boolean);
    const apiIdx = segments.findIndex((s) => /^v\d+$/.test(s));
    const slice = apiIdx >= 0 ? segments.slice(apiIdx + 1) : segments;
    return slice[0] ?? 'unknown';
  }

  /**
   * Récupère un éventuel `id` UUID dans les params de route. Toute autre
   * forme (slug, code) est ignorée pour respecter le type `UUID` du DDL.
   */
  static deriveEntityId(req: AuditRequest): string | null {
    const idParam = req.params?.id;
    if (idParam && AuditLogInterceptor.UUID_REGEX.test(idParam)) return idParam;
    return null;
  }

  private static headerString(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  /** Tronque la response pour éviter de stocker des payloads énormes. */
  private summarize(response: unknown): unknown {
    if (response === null || response === undefined) return null;
    if (typeof response !== 'object') return response;
    // Ne conserver que les clés "id" / "status" / "code" / "reference" si présentes,
    // sinon stocker un marqueur. Le `payload_before` complet sera ajouté plus tard
    // via décorateur dédié, pour les modules qui le requièrent (procurement, gl).
    const obj = response as Record<string, unknown>;
    const compact: Record<string, unknown> = {};
    for (const key of ['id', 'status', 'code', 'reference'] as const) {
      if (key in obj) compact[key] = obj[key];
    }
    return Object.keys(compact).length > 0 ? compact : { _opaque: true };
  }

  private persistSafe(data: {
    actorId: string;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string | null;
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
          // Colonne dédiée (indexée) — duplique l'info présente dans
          // payload_after pour permettre les recherches rapides "qu'a
          // fait cette requête X ?". Le request_id reste aussi dans
          // payload_after pour la corrélation pino côté logs.
          requestId: data.requestId,
          result: data.result,
          errorCode: data.errorCode,
          // Cast légitime : on contrôle entièrement la forme de l'objet
          // (clés string + primitives + sous-objets compacts construits par
          // `summarize`), donc l'invariant Prisma `InputJsonValue` est tenu.
          payloadAfter: data.payloadAfter as Prisma.InputJsonValue,
          // hashChain : volontairement omis — le trigger PG le calcule.
        },
      })
      .catch((e: unknown) => {
        this.logger.error(
          { err: e, action: data.action, actorId: data.actorId },
          'audit-log persist failed (event lost — investigate trigger or DB connectivity)',
        );
      });
  }
}
