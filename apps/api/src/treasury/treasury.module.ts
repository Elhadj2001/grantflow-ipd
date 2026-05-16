import { Module } from '@nestjs/common';
import { BankAccountController } from './bank-account.controller';
import { PaymentRunController } from './payment-run.controller';
import { BankAccountService } from './services/bank-account.service';
import { PaymentRunService } from './services/payment-run.service';
import { AccountingModule } from '../accounting/accounting.module';

/**
 * Module Treasury — sprint 5.1 :
 *   - BankAccount (référentiel comptes bancaires IPD)
 *   - PaymentRun (regroupement de factures à payer + workflow draft →
 *     prepared → executed, écritures BQ classe 5).
 *
 * Le module dépend de AccountingModule pour `PostingService.postPayment`.
 */
@Module({
  imports: [AccountingModule],
  controllers: [BankAccountController, PaymentRunController],
  providers: [BankAccountService, PaymentRunService],
  exports: [BankAccountService, PaymentRunService],
})
export class TreasuryModule {}
