import { Prisma, PoStatus, PrStatus, PrType } from '@prisma/client';
import type { PurchaseOrder, PurchaseRequest, PurchaseRequestLine } from '@prisma/client';
import { PurchaseOrderService } from '../purchase-order.service';
import { createPrismaMock, type PrismaMock } from '../../../test-utils/prisma-mock';
import { useFakeDate, restoreRealDate } from '../../../test-utils/fake-time';
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
  // US-062 (fix F22) : horloge figée → numéros BC-YYYY-NNNN et horodatages
  // par défaut déterministes, indépendants de la date d'exécution.
  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  let prisma: PrismaMock;
  let pdf: { generate: jest.Mock };
  let mail: { send: jest.Mock };
  let storage: { putObject: jest.Mock; getObject: jest.Mock };
  let posting: { createCommitmentEntry: jest.Mock; reverseCommitmentEntry: jest.Mock; listEntriesForPo: jest.Mock };
  let supplierInvoicePdf: { generate: jest.Mock };
  let invoiceSvc: { createFromSimulatedPdf: jest.Mock };
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
      // US-003-bis : colonnes multidevise ADR-005 (nullable, non testées ici).
      total_ht_xof: null,
      total_vat_xof: null,
      total_ttc_xof: null,
      fx_rate: null,
      fx_rate_date: null,
      ...overrides,
    };
  }

  // Projection typée du `data` passé à purchaseOrder.create (l'union Prisma
  // CreateArgs n'est pas indexable telle quelle — TS7053). On ne déclare que
  // les champs réellement lus par les assertions.
  type CreateLineArg = { description: string; quantity: Prisma.Decimal };
  type CreateDataArg = {
    totalHt: Prisma.Decimal;
    lines: { create: CreateLineArg[] };
    prLinks: { create: { prId: string }[] };
  };
  const createDataOf = (calls: unknown[][]): CreateDataArg =>
    (calls[0][0] as { data: CreateDataArg }).data;

  // Projection typée du `where` passé à purchaseOrder.findMany (les args
  // Prisma sont `... | undefined`, non lisibles directement par les assertions).
  type WhereArg = {
    prLinks?: unknown;
    supplierId?: string;
    status?: PoStatus;
    OR?: unknown;
  };
  const whereOf = (calls: unknown[][]): WhereArg =>
    (calls[0][0] as { where: WhereArg }).where;

  beforeEach(() => {
    // F2 : mock Prisma profond partagé — auto-stube toute méthode (dont
    // `tx.purchaseOrder.findFirst` du générateur de n° BC) et pré-stube
    // `$transaction` (forme callback → re-passe le mock comme `tx`).
    prisma = createPrismaMock();
    prisma.purchaseOrder.count.mockResolvedValue(0 as never);
    prisma.purchaseOrderPr.findFirst.mockResolvedValue(null as never);
    prisma.supplier.findUnique.mockResolvedValue({
      id: supplierId, code: 'ACME-001', name: 'ACME',
      address: 'paris', country: 'FR',
      contactEmail: 'sales@acme.example',
      paymentTermsDays: 30, isActive: true,
    } as never);
    prisma.appUser.findUnique.mockImplementation((({ where }: { where: { email: string } }) => {
      const map: Record<string, string> = { 'a@x': 'app-a', 'd@x': userOwn, 'sa@x': 'app-sa' };
      return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
    }) as never);
    // Sprint F-INVOICE-SIM : compteur d'invoices SIM (séquence n° facture).
    prisma.invoice.count.mockResolvedValue(0 as never);
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
    // Sprint F-INVOICE-SIM : nouveaux deps injectés.
    supplierInvoicePdf = {
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 sim-invoice')),
    };
    invoiceSvc = {
      createFromSimulatedPdf: jest.fn().mockResolvedValue({ id: 'inv-sim-1', invoiceNumber: 'FAC-SIM-X' }),
    };
    svc = new PurchaseOrderService(
      prisma,
      pdf as never,
      mail as never,
      storage as never,
      posting as never,
      supplierInvoicePdf as never,
      invoiceSvc as never,
      // US-097 : stub fx identité XOF (xofAmount ENTIER, contrat du service).
      {
        convertToXof: jest.fn(async (amount: number | { toString(): string }) => ({
          xofAmount: Math.round(Number(amount)),
          fxRate: 1,
          fxRateDate: new Date('2026-06-15'),
          isIndicativeFallback: false,
        })),
      } as never,
    );
  });

  // ------------------------------------------------------------------
  describe('createFromPr', () => {
    it('happy path : creates PO, recopies lines, links pr in purchase_order_pr', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr() as never);
      prisma.purchaseOrder.create.mockResolvedValue(makePo({ poNumber: 'BC-2026-0001' }) as never);
      const res = await svc.createFromPr(acheteur, prId, { supplierId });
      expect(res.poNumber).toBe('BC-2026-0001');
      const data = createDataOf(prisma.purchaseOrder.create.mock.calls);
      expect(data.prLinks.create).toEqual([{ prId }]);
      expect(data.lines.create).toHaveLength(1);
    });

    it('rejects when PR not approved', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ status: PrStatus.pending_pi }) as never);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrNotApprovedException,
      );
    });

    it('rejects when PR is petty_cash', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: PrType.petty_cash }) as never);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrTypePettyCashNoPoException,
      );
    });

    it('rejects when PR already has an active PO', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr() as never);
      prisma.purchaseOrderPr.findFirst.mockResolvedValue({ poId: 'existing-po' } as never);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        PrAlreadyHasPoException,
      );
    });

    it('rejects when supplier is inactive', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr() as never);
      prisma.supplier.findUnique.mockResolvedValue({
        id: supplierId, isActive: false, name: 'Frenchies', code: 'FR', paymentTermsDays: 30,
        address: null, country: null, contactEmail: null,
      } as never);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        SupplierInactiveException,
      );
    });

    it('rejects when PR not found', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(null as never);
      await expect(svc.createFromPr(acheteur, prId, { supplierId })).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('totalHt = sum(lineTotal)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({}, [
          { lineTotal: new Prisma.Decimal('30000') },
          { lineTotal: new Prisma.Decimal('70000') },
        ]) as never,
      );
      prisma.purchaseOrder.create.mockResolvedValue(makePo() as never);
      await svc.createFromPr(acheteur, prId, { supplierId });
      const data = createDataOf(prisma.purchaseOrder.create.mock.calls);
      expect(Number(data.totalHt)).toBe(100000);
    });

    // US-097 (F-S8-14) : le triplet XOF est figé à la création du BC.
    it('US-097 — triplet XOF persisté (total_ht_xof BigInt + fx_rate + fx_rate_date)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({}, [{ lineTotal: new Prisma.Decimal('30000') }]) as never,
      );
      prisma.purchaseOrder.create.mockResolvedValue(makePo() as never);
      await svc.createFromPr(acheteur, prId, { supplierId });
      const data = createDataOf(prisma.purchaseOrder.create.mock.calls) as unknown as {
        total_ht_xof: bigint;
        total_ttc_xof: bigint;
        fx_rate: number;
        fx_rate_date: Date;
        lines: { create: Array<{ unit_price_xof: bigint }> };
      };
      expect(data.total_ht_xof).toBe(BigInt(30000));
      expect(data.total_ttc_xof).toBe(BigInt(30000));
      expect(data.fx_rate).toBe(1);
      expect(data.fx_rate_date).toBeInstanceOf(Date);
      expect(typeof data.lines.create[0].unit_price_xof).toBe('bigint');
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
      prisma.purchaseRequest.findMany.mockResolvedValue([pr1, pr2] as never);
      prisma.purchaseOrder.create.mockResolvedValue(makePo({ poNumber: 'BC-2026-0001' }) as never);

      await svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId });

      const data = createDataOf(prisma.purchaseOrder.create.mock.calls);
      expect(data.lines.create).toHaveLength(2); // gants fusionnés + masques séparés
      const gants = data.lines.create.find((l) => l.description.toLowerCase() === 'gants l');
      expect(Number(gants?.quantity)).toBe(150);
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
      ] as never);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PrNotApprovedException);
    });

    it('rejects when PRs have heterogeneous currencies', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([
        makePr({ id: 'pr-A', currency: 'XOF' }),
        makePr({ id: 'pr-B', currency: 'EUR' }),
      ] as never);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PoCurrencyMismatchException);
    });

    it('rejects when any PR is petty_cash', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([
        makePr({ id: 'pr-A', requestType: PrType.standard }),
        makePr({ id: 'pr-B', requestType: PrType.petty_cash }),
      ] as never);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-B'], supplierId }),
      ).rejects.toBeInstanceOf(PrTypePettyCashNoPoException);
    });

    it('rejects when one PR is missing', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([makePr({ id: 'pr-A' })] as never);
      await expect(
        svc.createFromMultiplePrs(acheteur, { prIds: ['pr-A', 'pr-missing'], supplierId }),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('update', () => {
    it('updates incoterm/expectedDate/deliveryAddress in draft', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] } as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), incoterm: 'CIF', lines: [], prLinks: [{ prId }] } as never);
      await svc.update(acheteur, poId, { incoterm: 'CIF' });
      expect(prisma.purchaseOrder.update).toHaveBeenCalled();
    });

    it('rejects when status ≠ draft', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo({ status: PoStatus.sent }), lines: [], prLinks: [{ prId }],
      } as never);
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
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([{ prNumber: 'DA-2026-0001' }] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent, pdfObjectKey: 'pos/2026/05/po-id.pdf' } as never);

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
      } as never);
      await expect(svc.send(acheteur, poId)).rejects.toBeInstanceOf(PoNotSendableException);
    });

    it('still succeeds if email fails (delivered=false, PO sent)', async () => {
      mail.send.mockResolvedValue({ delivered: false, to: 'sales@acme.example', messageId: null, error: 'SMTP down' });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent } as never);
      const res = await svc.send(acheteur, poId);
      expect(res.emailDelivered).toBe(false);
      expect(res.emailError).toBe('SMTP down');
      expect(posting.createCommitmentEntry).toHaveBeenCalled(); // engagement créé quand même
    });

    it('logs warning when supplier has no contact email but still sends', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: supplierId, isActive: true, name: 'NoMail Inc', code: 'NM',
        paymentTermsDays: 30, address: null, country: null, contactEmail: null,
      } as never);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent } as never);
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
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent } as never);
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
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent } as never);
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
      prisma.supplier.findUnique.mockResolvedValue(supplierFixture as never);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(), lines: [], prLinks: [{ prId }],
      } as never);
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.update.mockResolvedValue({ ...makePo(), status: PoStatus.sent } as never);

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
  // Sprint F-INVOICE-SIM — simulateur de facture (mode démo)
  describe('simulateInvoice', () => {
    const poWithLines = () => ({
      ...makePo({ status: PoStatus.sent }),
      lines: [
        {
          id: 'l-1',
          lineNumber: 1,
          description: 'Réactif PCR',
          quantity: new Prisma.Decimal('10'),
          unit: 'boite',
          unitPrice: new Prisma.Decimal('10000'),
          lineTotal: new Prisma.Decimal('100000'),
          budgetLineId: 'bl-1',
        },
      ],
    });

    it('mode download → renvoie un PDF non vide + filename, ne crée pas d\'Invoice', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(poWithLines() as never);
      prisma.invoice.count.mockResolvedValue(0 as never);
      const res = await svc.simulateInvoice(sa, poId, 'download');
      expect(res.mode).toBe('download');
      if (res.mode === 'download') {
        expect(res.pdfBuffer.length).toBeGreaterThan(0);
        expect(res.filename).toMatch(/^FAC-SIM-BC-2026-0001-1\.pdf$/);
      }
      expect(supplierInvoicePdf.generate).toHaveBeenCalled();
      expect(invoiceSvc.createFromSimulatedPdf).not.toHaveBeenCalled();
    });

    it('mode inject → stocke le PDF + crée l\'Invoice via InvoiceService', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(poWithLines() as never);
      prisma.invoice.count.mockResolvedValue(0 as never);
      const res = await svc.simulateInvoice(sa, poId, 'inject');
      expect(res.mode).toBe('inject');
      if (res.mode === 'inject') {
        expect(res.invoiceId).toBe('inv-sim-1');
      }
      expect(storage.putObject).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'grantflow-invoices' }),
      );
      // TVA 18 % : HT 100000 → TVA 18000 → TTC 118000
      expect(invoiceSvc.createFromSimulatedPdf).toHaveBeenCalledWith(
        sa,
        expect.objectContaining({
          poId,
          supplierId,
          totalHt: 100000,
          totalVat: 18000,
          totalTtc: 118000,
        }),
      );
    });

    // US-096 (F-S8-12) : chaîne TVA/TTC en Decimal — cas où float64 arrondissait
    // FAUX : HT 1,25 → TVA exacte 0,225 → half-up 0,23. L'ancien code float
    // (1.25×0.18×100 = 22.4999999999999964 → Math.round → 22) donnait 0,22.
    it('US-096 — TVA Decimal half-up exacte (HT 1,25 → TVA 0,23, pas 0,22)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo({ status: PoStatus.sent }),
        lines: [
          {
            id: 'l-1',
            lineNumber: 1,
            description: 'Micro-consommable',
            quantity: new Prisma.Decimal('1'),
            unit: 'u',
            unitPrice: new Prisma.Decimal('1.25'),
            lineTotal: new Prisma.Decimal('1.25'),
            budgetLineId: 'bl-1',
          },
        ],
      } as never);
      prisma.invoice.count.mockResolvedValue(0 as never);
      await svc.simulateInvoice(sa, poId, 'inject');
      expect(invoiceSvc.createFromSimulatedPdf).toHaveBeenCalledWith(
        sa,
        expect.objectContaining({
          totalHt: 1.25,
          totalVat: 0.23,
          totalTtc: 1.48, // HT + TVA exact à 2 déc. — aucun re-arrondi
        }),
      );
    });

    it('rejette si le PO n\'est pas en statut sent', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo({ status: PoStatus.draft }),
        lines: [],
      } as never);
      await expect(svc.simulateInvoice(sa, poId, 'download')).rejects.toMatchObject({
        code: 'BUSINESS.PO_NOT_SENT_FOR_SIMULATION',
      });
    });

    it('numéro de facture incrémente selon le nombre d\'invoices SIM existantes', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(poWithLines() as never);
      prisma.invoice.count.mockResolvedValue(2 as never);
      const res = await svc.simulateInvoice(sa, poId, 'download');
      if (res.mode === 'download') {
        expect(res.filename).toBe('FAC-SIM-BC-2026-0001-3.pdf');
      }
    });
  });

  // ------------------------------------------------------------------
  describe('acknowledge', () => {
    it('happy path : sent → acknowledged with ackRef', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.sent }) as never);
      prisma.purchaseOrder.update.mockResolvedValue(
        makePo({ status: PoStatus.acknowledged, acknowledgedBy: 'ACK-12345' }) as never,
      );
      const res = await svc.acknowledge(acheteur, poId, { ackRef: 'ACK-12345' });
      expect(res.status).toBe(PoStatus.acknowledged);
    });

    it('rejects when status ≠ sent', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.draft }) as never);
      await expect(svc.acknowledge(acheteur, poId, { ackRef: 'X' })).rejects.toBeInstanceOf(
        PoNotAcknowledgeableException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('draft → cancelled (no reverse needed)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.draft }) as never);
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }) as never);
      const res = await svc.cancel(acheteur, poId, { reason: 'Fournisseur faillite' });
      expect(res.po.status).toBe(PoStatus.cancelled);
      expect(res.reverseEntryId).toBeNull();
      expect(posting.reverseCommitmentEntry).not.toHaveBeenCalled();
    });

    it('sent → cancelled with reverse entry created', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.sent }) as never);
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }) as never);
      const res = await svc.cancel(acheteur, poId, { reason: 'Hors budget' });
      expect(res.reverseEntryNumber).toBe('OD-2026-0002');
      expect(posting.reverseCommitmentEntry).toHaveBeenCalled();
    });

    it('acknowledged → cancelled also creates reverse', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.acknowledged }) as never);
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.cancelled }) as never);
      const res = await svc.cancel(acheteur, poId, { reason: 'Annulation' });
      expect(posting.reverseCommitmentEntry).toHaveBeenCalled();
      expect(res.reverseEntryId).toBe('je-2');
    });

    it('rejects cancel on partially_received/received/invoiced/closed', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.received }) as never);
      await expect(svc.cancel(acheteur, poId, { reason: 'X1234' })).rejects.toBeInstanceOf(
        PoNotCancellableException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('downloadPdf', () => {
    it('returns Buffer with proper filename', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        makePo({ pdfObjectKey: 'pos/2026/05/po.pdf', poNumber: 'BC-2026-0042' }) as never,
      );
      const res = await svc.downloadPdf(acheteur, poId);
      expect(res.filename).toBe('BC-2026-0042.pdf');
      expect(res.contentType).toBe('application/pdf');
      expect(res.buffer).toBeInstanceOf(Buffer);
    });

    it('throws PO_NO_PDF when not yet sent', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ pdfObjectKey: null }) as never);
      await expect(svc.downloadPdf(acheteur, poId)).rejects.toBeInstanceOf(PoNoPdfException);
    });
  });

  // ------------------------------------------------------------------
  describe('findMany / RBAC scope', () => {
    it('DEMANDEUR sees only POs linked to own PRs', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.count.mockResolvedValue(0 as never);
      await svc.findMany(demandeur, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const where = whereOf(prisma.purchaseOrder.findMany.mock.calls);
      expect(where.prLinks).toEqual({ some: { pr: { requestedBy: userOwn } } });
    });

    it('SUPER_ADMIN sees all POs (no ownership filter)', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.count.mockResolvedValue(0 as never);
      await svc.findMany(sa, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const where = whereOf(prisma.purchaseOrder.findMany.mock.calls);
      expect(where.prLinks).toBeUndefined();
    });

    it('filters by supplierId + status + q', async () => {
      prisma.purchaseOrder.findMany.mockResolvedValue([] as never);
      prisma.purchaseOrder.count.mockResolvedValue(0 as never);
      await svc.findMany(acheteur, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
        supplierId, status: PoStatus.sent, q: 'BC-2026',
      } as never);
      const where = whereOf(prisma.purchaseOrder.findMany.mock.calls);
      expect(where.supplierId).toBe(supplierId);
      expect(where.status).toBe(PoStatus.sent);
      expect(where.OR).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  describe('findOne ownership', () => {
    it('DEMANDEUR sees PO linked to their PR', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] } as never);
      prisma.purchaseOrderPr.findFirst.mockResolvedValue({ poId } as never);
      const res = await svc.findOne(demandeur, poId);
      expect(res.id).toBe(poId);
    });

    it('foreign DEMANDEUR gets 404 (obscurity)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...makePo(), lines: [], prLinks: [{ prId }] } as never);
      prisma.purchaseOrderPr.findFirst.mockResolvedValue(null as never);
      await expect(svc.findOne(demandeur, poId)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ------------------------------------------------------------------
  describe('resend', () => {
    it('re-fetches PDF from MinIO and resends without recreating entry', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        makePo({ status: PoStatus.sent, pdfObjectKey: 'pos/2026/05/po.pdf' }) as never,
      );
      prisma.purchaseOrder.update.mockResolvedValue(makePo({ status: PoStatus.sent }) as never);
      const res = await svc.resend(acheteur, poId);
      expect(storage.getObject).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalled();
      expect(posting.createCommitmentEntry).not.toHaveBeenCalled();
      expect(res.delivered).toBe(true);
    });

    it('throws PO_NO_PDF if pdf not stored', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ pdfObjectKey: null }) as never);
      await expect(svc.resend(acheteur, poId)).rejects.toBeInstanceOf(PoNoPdfException);
    });
  });
});
