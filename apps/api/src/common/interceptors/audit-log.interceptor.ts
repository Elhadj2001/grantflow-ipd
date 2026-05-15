import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import { AuditLogService, type AuditRequest } from '../services/audit-log.service';

/**
 * Intercepteur global qui persiste une trace d'audit pour toute mutation
 * (POST/PUT/PATCH/DELETE) qui se termine en 2xx.
 *
 * Découpage du pipeline d'audit :
 *  - 2xx                  → audité ici (via `AuditLogService.trackSuccess`)
 *  - 4xx (auth + valid)   → audité par `AuditExceptionFilter` (sprint-1) —
 *                            les exceptions des Guards (401/403) court-circuitent
 *                            les Interceptors, c'est pourquoi le filter est
 *                            nécessaire pour les capter.
 *  - 5xx                  → non audité (laissé à pino)
 *  - GET/HEAD/OPTIONS + @Public → skip (cf. AuditLogService.trackSuccess)
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditRequest>();

    return next.handle().pipe(
      tap({
        next: (response: unknown) => {
          this.auditService.trackSuccess(req, response);
        },
      }),
    );
  }
}
