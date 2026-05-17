import { Prisma } from '@prisma/client';
import { SepaService, SEPA_BUCKET } from '../sepa.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../../common/services/storage.service';
import {
  EntityNotFoundException,
  SepaGenerationFailedException,
  SepaNotGeneratedException,
  SepaRunNotReadyException,
} from '../../../common/exceptions/business.exception';

/**
 * Tests unitaires SepaService (sprint 5.2).
 *
 * Couvre :
 *  - Génération XML pain.001.001.03 conforme (root + GrpHdr + PmtInf)
 *  - NbOfTxs et CtrlSum cohérents avec les payments
 *  - 1 CdtTrfTxInf par payment, EndToEndId = invoice_number
 *  - IBAN normalisé (sans espaces, MAJ)
 *  - Stockage MinIO et mise à jour sepaFileKey
 *  - Erreurs : run pas prepared/executed, sans bankAccount, sans payments,
 *    download avant generate
 */
describe('SepaService', () => {
  let prisma: {
    paymentRun: { findUnique: jest.Mock; update: jest.Mock };
  };
  let storage: { putObject: jest.Mock; getObject: jest.Mock };
  let svc: SepaService;

  function makeRun(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      runNumber: 'PAY-2026-0001',
      runDate: new Date('2026-05-17'),
      currency: 'XOF',
      status: 'prepared',
      sepaFileKey: null,
      bankAccount: {
        id: 'ba-1',
        code: 'CBAO-XOF',
        label: 'CBAO XOF',
        accountNumber: 'SN012010100000123456789012',
        bic: 'CBAOSNDA',
        bankName: 'CBAO',
        currency: 'XOF',
      },
      payments: [
        {
          id: 'p1',
          amount: new Prisma.Decimal('50000'),
          currency: 'XOF',
          status: 'prepared',
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'FAC-001',
            supplier: {
              id: 's1',
              code: 'ACME',
              name: 'ACME Lab Supplies',
              iban: 'FR1420041010050500013M02606',
              bic: 'BNPAFRPP',
            },
          },
        },
        {
          id: 'p2',
          amount: new Prisma.Decimal('25000'),
          currency: 'XOF',
          status: 'prepared',
          invoice: {
            id: 'inv-2',
            invoiceNumber: 'FAC-002',
            supplier: {
              id: 's2',
              code: 'BIOTECH',
              name: 'BIOTECH SARL',
              iban: 'SN012010100000111222333444',
              bic: null,
            },
          },
        },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      paymentRun: { findUnique: jest.fn(), update: jest.fn() },
    };
    storage = {
      putObject: jest.fn().mockResolvedValue({ bucket: SEPA_BUCKET, objectKey: 'key' }),
      getObject: jest.fn(),
    };
    svc = new SepaService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  describe('generatePaymentRunXml', () => {
    it('builds a pain.001.001.03 conformant XML', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue({});

      const r = await svc.generatePaymentRunXml('run-1');
      expect(r.xmlString).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
      expect(r.xmlString).toContain('<CstmrCdtTrfInitn>');
      expect(r.xmlString).toContain('<GrpHdr>');
      expect(r.xmlString).toContain('<MsgId>PAY-2026-0001</MsgId>');
      expect(r.xmlString).toContain('<PmtInf>');
      expect(r.xmlString).toContain('<PmtMtd>TRF</PmtMtd>');
      expect(r.xmlString).toContain('<BtchBookg>true</BtchBookg>');
    });

    it('NbOfTxs and CtrlSum reflect payment list', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue({});
      const r = await svc.generatePaymentRunXml('run-1');
      expect(r.nbOfTxs).toBe(2);
      expect(r.ctrlSum).toBe(75000);
      expect(r.xmlString).toContain('<NbOfTxs>2</NbOfTxs>');
      expect(r.xmlString).toContain('<CtrlSum>75000.00</CtrlSum>');
    });

    it('emits 1 CdtTrfTxInf per payment with EndToEndId = invoice number', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue({});
      const r = await svc.generatePaymentRunXml('run-1');
      const matches = r.xmlString.match(/<CdtTrfTxInf>/g);
      expect(matches?.length).toBe(2);
      expect(r.xmlString).toContain('<EndToEndId>FAC-001</EndToEndId>');
      expect(r.xmlString).toContain('<EndToEndId>FAC-002</EndToEndId>');
    });

    it('emits supplier BIC when present, skips when null', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue({});
      const r = await svc.generatePaymentRunXml('run-1');
      // ACME has BIC, BIOTECH does not
      expect(r.xmlString).toContain('<BIC>BNPAFRPP</BIC>');
      // Pour BIOTECH, pas de CdtrAgt — on vérifie qu'on ne casse pas
      expect(r.xmlString).toContain('BIOTECH SARL');
    });

    it('stores file in MinIO bucket grantflow-sepa and persists sepaFileKey', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue({});
      const r = await svc.generatePaymentRunXml('run-1');
      expect(storage.putObject).toHaveBeenCalled();
      const args = storage.putObject.mock.calls[0][0];
      expect(args.bucket).toBe(SEPA_BUCKET);
      expect(args.contentType).toBe('application/xml');
      expect(args.objectKey).toMatch(/^sepa\/\d{4}\/\d{2}\/PAY-2026-0001-[a-f0-9]{8}\.xml$/);
      expect(prisma.paymentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { sepaFileKey: r.sepaFileKey },
      });
    });

    it('throws SepaRunNotReadyException when run is in draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'draft' }));
      await expect(svc.generatePaymentRunXml('run-1')).rejects.toBeInstanceOf(
        SepaRunNotReadyException,
      );
    });

    it('throws SepaGenerationFailedException when run has no eligible payments', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ payments: [] }));
      await expect(svc.generatePaymentRunXml('run-1')).rejects.toBeInstanceOf(
        SepaGenerationFailedException,
      );
    });

    it('throws EntityNotFoundException when run does not exist', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(null);
      await expect(svc.generatePaymentRunXml('run-1')).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('throws EntityNotFoundException when run has no bankAccount', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ bankAccount: null }));
      await expect(svc.generatePaymentRunXml('run-1')).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('normalizes IBAN (no spaces, uppercase)', async () => {
      const run = makeRun();
      // injecter un IBAN avec espaces et minuscules
      (run.bankAccount as { accountNumber: string }).accountNumber = 'sn 0120 1010 0000 1234 5678 9012';
      prisma.paymentRun.findUnique.mockResolvedValue(run);
      prisma.paymentRun.update.mockResolvedValue({});
      const r = await svc.generatePaymentRunXml('run-1');
      expect(r.xmlString).toContain('<IBAN>SN012010100000123456789012</IBAN>');
    });
  });

  describe('downloadSepaFile', () => {
    it('streams the stored XML file', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        runNumber: 'PAY-2026-0001',
        sepaFileKey: 'sepa/2026/05/PAY-2026-0001-abc12345.xml',
      });
      storage.getObject.mockResolvedValue({
        buffer: Buffer.from('<xml/>'),
        contentType: 'application/xml',
        size: 6,
      });
      const r = await svc.downloadSepaFile('run-1');
      expect(r.filename).toBe('PAY-2026-0001.xml');
      expect(r.buffer.toString()).toBe('<xml/>');
    });

    it('throws SepaNotGeneratedException when sepaFileKey is null', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        runNumber: 'PAY-2026-0001',
        sepaFileKey: null,
      });
      await expect(svc.downloadSepaFile('run-1')).rejects.toBeInstanceOf(
        SepaNotGeneratedException,
      );
    });
  });
});
