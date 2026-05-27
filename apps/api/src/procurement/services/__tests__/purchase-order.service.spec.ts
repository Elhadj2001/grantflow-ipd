import { Prisma, PoStatus, PrStatus, PrType } from '@prisma/client';
import type { PurchaseOrder, PurchaseRequest, PurchaseRequestLine } from '@prisma/client';
import { PurchaseOrderService } from '../purchase-order.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import {
  EntityNotFoundException,
  PoCurrencyMismatchException,
  PoNotAcknowledgeableException,
  PoNotCancellableException,
  PoNotEditableException,
  PoNotSendableException,
  PoNoPdfException,
  PrAlreadyHasPoException,
  PrNotApprovedException,
  PrNotOwnedException,
  PrTypePettyCashNoPoException,
  SupplierInactiveException,
} from '../../../common/exceptions/business.exception';

describe('PurchaseOrderService', () => {
  let prisma: {
    purchaseRequest: { findUnique: jest.Mock; findMany: jest.Mock };
    purchaseOrder: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
    purchaseOrderPr: { findFirst: jest.Mock };
    supplier: { findUnique: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };
  let pdf: { generate: jest.Mock };
  let mail: { send: jest.Mock };
  let storage: { putObject: jest.Mock; getObject: jest.Mock };
  let posting: { createCommitmentEntry: jest.Mock; reverseCommitmentEntry: jest.Mock; listEntriesForPo: jest.Mock };
  let svc: PurchaseOrderService;

  const userOwn = 'usr00000-0000-0000-0000-000000000001';
  const projectId = 'prj00000-0000-0000-0000-000000000010';
  const grantId = 'grt00000-0000-0000-0000-000000000020';
  const blId = 'bl000000-0000-0000-0000-000000000030';
  const supplierId = 'sup00000-0000-0000-0000-000000000040';
  const prId = 'pr000000-0000-0000-0000-000000000050';
  const poId = 'po000000-0000-0000-0000-000000000060';

  const acheteur: AuthenticatedUser = {
    id: 'kc-ach', email: 'a@x', fullName: 'A', roles: ['ACHETEUR'],
  };
  const demandeur: AuthenticatedUser = {
    id: 'kc-dem', email: 'd@x', fullName: 'D', roles: ['DEMANDEUR'],
  };
  const sa: AuthenticatedUser = {
    id: 'kc-sa', email: 'sa@x', fullName: 'SA', roles: ['SUPER_ADMIN'],
  };

  function makePr(overrides: Partial<PurchaseRequest> = {}, lines: Partial<PurchaseRequestLine>[] = []): PurchaseRequest & { lines: PurchaseRequestLine[] } {
    const base = {
      id: prId,
      prNumber: 'DA-2026-0001',
      requestedBy: userOwn,
      requestedAt: new Date(),
      neededBy: null,
      status: PrStatus.approved,
      projectId, grantId,
      costCenterId: null, activityId: null,
      totalAmount: new Prisma.Decimal('100000'),
      currency: 'XOF',
      description: 'Pipettes',
      requestType: PrType.standard,
      rejectionReason: null,
      cashBoxId: null,
      updatedAt: new Date(),
      ...overrides,
    } as PurchaseRequest;
    return {
      ...base,
      lines: lines.length > 0
        ? lines.map((l, i) => ({
            id: `l-${i}`,
            prId: base.id,
            lineNumber: i + 1,
            description: 'Item',
            quantity: new Prisma.Decimal('1'),
            unit: 'unit',
            unitPrice: new Prisma.Decimal('100000'),
            lineTotal: new Prisma.Decimal('100000'),
            budgetLineId: blId,
            defaultAccount: null,
            ...l,
          } as PurchaseRequestLine))
        : [{
            id: 'l-0', prId: base.id, lineNumber: 1, description: 'Pipette',
            quantity: new Prisma.Decimal('1'), unit: 'unit',
            unitPrice: new Prisma.Decimal('100000'),
            lineTotal: new Prisma.Decimal('100000'),
            budgetLineId: blId, defaultAccount: null,
          } as PurchaseRequestLine],
    };
  }

  function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return {
      id: poId,
      poNumber: 'BC-2026-0001',
      prId,
      supplierId,
      orderDate: new Date(),
      expectedDate: null,
      status: PoStatus.draft,
      totalHt: new Prisma.Decimal('100000'),
      totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('100000'),
      currency: 'XOF',
      incoterm: null,
      deliveryAddress: null,
      buyerId: null,
      sentAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      cancelledAt: null,
      cancellationReason: null,
      pdfObjectKey: null,
      emailSentAt: null,
      emailSentTo: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      purchaseRequest: { findUnique: jest.fn(), findMany: jest.fn() },
      purchaseOrder: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      purchaseOrderPr: { findFirst: jest.fn().mockResolvedValue(null) },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({
          id: supplierId, code: 'ACME-001', name: 'ACME',
          address: 'paris', country: 'FR',
          contactEmail: 'sales@acme.example',
          paymentTermsDays: 30, isActive: true,
        }),
      },
      appUser: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) => {
          const map: Record<string, string> = { 'a@x': 'app-a', 'd@x': userOwn, 'sa@x': 'app-sa' };
          return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
        }),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    pdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')) };
    mail = { send: jest.fn().mockResolvedValue({ delivered: true, to: 'sales@acme.example', messageId: 'msg-1', error: null }) };
    storage = {
      putObject: jest.fn().mockResolvedValue({ objectKey: 'pos/2026/05/po-id.pdf', bucket: 'grantflow-pos' }),
      getObject: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 mock'), contentType: 'application/pdf', size: 14 }),
    };
    posting = {
      createCommitmentEntry: jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'OD-2026-0001' }),
      reverseCommitmentEntry: jest.fn().mockResolvedValue({ id: 'je-2', entryNumber: 'OD-2026-0002' }),
      listEntriesForPo: jest.fn().mockResolvedValue([]),
    };
    svc = new PurchaseOrderService(
      prisma as unknown as PrismaService,
      pdf as never,
      mail as never,
      storage as never,
      posting as never,
    );
  });

  // ------------------------------------------------------------------
  describe('createFromPr', () => {
    it('happy path : creates PO, recopies lines, links pr in purchase_order_pr', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.purchaseOrder.create.mockResolvedValue(makePo({ poNumber: 'BC-2026-0001' }));
      const res = await svc.createFromPr(acheteur, prId, { supplierId });
      expect(res.poNumber).toBe('BC-2026-0001');
      const data = prisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.prLinks.create).toEqual([{ prId }]);
      expect(data.lines.create).toHaveLength(1);
    });

    it('rejects when PR not approved', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ status: PrStatus.pending_pi }));
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrNotApprovedException,
      );
    });

    it('rejects when PR is petty_cash', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: PrType.petty_cash }));
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrTypePettyCashNoPoException,
      );
    });

    it('rejects when PR already has an active PO', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.purchaseOrderPr.findFirst.mockResolvedValue({ poId: 'existing-po' });
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrAlreadyHasPoException,
      );
    });

    it('rejects when supplier is inactive', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.supplier.findUnique.mockResolvedValue({
        id: supplierId, isActive: false, name: 'Frenchies', code: 'FR', paymentTermsDays: 30,
        address: null, country: null, contactEmail: null,
      });
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        SupplierInactiveException,
      );
    });

    it('rejects when PR not found', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(null);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('totalHt = sum(lineTotal)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({}, [
          { lineTotal: new Prisma.Decimal('30000') },
          { lineTotal: new Prisma.Decimal('70000') },
        ]),
      );
      prisma.purchaseOrder.create.mockResolvedValue(makePo());
      await svc.createFromPr(acheteur, prId, { supplierId });
      const data = prisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.totalHt).toBe(100000);
    });
  });

  // ------------------------------------------------------------------
  describe('createFromMultiplePrs', () => {
    it('happy path : merges N PRs into 1 PO with consolidated lines', async () => {
      const pr1 = makePr({ id: 'pr-A', prNumber: 'DA-2026-0001' }, [
        { description: 'Gants L', quantity: new Prisma.Decimal('100'), unitPrice: new Prisma.Decimal('500'), lineTotal: new Prisma.Decimal('50000') },
      ]);
      const pr2 = makePr({ id: 'pr-B', prNumber: 'DA-2026-0002' }, [
        { description: 'gants l', quantity: new Prisma.Decimal('50'), unitPrice: new Prisma.Decimal('500'), lineTotal: new Prisma.Decimal('25000') },
        { description: 'Masques', quantity: new Prisma.Decimal('20'), unitPrice: new Prisma.Decimal('1000'), lineTotal: new Prisma.Decimal('20000') },
      ]);
      prisma.purchaseRequest.findMany.mockResolvedValue([pr1, pr2]);
      prisma.purchaseOrder.create.mockResolvedValue(makePo({ poNumber: 'BC-2026-0001' }));

      await svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId });

      const data = prisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.lines.create).toHaveLength(2); // gants fusionnés + masques séparés
      const gants = data.lines.create.find((l: { description: string }) => l.description.toLowerCase() === 'gants l');
      expect(Number(gants.quantity)).toBe(150);
      expect(data.prLinks.create).toHaveLength(2);
    });

    it('rejects empty list', async () => {
      await expect(svc.createFromMultiplePrs(acheteur, { prIds: [], supplierId })).rejects.toThrow(
        /At least one purchase request/,
      );
    });

    it('rejects when one PR is not approved', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([
        makePr({ id: 'pr-A', status: PrStatus.approved }),
        makePr({ id: 'pr-B', status: PrStatus.pending_pi }),
      ]);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PrNotApprovedException);
    });

    it('rejects when PRs have heterogeneous currencies', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([
        makePr({ id: 'pr-A', currency: 'XOF' }),
        makePr({ id: 'pr-B', currency: 'EUR' }),
      ]);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PoCurrencyMismatchException);
    });

    it('rejects when any PR is petty_cash', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([
        makePr({ id: 'pr-A', requestType: PrType.standard }),
        makePr({ id: 'pr-B', requestType: PrType.petty_cash }),
      ]);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PrTypePettyCashNoPoException);
    });

    it('rejects when one PR is missing', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([makePr({ id: 'pr-A' })]);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-missing'], supplierId }),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('update', () => {
    it('updates incoterm/expectedDate/deliveryAddress in draft', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] });
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), incoterm: 'CIF', lines: [], prLinks: [{ prId }] });
      await svc.update(acheteur, poId, { incoterm: 'CIF' });
      expect(prisma.purchaseOrder.update).toHaveBeenCalled();
    });

    it('rejects when status ≠ draft', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo({ status: PoStatus.sent }), lines: [], prLinks: [{ prId }],
      });
      await expect(svc.update(acheteur, poId, { incoterm: 'CIF' })).rejects.toBeInstanceOf(
        PoNotEditableException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('send', () => {
    it('happy path : PDF + MinIO + commitment entry + email', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(),
        lines: [{ id: 'l-1', lineNumber: 1, description: 'X', quantity: new Prisma.Decimal('1'), unit: 'unit', unitPrice: new Prisma.Decimal('100000'), lineTotal: new Prisma.Decimal('100000'), budgetLineId: blId }],
        prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([{ prNumber: 'DA-2026-0001' }]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent, pdfObjectKey: 'pos/2026/05/po-id.pdf' });

      const res = await svc.send(acheteur, poId);

      expect(pdf.generate).toHaveBeenCalled();
      expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'grantflow-pos' }));
      expect(posting.createCommitmentEntry).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalled();
      expect(res.commitmentEntryNumber).toBe('OD-2026-0001');
      expect(res.emailDelivered).toBe(true);
      expect(res.pdfObjectKey).toMatch(/^pos\/\d{4}\/\d{2}\//);
    });

    it('rejects when status ≠ draft', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo({ status: PoStatus.sent }), lines: [], prLinks: [{ prId }],
      });
      await expect(svc.send(acheteur, poId)).rejects.toBeInstanceOf(PoNotSendableException);
    });

    it('still succeeds if email fails (delivered=false, PO sent)', async () => {
      mail.send.mockResolvedValue({ delivered: false, to: 'sales@acme.example', messageId: null, error: 'SMTP down' });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent });
      const res = await svc.send(acheteur, poId);
      expect(res.emailDelivered).toBe(false);
      expect(res.emailError).toBe('SMTP down');
      expect(posting.createCommitmentEntry).toHaveBeenCalled(); // engagement créé quand même
    });

    it('logs warning when supplier has no contact email but still sends', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: supplierId, isActive: true, name: 'NoMail Inc', code: 'NM',
        paymentTermsDays: 30, address: null, country: null, contactEmail: null,
      });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent });
      const res = await svc.send(acheteur, poId);
      expect(res.emailDelivered).toBe(false);
      expect(res.emailDispatched).toBe(false);
      expect(res.emailSkippedReason).toBe('no-contact-email');
      expect(res.emailError).toBe('No supplier contact email');
      expect(mail.send).not.toHaveBeenCalled();
    });

    // Sprint F-PO-EMAIL — exposition emailDispatched + emailSkippedReason
    it('happy path expose emailDispatched=true + emailSkippedReason=null', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent });
      const res = await svc.send(acheteur, poId);
      expect(res.emailDispatched).toBe(true);
      expect(res.emailSkippedReason).toBeNull();
    });

    it('smtp-error : emailSkippedReason="smtp-error" + engagement créé', async () => {
      mail.send.mockResolvedValue({
        delivered: false,
        to: 'sales@acme.example',
        messageId: null,
        error: 'connect ECONNREFUSED 127.0.0.1:1025',
      });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent });
      const res = await svc.send(acheteur, poId);
      expect(res.emailDispatched).toBe(false);
      expect(res.emailSkippedReason).toBe('smtp-error');
      expect(res.emailError).toMatch(/ECONNREFUSED/);
      expect(posting.createCommitmentEntry).toHaveBeenCalled();
    });

    // Sprint F-PO-EMAIL — confidentialité : aucun log ne doit contenir
    // l'e-mail en clair (que ce soit succès ou échec SMTP).
    it('logs masquent toujours l\'e-mail du fournisseur', async () => {
      const SECRET_EMAIL = 'top-secret-customer@confidential.example';
      // Cas A : SMTP succès → log "PO email dispatched" doit masquer.
      mail.send.mockResolvedValue({
        delivered: true,
        to: SECRET_EMAIL,
        messageId: 'msg-1',
        error: null,
      });
      // Inject l'e-mail confidentiel côté supplier.
      const supplierFixture = {
        id: supplierId, isActive: true, name: 'Acme', code: 'A',
        paymentTermsDays: 30, address: null, country: null,
        contactEmail: SECRET_EMAIL,
      };
      prisma.supplier.findUnique.mockResolvedValue(supplierFixture);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      });
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logSpy = jest.spyOn((svc as any).logger, 'log');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = jest.spyOn((svc as any).logger, 'warn');
      await svc.send(acheteur, poId);

      const allArgs = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat();
      for (const a of allArgs) {
        const text = typeof a === 'string' ? a : JSON.stringify(a);
        // Le local-part complet ne doit JAMAIS apparaître (maskEmail
        // garde la 1ère lettre, masque le reste).
        expect(text).not.toContain('top-secret-customer');
      }
    });
  });

  // ------------------------------------------------------------------
  describe('acknowledge', () => {
    it('happy path : sent → acknowledged with ackRef', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.sent }));
      prisma.purchaseOrder.update.mockResolvedValue(
        makePo({ status: PoStatus.acknowledged, acknowledgedBy: 'ACK-12345' }),
      );
      const res = await svc.acknowledge(acheteur, poId, { ackRef: 'ACK-12345' });
      expect(res.status).toBe(PoStatus.acknowledged);
    });

    it('rejects when status ≠ sent', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.draft }));
      await expect(svc.acknowledge(acheteur, poId, { ackRef: 'X' })).rejects.toBeInstanceOf(
        PoNotAcknowledgeableException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('draft → cancelled (no reverse needed)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.draft }));
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }));
      const res = await svc.cancel(acheteur, poId, { reason: 'Fournisseur faillite' });
      expect(res.po.status).toBe(PoStatus.cancelled);
      expect(res.reverseEntryId).toBeNull();
      expect(posting.reverseCommitmentEntry).not.toHaveBeenCalled();
    });

    it('sent → cancelled with reverse entry created', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.sent }));
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }));
      const res = await svc.cancel(acheteur, poId, { reason: 'Hors budget' });
      expect(res.reverseEntryNumber).toBe('OD-2026-0002');
      expect(posting.reverseCommitmentEntry).toHaveBeenCalled();
    });

    it('acknowledged → cancelled also creates reverse', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.acknowledged }));
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }));
      const res = await svc.cancel(acheteur, poId, { reason: 'Annulation' });
      expect(posting.reverseCommitmentEntry).toHaveBeenCalled();
      expect(res.reverseEntryId).toBe('je-2');
    });

    it('rejects cancel on partially_received/received/invoiced/closed', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.received }));
      await expect(svc.cancel(acheteur, poId, { reason: 'X1234' })).rejects.toBeInstanceOf(
        PoNotCancellableException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('downloadPdf', () => {
    it('returns Buffer with proper filename', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        makePo({ pdfObjectKey: 'pos/2026/05/po.pdf', poNumber: 'BC-2026-0042' }),
      );
      const res = await svc.downloadPdf(acheteur, poId);
      expect(res.filename).toBe('BC-2026-0042.pdf');
      expect(res.contentType).toBe('application/pdf');
      expect(res.buffer).toBeInstanceOf(Buffer);
    });

    it('throws PO_NO_PDF when not yet sent', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ pdfObjectKey: null }));
      await expect(svc.downloadPdf(acheteur, poId)).rejects.toBeInstanceOf(PoNoPdfException);
    });
  });

  // ------------------------------------------------------------------
  describe('findMany / RBAC scope', () => {
    it('DEMANDEUR sees only POs linked to own PRs', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await svc.findMany(demandeur, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const args = prisma.purchaseOrder.findMany.mock.calls[0][0];
      expect(args.where.prLinks).toEqual({ some: { pr: { requestedBy: userOwn } } });
    });

    it('SUPER_ADMIN sees all POs (no ownership filter)', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await svc.findMany(sa, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const args = prisma.purchaseOrder.findMany.mock.calls[0][0];
      expect(args.where.prLinks).toBeUndefined();
    });

    it('filters by supplierId + status + q', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      await svc.findMany(acheteur, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
        supplierId, status: PoStatus.sent, q: 'BC-2026',
      } as never);
      const args = prisma.purchaseOrder.findMany.mock.calls[0][0];
      expect(args.where.supplierId).toBe(supplierId);
      expect(args.where.status).toBe(PoStatus.sent);
      expect(args.where.OR).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  describe('findOne ownership', () => {
    it('DEMANDEUR sees PO linked to their PR', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] });
      prisma.purchaseOrderPr.findFirst.mockResolvedValue({ poId });
      const res = await svc.findOne(demandeur, poId);
      expect(res.id).toBe(poId);
    });

    it('foreign DEMANDEUR gets 404 (obscurity)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] });
      prisma.purchaseOrderPr.findFirst.mockResolvedValue(null);
      await expect(svc.findOne(demandeur, poId)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ------------------------------------------------------------------
  describe('resend', () => {
    it('re-fetches PDF from MinIO and resends without recreating entry', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        makePo({ status: PoStatus.sent, pdfObjectKey: 'pos/2026/05/po.pdf' }),
      );
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.sent }));
      const res = await svc.resend(acheteur, poId);
      expect(storage.getObject).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalled();
      expect(posting.createCommitmentEntry).not.toHaveBeenCalled();
      expect(res.delivered).toBe(true);
    });

    it('throws PO_NO_PDF if pdf not stored', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ pdfObjectKey: null }));
      await expect(svc.resend(acheteur, poId)).rejects.toBeInstanceOf(PoNoPdfException);
    });
  });
});
