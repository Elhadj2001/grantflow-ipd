import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './services/invoice.service';
import { OcrService } from './services/ocr.service';
import { MatchingService } from './services/matching.service';
import { StorageService } from '../common/services/storage.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [ConfigModule, AccountingModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, OcrService, MatchingService, StorageService],
  exports: [InvoiceService, MatchingService],
})
export class InvoicingModule {}
