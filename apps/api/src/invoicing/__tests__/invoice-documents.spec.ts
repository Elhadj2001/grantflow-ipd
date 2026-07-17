/**
 * US-069 — aperçu PDF fiable + panneau Documents.
 *
 * Couvre le FIX du bug d'aperçu (retour user, FAC-SIM-BC-2026-0002-1) :
 * les erreurs storage ne fuient plus en 500 brut — NoSuchKey → 404
 * BUSINESS.DOCUMENT_NOT_FOUND, stockage injoignable (S3_* absents →
 * fallback localhost, ECONNREFUSED) → 503 DOCUMENT_STORE_UNAVAILABLE.
 * Et le listing des documents dérivé des métadonnées existantes.
 */
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { InvoiceService } from '../services/invoice.service';
import {
  DocumentNotFoundException,
  DocumentStoreUnavailableException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../common/services/storage.service';

const COMPTABLE: AuthenticatedUser = {
  id: 'kc-c',
  email: 'compta@x',
  fullName: 'Comptable',
  roles: ['COMPTABLE'],
};

function makeInvoice(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoiceNumber: 'FAC-SIM-BC-2026-0002-1',
    supplierId: 'sup-1',
    status: 'captured',
    pdfObjectKey: 'invoices/2026/07/sim-abc.pdf',
    createdAt: new Date('2026-07-10T08:00:00Z'),
    ...over,
  };
}

/** Erreur typée SDK MinIO/S3 (code = propriété discriminante). */
function s3Error(code: string, message = 'boom'): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

describe('InvoiceService — documents (US-069)', () => {
  let prisma: PrismaMock;
  let storage: { getObject: jest.Mock; statObjectSafe: jest.Mock };
  let svc: InvoiceService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = {
      getObject: jest.fn(),
      statObjectSafe: jest.fn().mockResolvedValue({ size: 12345, contentType: 'application/pdf' }),
    };
    svc = new InvoiceService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      {} as never, // OcrService — non sollicité ici
      {} as never, // MatchingService
      {} as never, // PostingService
    );
  });

  describe('downloadPdf — mapping erreurs storage', () => {
    it('pdfObjectKey null → 404 BUSINESS.DOCUMENT_NOT_FOUND (facture manuelle)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ pdfObjectKey: null }) as never);
      const err = await svc.downloadPdf(COMPTABLE, 'inv-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DocumentNotFoundException);
      expect((err as DocumentNotFoundException).getStatus()).toBe(404);
    });

    it('objet absent du stockage (NoSuchKey) → 404 DOCUMENT_NOT_FOUND, pas un 500', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice() as never);
      storage.getObject.mockRejectedValue(s3Error('NoSuchKey'));
      const err = await svc.downloadPdf(COMPTABLE, 'inv-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DocumentNotFoundException);
    });

    it('stockage injoignable (ECONNREFUSED, S3_* absents) → 503 DOCUMENT_STORE_UNAVAILABLE', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice() as never);
      storage.getObject.mockRejectedValue(s3Error('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9000'));
      const err = await svc.downloadPdf(COMPTABLE, 'inv-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DocumentStoreUnavailableException);
      expect((err as DocumentStoreUnavailableException).getStatus()).toBe(503);
    });

    it('happy path : buffer + filename depuis invoiceNumber', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice() as never);
      storage.getObject.mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4'),
        contentType: 'application/pdf',
        size: 8,
      });
      const res = await svc.downloadPdf(COMPTABLE, 'inv-1');
      expect(res.filename).toBe('FAC-SIM-BC-2026-0002-1.pdf');
      expect(res.contentType).toBe('application/pdf');
    });
  });

  describe('listDocuments — dérivé des métadonnées existantes', () => {
    it('facture sans pdfObjectKey → liste vide (état vide charte au front)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ pdfObjectKey: null }) as never);
      await expect(svc.listDocuments(COMPTABLE, 'inv-1')).resolves.toEqual([]);
    });

    it('facture archivée → 1 document avec taille (statObjectSafe) et downloadPath', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice() as never);
      const docs = await svc.listDocuments(COMPTABLE, 'inv-1');
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        kind: 'invoice_pdf',
        label: 'FAC-SIM-BC-2026-0002-1.pdf',
        sizeBytes: 12345,
        downloadPath: '/invoices/inv-1/pdf',
      });
    });

    it('stockage down au listing → taille null mais liste AFFICHABLE (best-effort)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice() as never);
      storage.statObjectSafe.mockResolvedValue(null);
      const docs = await svc.listDocuments(COMPTABLE, 'inv-1');
      expect(docs).toHaveLength(1);
      expect(docs[0].sizeBytes).toBeNull();
    });
  });
});
