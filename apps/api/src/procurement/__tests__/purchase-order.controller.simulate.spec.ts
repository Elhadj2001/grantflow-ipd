/**
 * Sprint F-INVOICE-SIM — tests du gating par flag de l'endpoint
 * POST /purchase-orders/:id/simulate-invoice.
 *
 * On teste UNIQUEMENT la logique custom du controller (le flag runtime +
 * le routage download/inject vers la Response). Le gating par rôle
 * (@Roles) est géré par le framework et couvert en e2e.
 */
import { PurchaseOrderController } from '../purchase-order.controller';
import { DemoFeatureDisabledException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

describe('PurchaseOrderController — simulate-invoice gating (F-INVOICE-SIM)', () => {
  const user: AuthenticatedUser = {
    id: 'kc-sa',
    email: 'sa@x',
    fullName: 'SA',
    roles: ['SUPER_ADMIN'],
  };
  const poId = 'po000000-0000-0000-0000-000000000060';

  let svc: { simulateInvoice: jest.Mock };
  let controller: PurchaseOrderController;
  const ORIGINAL_FLAG = process.env.ENABLE_DEMO_INVOICE_SIMULATOR;

  /** Fabrique un objet Response express minimaliste pour capter la sortie. */
  function makeRes() {
    const res: Record<string, unknown> = {};
    res.setHeader = jest.fn();
    res.end = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as unknown as import('express').Response & {
      setHeader: jest.Mock;
      end: jest.Mock;
      status: jest.Mock;
      json: jest.Mock;
    };
  }

  beforeEach(() => {
    svc = { simulateInvoice: jest.fn() };
    // posting service non utilisé par cet endpoint — mock vide.
    controller = new PurchaseOrderController(
      svc as never,
      {} as never,
    );
  });

  afterEach(() => {
    process.env.ENABLE_DEMO_INVOICE_SIMULATOR = ORIGINAL_FLAG;
    jest.restoreAllMocks();
  });

  it('flag OFF → 404 DemoFeatureDisabledException, service non appelé', async () => {
    process.env.ENABLE_DEMO_INVOICE_SIMULATOR = 'false';
    const res = makeRes();
    await expect(
      controller.simulateInvoice(user, poId, { mode: 'download' }, res),
    ).rejects.toBeInstanceOf(DemoFeatureDisabledException);
    expect(svc.simulateInvoice).not.toHaveBeenCalled();
  });

  it('flag absent → 404 (comportement par défaut prod)', async () => {
    delete process.env.ENABLE_DEMO_INVOICE_SIMULATOR;
    const res = makeRes();
    await expect(
      controller.simulateInvoice(user, poId, { mode: 'inject' }, res),
    ).rejects.toBeInstanceOf(DemoFeatureDisabledException);
  });

  it('flag ON + mode download → renvoie le PDF (headers + end)', async () => {
    process.env.ENABLE_DEMO_INVOICE_SIMULATOR = 'true';
    svc.simulateInvoice.mockResolvedValue({
      mode: 'download',
      pdfBuffer: Buffer.from('%PDF-1.4 demo'),
      filename: 'FAC-SIM-BC-2026-0001-1.pdf',
    });
    const res = makeRes();
    await controller.simulateInvoice(user, poId, { mode: 'download' }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="FAC-SIM-BC-2026-0001-1.pdf"',
    );
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('flag ON + mode inject → renvoie 201 JSON { invoiceId, mode }', async () => {
    process.env.ENABLE_DEMO_INVOICE_SIMULATOR = 'true';
    svc.simulateInvoice.mockResolvedValue({
      mode: 'inject',
      invoiceId: 'inv-sim-1',
      invoiceNumber: 'FAC-SIM-BC-2026-0001-1',
    });
    const res = makeRes();
    await controller.simulateInvoice(user, poId, { mode: 'inject' }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-sim-1', mode: 'inject' }),
    );
  });
});
