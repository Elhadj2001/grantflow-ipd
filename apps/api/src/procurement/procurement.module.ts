import { Module } from '@nestjs/common';
import { PurchaseRequestController } from './purchase-request.controller';
import { PurchaseRequestService } from './purchase-request.service';
import { ApprovalWorkflowService } from './services/approval-workflow.service';

@Module({
  controllers: [PurchaseRequestController],
  providers: [PurchaseRequestService, ApprovalWorkflowService],
  exports: [PurchaseRequestService, ApprovalWorkflowService],
})
export class ProcurementModule {}
