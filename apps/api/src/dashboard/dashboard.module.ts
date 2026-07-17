import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Module Dashboard — US-066 (Sprint S7).
 *
 * Lecture seule, cross-context par nature (procurement + invoicing +
 * referential + treasury) : agrège des COMPTEURS, aucune logique métier.
 * Les règles de visibilité restent alignées sur les listes sources.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
