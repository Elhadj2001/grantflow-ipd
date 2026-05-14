import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProcurementModule } from './procurement/procurement.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
        redact: ['req.headers.authorization'],
        customProps: () => ({ service: 'grantflow-api' }),
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    ProcurementModule,
    // À ajouter au fil des sprints :
    // ReferentialModule,
    // ApModule,
    // GlModule,
    // CoModule,
    // ReportingModule,
    // TreasuryModule,
  ],
})
export class AppModule {}
