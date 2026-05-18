import { Module } from '@nestjs/common';
import { PurchaseRequestController } from './purchase-request.controller';
import { PurchaseRequestService } from './purchase-request.service';
import { ApprovalWorkflowService } from './services/approval-workflow.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PoPdfService } from './services/po-pdf.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './services/goods-receipt.service';
import { GrLabelsService } from './services/gr-labels.service';
import { MailService } from '../common/services/mail.service';
import { StorageService } from '../common/services/storage.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  controllers: [PurchaseRequestController, PurchaseOrderController, GoodsReceiptController],
  providers: [
    PurchaseRequestService,
    ApprovalWorkflowService,
    PurchaseOrderService,
    PoPdfService,
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
