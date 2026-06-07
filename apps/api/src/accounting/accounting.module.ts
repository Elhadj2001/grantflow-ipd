import { Module } from '@nestjs/common';
import { PostingService } from './services/posting.service';
import { PeriodCloseService } from './services/period-close.service';
import { DedicatedFundsService } from './services/dedicated-funds.service';
import { AccrualService } from './services/accrual.service';
import { PrepaymentService } from './services/prepayment.service';
import { AccountingController } from './accounting.controller';
import { ExchangeRateModule } from '../referential/exchange-rate/exchange-rate.module';

/**
 * Module Accounting — façade des services comptables.
 *  - sprint 3 : engagement classe 8 (PostingService.createCommitmentEntry)
 *  - sprint 4 : facturation classe 4/6 (PostingService.postInvoice)
 *  - sprint 5 : paiements classe 5 (PostingService.postPayment)
 *  - sprint 6.2 : clôture mensuelle + fonds dédiés 689/789
 *
 * Exporté pour permettre l'injection dans les autres modules métier
 * (procurement, ap, treasury, reporting…) sans tirer toute la couche GL.
 */
@Module({
  // US-020 (fix F18) : PostingService.createCommitmentEntry / postPayment
  // convertissent les montants en XOF via ExchangeRateService.
  imports: [ExchangeRateModule],
  controllers: [AccountingController],
  providers: [
    PostingService,
    PeriodCloseService,
    DedicatedFundsService,
    AccrualService,
    PrepaymentService,
  ],
  exports: [
    PostingService,
    PeriodCloseService,
    DedicatedFundsService,
    AccrualService,
    PrepaymentService,
  ],
})
export class AccountingModule {}
