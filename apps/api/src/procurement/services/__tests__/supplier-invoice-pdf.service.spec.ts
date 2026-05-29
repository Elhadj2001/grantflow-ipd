import {
  SupplierInvoicePdfService,
  type SupplierInvoiceData,
} from '../supplier-invoice-pdf.service';

describe('SupplierInvoicePdfService (sprint F-INVOICE-SIM)', () => {
  const svc = new SupplierInvoicePdfService();

  const data: SupplierInvoiceData = {
    invoiceNumber: 'FAC-SIM-BC-2026-0001-1',
    invoiceDate: new Date('2026-05-29T00:00:00Z'),
    dueDate: new Date('2026-06-28T00:00:00Z'),
    poNumber: 'BC-2026-0001',
    currency: 'XOF',
    supplier: {
      name: 'BioMed Sénégal SARL',
      vatNumber: 'SN-2023-BIOMED-001',
      address: 'Km 4.5 Route de Rufisque, Dakar',
      country: 'SN',
    },
    lines: [
      {
        lineNumber: 1,
        description: 'Réactif PCR SARS-CoV-2',
        quantity: 10,
        unit: 'boite',
        unitPrice: 10000,
        lineTotal: 100000,
      },
    ],
    totalHt: 100000,
    totalVat: 18000,
    totalTtc: 118000,
    vatRate: 0.18,
    paymentTermsDays: 30,
  };

  it('génère un PDF non vide commençant par le header %PDF', async () => {
    const buf = await svc.generate(data);
    expect(buf.length).toBeGreaterThan(500);
    // Signature PDF.
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('gère un fournisseur sans NINEA / adresse (champs null)', async () => {
    const buf = await svc.generate({
      ...data,
      supplier: { name: 'Sans Infos SARL', vatNumber: null, address: null, country: null },
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('gère plusieurs lignes sans planter', async () => {
    const manyLines = Array.from({ length: 25 }, (_, i) => ({
      lineNumber: i + 1,
      description: `Article ${i + 1}`,
      quantity: i + 1,
      unit: 'u',
      unitPrice: 1000,
      lineTotal: (i + 1) * 1000,
    }));
    const buf = await svc.generate({ ...data, lines: manyLines });
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
