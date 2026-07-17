import { Module } from '@nestjs/common';
import { BankAccountController } from './bank-account.controller';
import { PaymentRunController } from './payment-run.controller';
import { BankAccountService } from './services/bank-account.service';
import { PaymentRunService } from './services/payment-run.service';
import { IbanFraudService } from './services/iban-fraud.service';
import { SepaService } from './services/sepa.service';
import { AccountingModule } from '../accounting/accounting.module';
// US-097 (F-S8-14) : ExchangeRateService pour figer les triplets XOF.
import { ExchangeRateModule } from '../referential/exchange-rate/exchange-rate.module';

/**
 * Module Treasury :
 *   - sprint 5.1 : BankAccount + PaymentRun + classe 5
 *   - sprint F4a : SepaService (pain.001.001.03) + IbanFraudService
 *     (alertes IBAN < 30j) + persistence ibanAlerts/sepaXml côté PaymentRun
 *
 * Le module dépend de AccountingModule pour `PostingService.postPayment`.
 */
@Module({
  imports: [AccountingModule, ExchangeRateModule],
  controllers: [BankAccountController, PaymentRunController],
  providers: [BankAccountService, PaymentRunService, IbanFraudService, SepaService],
  exports: [BankAccountService, PaymentRunService, IbanFraudService, SepaService],
})
export class TreasuryModule {}
