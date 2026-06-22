import { Module } from '@nestjs/common';
import { PurchaseRequestController } from './purchase-request.controller';
import { PurchaseRequestService } from './purchase-request.service';
import { ApprovalWorkflowService } from './services/approval-workflow.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PoPdfService } from './services/po-pdf.service';
import { SupplierInvoicePdfService } from './services/supplier-invoice-pdf.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './services/goods-receipt.service';
import { GrLabelsService } from './services/gr-labels.service';
import { MailService } from '../common/services/mail.service';
import { StorageService } from '../common/services/storage.service';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { ExchangeRateModule } from '../referential/exchange-rate/exchange-rate.module';
import { EligibilityModule } from '../grant_office/eligibility/eligibility.module';
import { SodModule } from '../common/sod/sod.module';

@Module({
  // Sprint F-INVOICE-SIM : import d'InvoicingModule pour réutiliser
  // InvoiceService (création d'Invoice `captured` en mode inject). Pas de
  // cycle : InvoicingModule n'importe pas ProcurementModule.
  // Fix fix-approval-workflow-currency-conversion : ExchangeRateModule
  // injecté pour convertir totalAmount en XOF avant comparaison aux
  // seuils APPROVAL_THRESHOLD_CG / DAF (qui sont en XOF).
  // US-049 : EligibilityModule fournit EligibilityEngineService +
  // EligibilityContextBuilder pour brancher la validation d'éligibilité
  // (ADR-007) au moment du submit de la DA.
  // G1/F3 : SodModule fournit la garde de séparation des tâches (ADR-009)
  // utilisée par ApprovalWorkflowService au moment de l'approbation DA.
  imports: [AccountingModule, InvoicingModule, ExchangeRateModule, EligibilityModule, SodModule],
  controllers: [PurchaseRequestController, PurchaseOrderController, GoodsReceiptController],
  providers: [
    PurchaseRequestService,
    ApprovalWorkflowService,
    PurchaseOrderService,
    PoPdfService,
    SupplierInvoicePdfService,
    GoodsReceiptService,
    GrLabelsService,
    MailService,
    StorageService,
  ],
  exports: [
    PurchaseRequestService,
    ApprovalWorkflowService,
    PurchaseOrderService,
    GoodsReceiptService,
  ],
})
export class ProcurementModule {}
