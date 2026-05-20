import { Module } from '@nestjs/common';
import { PilotageController } from './pilotage.controller';
import { PilotageService } from './pilotage.service';

/**
 * Module Pilotage — sprint F-PILOTAGE.
 *
 * Endpoints lecture-seule pour les écrans de pilotage budgétaire et
 * analytique (Contrôleur de gestion + Principal Investigator). Aucun
 * DDL change : les requêtes s'appuient sur le schéma existant (journal,
 * dedicated_fund_movement, overhead_calculation) + les FK analytiques.
 */
@Module({
  controllers: [PilotageController],
  providers: [PilotageService],
  exports: [PilotageService],
})
export class PilotageModule {}
