import { Module } from '@nestjs/common';
import { PostingService } from './services/posting.service';

/**
 * Module Accounting — façade des services comptables (sprint 3 : engagement
 * classe 8 ; sprint 4 : facturation classe 4/6 ; sprint 5 : paiement).
 *
 * Exporté pour permettre l'injection dans les autres modules métier
 * (procurement, ap, treasury…) sans tirer toute la couche GL.
 */
@Module({
  providers: [PostingService],
  exports: [PostingService],
})
export class AccountingModule {}
