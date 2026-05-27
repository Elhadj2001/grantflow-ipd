import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './services/invoice.service';
import { OcrService } from './services/ocr.service';
import { PdfParseOcrProvider } from './services/ocr/pdfparse-ocr.provider';
import { ClaudeVisionOcrProvider } from './services/ocr/claude-vision-ocr.provider';
import { OCR_VISION_PROVIDER } from './services/ocr/ocr-tokens';
import { MatchingService } from './services/matching.service';
import { StorageService } from '../common/services/storage.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [ConfigModule, AccountingModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    MatchingService,
    StorageService,
    PdfParseOcrProvider,
    // Sprint F-OCR-VISION : provider Vision via factory pour rester
    // optionnel. Renvoie `null` (= "non wiré") si la conf ne le demande
    // pas OU si ANTHROPIC_API_KEY est absent. La façade OcrService
    // détecte ce null et retombe sur pdf-parse. Aucun crash en dev.
    {
      provide: OCR_VISION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ClaudeVisionOcrProvider | null => {
        const provider = (config.get<string>('OCR_PROVIDER') ?? 'pdfparse').toLowerCase();
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (provider !== 'vision' && provider !== 'auto') return null;
        if (!apiKey) return null;
        return new ClaudeVisionOcrProvider(config);
      },
    },
    OcrService,
  ],
  exports: [InvoiceService, MatchingService],
})
export class InvoicingModule {}
