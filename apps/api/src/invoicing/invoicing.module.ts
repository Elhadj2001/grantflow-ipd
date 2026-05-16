import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './services/invoice.service';
import { OcrService } from './services/ocr.service';
import { MatchingService } from './services/matching.service';
import { StorageService } from '../common/services/storage.service';

@Module({
  imports: [ConfigModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, OcrService, MatchingService, StorageService],
  exports: [InvoiceService, MatchingService],
})
export class InvoicingModule {}
