import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProcurementModule } from './procurement/procurement.module';
import { DonorModule } from './referential/donor/donor.module';
import { ProjectModule } from './referential/project/project.module';
import { GrantModule } from './referential/grant/grant.module';
import { BudgetLineModule } from './referential/budget-line/budget-line.module';
import { SupplierModule } from './referential/supplier/supplier.module';
import { AnalyticalAxisModule } from './referential/analytical-axis/analytical-axis.module';

const UUID_HEADER_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        /**
         * Correlation ID :
         *   - Si un client (gateway, web) fournit déjà un `x-request-id`
         *     UUID-valide, on le réutilise — utile pour propager une trace
         *     existante.
         *   - Sinon on génère un UUID v4 frais.
         *
         * Le résultat est exposé via `req.id` à l'`AuditLogInterceptor`,
         * qui le persiste dans `audit.event_log.request_id` (colonne UUID
         * indexée + inclus dans le hash chain — cf. DDL).
         */
        genReqId: (req: IncomingMessage): string => {
          const raw = req.headers['x-request-id'];
          const headerId = Array.isArray(raw) ? raw[0] : raw;
          return headerId && UUID_HEADER_REGEX.test(headerId) ? headerId : randomUUID();
        },
        customProps: () => ({ service: 'grantflow-api' }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.iban',
            'res.headers["set-cookie"]',
            '*.email',
            '*.iban',
            '*.password',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    ProcurementModule,
    // Référentiels — un sous-module par entité (M1).
    DonorModule,
    ProjectModule,
    GrantModule,
    BudgetLineModule,
    SupplierModule,
    AnalyticalAxisModule,
    // TODO Sprint 1.4+ : TaxCodeModule, ExchangeRateModule, GlAccountModule.
    // À ajouter au fil des sprints :
    // ApModule,
    // GlModule,
    // CoModule,
    // ReportingModule,
    // TreasuryModule,
  ],
})
export class AppModule {}
