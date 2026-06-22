import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SegregationOfDutiesService } from './segregation-of-duties.service';

/**
 * Module transverse de séparation des tâches (G1/F3, ADR-009). Fournit la
 * garde `SegregationOfDutiesService`, réutilisée par procurement (DA),
 * treasury (paiement) et accounting (écriture). Importe AuthModule pour
 * `AuditLogService` (journalisation `audit.event_log` des dérogations).
 */
@Module({
  imports: [AuthModule],
  providers: [SegregationOfDutiesService],
  exports: [SegregationOfDutiesService],
})
export class SodModule {}
