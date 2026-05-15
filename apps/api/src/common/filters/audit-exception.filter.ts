import {
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { AuditLogService, type AuditRequest } from '../services/audit-log.service';

/**
 * Filter global qui persiste une trace d'audit pour toute `HttpException`
 * 4xx mutative, AVANT de laisser Nest générer la réponse standard.
 *
 * Pourquoi un filter et pas (seulement) l'interceptor ? Les Guards
 * (`JwtAuthGuard`, `RolesGuard`) lèvent leurs exceptions AVANT que
 * `intercept()` ne soit invoqué — donc les 401/403 ne sont jamais visibles
 * pour `AuditLogInterceptor`. Un filter, lui, capte TOUTES les exceptions
 * descendantes (guards, pipes, handler, interceptors).
 *
 * On hérite de `BaseExceptionFilter` pour conserver le rendu HTTP standard
 * de Nest (status code, content-type, body shape) — notre seule
 * responsabilité supplémentaire est l'effet de bord d'audit.
 */
@Catch(HttpException)
@Injectable()
export class AuditExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AuditExceptionFilter.name);

  constructor(
    private readonly auditService: AuditLogService,
    httpAdapterHost: HttpAdapterHost,
  ) {
    super(httpAdapterHost.httpAdapter);
  }

  override catch(exception: HttpException, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<AuditRequest>();
    // Effet de bord d'audit — wrap dans try/catch pour respecter l'invariant
    // "l'audit ne casse jamais la réponse utilisateur". L'erreur d'audit est
    // loguée via pino, le filter laisse passer la réponse standard Nest.
    try {
      this.auditService.trackException(req, exception);
    } catch (auditErr) {
      this.logger.error(
        { err: auditErr },
        'AuditExceptionFilter: trackException threw, response continues unaffected',
      );
    }
    super.catch(exception, host);
  }
}
