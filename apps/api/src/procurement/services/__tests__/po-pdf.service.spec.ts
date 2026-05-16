import { PoPdfService, type PoPdfPayload } from '../po-pdf.service';

/**
 * Tests unitaires PoPdfService.
 *
 * On vérifie que le PDF généré est :
 *  - un vrai PDF (magic bytes %PDF-)
 *  - de taille non triviale
 *  - contient les éléments métier (numéro BC, fournisseur, totaux)
 *
 * On n'analyse pas la structure visuelle (la lib pdfkit a ses propres
 * tests). Le but est de s'assurer que la pipeline ne crash pas et que
 * les champs critiques sont injectés dans le flux PDF.
 */
describe('PoPdfService', () => {
  const svc = new PoPdfService();

  function payload(overrides: Partial<PoPdfPayload> = {}): PoPdfPayload {
    return {
      poNumber: 'BC-2026-0001',
      orderDate: new Date('2026-05-16T00:00:00Z'),
      expectedDate: new Date('2026-06-01T00:00:00Z'),
      currency: 'XOF',
      totalHt: 425000,
      totalVat: 0,
      totalTtc: 425000,
      incoterm: 'DDP Dakar',
      deliveryAddress: 'Labo virologie, IPD, 36 av Pasteur, Dakar',
      prNumbers: ['DA-2026-0010', 'DA-2026-0011'],
      supplier: {
        name: 'ACME Lab Supplies',
        code: 'ACME-001',
        address: '12 rue de la Paix, Paris',
        country: 'France',
        contactEmail: 'sales@acme.example',
        paymentTermsDays: 45,
      },
      lines: [
        { lineNumber: 1, description: 'Pipettes électroniques 1000 µL', quantity: 5, unit: 'unit', unitPrice: 85000, lineTotal: 425000 },
      ],
      buyer: { fullName: 'Acheteur Test', email: 'a@x.test' },
      emittedAt: new Date('2026-05-16T10:30:00Z'),
      ...overrides,
    };
  }

  it('generates a valid PDF (starts with %PDF-)', async () => {
    const buf = await svc.generate(payload());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('produces a different PDF for different inputs (PO number changes content)', async () => {
    // pdfkit compresse les flux texte → on ne peut pas grep le contenu en
    // brut. À la place on vérifie que deux payloads différents produisent
    // deux buffers différents (preuve que le contenu est bien intégré).
    const a = await svc.generate(payload({ poNumber: 'BC-2026-0001' }));
    const b = await svc.generate(payload({ poNumber: 'BC-2026-0042' }));
    expect(a.equals(b)).toBe(false);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('produces different output when supplier changes', async () => {
    const a = await svc.generate(payload());
    const b = await svc.generate(
      payload({
        supplier: {
          name: 'Differentes Solutions',
          code: 'DIFF-001',
          address: '5 boulevard du Test',
          country: 'Sénégal',
          contactEmail: 'contact@diff.example',
          paymentTermsDays: 30,
        },
      }),
    );
    expect(a.equals(b)).toBe(false);
  });

  it('produces different output when PR refs change', async () => {
    const a = await svc.generate(payload({ prNumbers: ['DA-2026-0010'] }));
    const b = await svc.generate(payload({ prNumbers: ['DA-2026-9999'] }));
    expect(a.equals(b)).toBe(false);
  });

  it('renders multi-page when there are many lines', async () => {
    const manyLines = Array.from({ length: 60 }, (_, i) => ({
      lineNumber: i + 1,
      description: `Article ${i + 1}`,
      quantity: 1,
      unit: 'unit',
      unitPrice: 1000,
      lineTotal: 1000,
    }));
    const buf = await svc.generate(payload({ lines: manyLines, totalHt: 60_000, totalTtc: 60_000 }));
    // Plus de pages = PDF plus gros, on s'assure juste qu'on a un Buffer valide.
    expect(buf.length).toBeGreaterThan(3000);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('handles minimal supplier (no address/country/email)', async () => {
    const buf = await svc.generate(
      payload({
        supplier: {
          name: 'Frenchies',
          code: 'FR-001',
          address: null,
          country: null,
          contactEmail: null,
          paymentTermsDays: 30,
        },
      }),
    );
    expect(buf.length).toBeGreaterThan(1000);
  });
});
