import { apiFetch } from '../api-client';

/**
 * Types alignés sur les DTOs backend (apps/api/src/procurement/dto).
 * Les Decimal sont sérialisés en string par Prisma → on les conserve
 * en string ici et on les convertit en number au point d'affichage
 * via AmountDisplay.
 */
export type PrStatus =
  | 'draft'
  | 'submitted'
  | 'pending_pi'
  | 'pending_cg'
  | 'pending_daf'
  | 'pending_caissier'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'closed'
  | 'settled';

export type PoStatus =
  | 'draft'
  | 'sent'
  | 'acknowledged'
  | 'partially_received'
  | 'received'
  | 'invoiced'
  | 'closed'
  | 'cancelled';

export type GrStatus = 'draft' | 'partial' | 'complete' | 'rejected' | 'cancelled';

export type PrType = 'standard' | 'petty_cash' | 'cash_advance';

export interface PurchaseRequestLine {
  id?: string;
  lineNumber?: number;
  description: string;
  quantity: number | string;
  unit?: string;
  unitPrice: number | string;
  lineTotal?: number | string;
  budgetLineId: string;
}

export interface PurchaseRequest {
  id: string;
  prNumber: string;
  requestedBy: string;
  requestedAt: string;
  neededBy: string | null;
  status: PrStatus;
  requestType?: PrType;
  projectId: string;
  grantId: string;
  costCenterId: string | null;
  activityId: string | null;
  totalAmount: string;
  currency: string;
  description: string | null;
}

export interface PurchaseRequestDetail extends PurchaseRequest {
  lines: PurchaseRequestLine[];
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface BudgetCheck {
  available: number | string;
  currentTotal: number | string;
  willConsume: number | string;
  wouldExceed: boolean;
  details: Array<{
    budgetLineId: string;
    budgetLineCode?: string;
    budgetedAmount: number | string;
    consumed: number | string;
    requested: number | string;
    available: number | string;
    sufficient: boolean;
  }>;
}

export interface ApprovalStep {
  id: string;
  stepOrder: number;
  approverRole: string | null;
  approverId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  decidedAt: string | null;
  decisionNotes: string | null;
}

export interface CreatePurchaseRequestInput {
  neededBy?: string;
  description: string;
  projectId: string;
  grantId: string;
  costCenterId?: string;
  activityId?: string;
  currency?: string;
  requestType?: PrType;
  lines: Array<{
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
    budgetLineId: string;
  }>;
}

export interface UpdatePurchaseRequestInput
  extends Partial<CreatePurchaseRequestInput> {
  description?: string;
}

export interface PurchaseOrderLine {
  id?: string;
  lineNumber?: number;
  description: string;
  quantity: number | string;
  unit?: string;
  unitPrice: number | string;
  lineTotal?: number | string;
  budgetLineId?: string;
  prLineId?: string;
  taxCodeId?: string | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  orderDate: string;
  expectedDate: string | null;
  status: PoStatus;
  totalHt: string;
  totalVat: string;
  totalTtc: string;
  currency: string;
  prId: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
}

export interface GoodsReceiptLine {
  id?: string;
  poLineId: string;
  quantity: number | string;
  batchNumber?: string | null;
  expiryDate?: string | null;
  coldChainOk?: boolean | null;
  qualityCheck?: string | null;
}

export interface GoodsReceipt {
  id: string;
  grNumber: string;
  poId: string;
  receiptDate: string;
  receivedBy: string;
  status: GrStatus;
  coldChainRequired: boolean;
  notes?: string | null;
  completedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
}

export interface GoodsReceiptDetail extends GoodsReceipt {
  lines: GoodsReceiptLine[];
}

// =====================================================================
//  Helpers
// =====================================================================

function qs(params: object): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

interface CallOpts {
  accessToken?: string | null;
}

// =====================================================================
//  Purchase Requests
// =====================================================================

export interface ListPrQuery {
  status?: PrStatus;
  page?: number;
  pageSize?: number;
  search?: string;
}

export function listPurchaseRequests(
  query: ListPrQuery,
  opts: CallOpts = {},
): Promise<ListResponse<PurchaseRequest>> {
  return apiFetch<ListResponse<PurchaseRequest>>(`/purchase-requests${qs(query)}`, {
    accessToken: opts.accessToken,
  });
}

export function getPurchaseRequest(
  id: string,
  opts: CallOpts = {},
): Promise<PurchaseRequestDetail> {
  return apiFetch<PurchaseRequestDetail>(`/purchase-requests/${id}`, {
    accessToken: opts.accessToken,
  });
}

export function checkPrBudget(id: string, opts: CallOpts = {}): Promise<BudgetCheck> {
  return apiFetch<BudgetCheck>(`/purchase-requests/${id}/check-budget`, {
    accessToken: opts.accessToken,
  });
}

export function getPrApprovalHistory(
  id: string,
  opts: CallOpts = {},
): Promise<ApprovalStep[]> {
  return apiFetch<ApprovalStep[]>(`/purchase-requests/${id}/approval-history`, {
    accessToken: opts.accessToken,
  });
}

export function listPendingApprovals(
  opts: CallOpts = {},
): Promise<ListResponse<PurchaseRequest>> {
  return apiFetch<ListResponse<PurchaseRequest>>(`/purchase-requests/pending-my-approval`, {
    accessToken: opts.accessToken,
  });
}

export function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
  opts: CallOpts = {},
): Promise<PurchaseRequestDetail> {
  return apiFetch<PurchaseRequestDetail>(`/purchase-requests`, {
    method: 'POST',
    json: input,
    accessToken: opts.accessToken,
  });
}

export function updatePurchaseRequest(
  id: string,
  input: UpdatePurchaseRequestInput,
  opts: CallOpts = {},
): Promise<PurchaseRequestDetail> {
  return apiFetch<PurchaseRequestDetail>(`/purchase-requests/${id}`, {
    method: 'PATCH',
    json: input,
    accessToken: opts.accessToken,
  });
}

export function cancelPurchaseRequest(id: string, opts: CallOpts = {}): Promise<void> {
  return apiFetch<void>(`/purchase-requests/${id}`, {
    method: 'DELETE',
    accessToken: opts.accessToken,
  });
}

export function submitPurchaseRequest(
  id: string,
  opts: CallOpts = {},
): Promise<PurchaseRequest> {
  return apiFetch<PurchaseRequest>(`/purchase-requests/${id}/submit`, {
    method: 'POST',
    json: {},
    accessToken: opts.accessToken,
  });
}

export interface ApprovalDecisionResponse {
  prId: string;
  status: PrStatus;
  nextStepRole: string | null;
  splittingWarning?: boolean;
}

export function approvePurchaseRequest(
  id: string,
  comment?: string,
  opts: CallOpts = {},
): Promise<ApprovalDecisionResponse> {
  return apiFetch<ApprovalDecisionResponse>(`/purchase-requests/${id}/approve`, {
    method: 'POST',
    json: { comment },
    accessToken: opts.accessToken,
  });
}

export function rejectPurchaseRequest(
  id: string,
  reason: string,
  opts: CallOpts = {},
): Promise<PurchaseRequest> {
  return apiFetch<PurchaseRequest>(`/purchase-requests/${id}/reject`, {
    method: 'POST',
    json: { reason },
    accessToken: opts.accessToken,
  });
}

export function returnPurchaseRequestForChanges(
  id: string,
  comment: string,
  opts: CallOpts = {},
): Promise<PurchaseRequest> {
  return apiFetch<PurchaseRequest>(`/purchase-requests/${id}/return-for-changes`, {
    method: 'POST',
    json: { comment },
    accessToken: opts.accessToken,
  });
}

// =====================================================================
//  Purchase Orders
// =====================================================================

export interface ListPoQuery {
  status?: PoStatus;
  page?: number;
  pageSize?: number;
  search?: string;
}

export function listPurchaseOrders(
  query: ListPoQuery,
  opts: CallOpts = {},
): Promise<ListResponse<PurchaseOrder>> {
  return apiFetch<ListResponse<PurchaseOrder>>(`/purchase-orders${qs(query)}`, {
    accessToken: opts.accessToken,
  });
}

export function getPurchaseOrder(id: string, opts: CallOpts = {}): Promise<PurchaseOrderDetail> {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`, {
    accessToken: opts.accessToken,
  });
}

export interface CreatePoFromPrInput {
  supplierId: string;
  expectedDate?: string;
  incoterm?: string;
  deliveryAddress?: string;
}

export function createPoFromPr(
  prId: string,
  input: CreatePoFromPrInput,
  opts: CallOpts = {},
): Promise<PurchaseOrderDetail> {
  return apiFetch<PurchaseOrderDetail>(`/purchase-orders/from-pr/${prId}`, {
    method: 'POST',
    json: input,
    accessToken: opts.accessToken,
  });
}

export function sendPurchaseOrder(id: string, opts: CallOpts = {}): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/send`, {
    method: 'POST',
    json: {},
    accessToken: opts.accessToken,
  });
}

export function acknowledgePurchaseOrder(
  id: string,
  contactEmail?: string,
  opts: CallOpts = {},
): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/acknowledge`, {
    method: 'POST',
    json: { contactEmail },
    accessToken: opts.accessToken,
  });
}

export function cancelPurchaseOrder(
  id: string,
  reason: string,
  opts: CallOpts = {},
): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {
    method: 'POST',
    json: { reason },
    accessToken: opts.accessToken,
  });
}

// =====================================================================
//  Goods Receipts
// =====================================================================

export interface ListGrQuery {
  status?: GrStatus;
  poId?: string;
  page?: number;
  pageSize?: number;
}

export function listGoodsReceipts(
  query: ListGrQuery,
  opts: CallOpts = {},
): Promise<ListResponse<GoodsReceipt>> {
  return apiFetch<ListResponse<GoodsReceipt>>(`/goods-receipts${qs(query)}`, {
    accessToken: opts.accessToken,
  });
}

export function getGoodsReceipt(id: string, opts: CallOpts = {}): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/${id}`, {
    accessToken: opts.accessToken,
  });
}

export interface CreateGrFromPoInput {
  receiptDate?: string;
  deliveryNoteRef?: string;
  coldChainRequired?: boolean;
  notes?: string;
}

export function createGrFromPo(
  poId: string,
  input: CreateGrFromPoInput,
  opts: CallOpts = {},
): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/from-po/${poId}`, {
    method: 'POST',
    json: input,
    accessToken: opts.accessToken,
  });
}

export interface PatchGrLineInput {
  lineId: string;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string;
  coldChainOk?: boolean;
  qualityCheck?: string;
}

export function updateGrLine(
  grId: string,
  input: PatchGrLineInput,
  opts: CallOpts = {},
): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/${grId}/lines`, {
    method: 'POST',
    json: input,
    accessToken: opts.accessToken,
  });
}

export function completeGoodsReceipt(
  id: string,
  opts: CallOpts = {},
): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/${id}/complete`, {
    method: 'POST',
    json: {},
    accessToken: opts.accessToken,
  });
}

export function cancelGoodsReceipt(
  id: string,
  reason: string,
  opts: CallOpts = {},
): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/${id}/cancel`, {
    method: 'POST',
    json: { reason },
    accessToken: opts.accessToken,
  });
}

export function rejectGoodsReceipt(
  id: string,
  reason: string,
  opts: CallOpts = {},
): Promise<GoodsReceiptDetail> {
  return apiFetch<GoodsReceiptDetail>(`/goods-receipts/${id}/reject`, {
    method: 'POST',
    json: { reason },
    accessToken: opts.accessToken,
  });
}
