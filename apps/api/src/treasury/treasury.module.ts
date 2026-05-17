import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BankAccountController } from './bank-account.controller';
import { PaymentRunController } from './payment-run.controller';
import { BankAccountService } from './services/bank-account.service';
import { PaymentRunService } from './services/payment-run.service';
import { SepaService } from './services/sepa.service';
import { IbanFraudService } from './services/iban-fraud.service';
import { StorageService } from '../common/services/storage.service';
import { AccountingModule } from '../accounting/accounting.module';

/**
 * Module Treasury — sprint 5.1 + sprint 5.2 :
 *   - BankAccount (référentiel comptes bancaires IPD)
 *   - PaymentRun (regroupement de factures à payer + workflow draft →
 *     prepared → executed, écritures BQ classe 5).
 *   - SepaService (sprint 5.2) : génération XML pain.001.001.03 → MinIO.
 *   - IbanFraudService (sprint 5.2) : détection des changements d'IBAN
 *     récents (90 jours) avec acquittement explicite au approve.
 *
 * Le module dépend de AccountingModule pour `PostingService.postPayment`.
 */
@Module({
  imports: [ConfigModule, AccountingModule],
  controllers: [BankAccountController, PaymentRunController],
  providers: [
    BankAccountService,
    PaymentRunService,
    SepaService,
    IbanFraudService,
    StorageService,
  ],
  exports: [BankAccountService, PaymentRunService, SepaService, IbanFraudService],
})
export class TreasuryModule {}
