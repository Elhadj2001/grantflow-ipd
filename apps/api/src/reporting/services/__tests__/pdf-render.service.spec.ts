import { PdfRenderService, type PdfRenderInput } from '../pdf-render.service';

/**
 * Tests structurels — pdf-parse n'est pas utilisable en unitaire (ESM
 * dynamic import dans pdfjs-dist nécessite --experimental-vm-modules).
 * On vérifie :
 *  - le buffer est un PDF valide (%PDF header + %%EOF trailer)
 *  - la taille croît avec le nombre de catégories (preuve qu'on écrit
 *    bien le contenu)
 *  - les cas limites (no notes, 0 categories) ne plantent pas
 *
 * La preuve visuelle (texte, signature, tableau) est faite par le test
 * d'intégration e2e qui commit un fixture PDF dans tests/fixtures/.
 */
describe('PdfRenderService', () => {
  let svc: PdfRenderService;

  function makeInput(overrides: Partial<PdfRenderInput> = {}): PdfRenderInput {
    return {
      reportNumber: 'DR-2026-TEST0001',
      donorName: 'USAID',
      templateName: 'USAID FFR-425',
      grantReference: 'USAID-2025-MALARIA',
      projectTitle: 'MAL-001 — Malaria research',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-03-31'),
      currency: 'USD',
      fxRateUsed: 0.001524,
      generatedAt: new Date('2026-05-17T12:00:00Z'),
      generatedBy: 'Mme KANE (CG)',
      notes: 'Q1 2026 report',
      aggregation: {
        lines: [
          {
            donorCategoryId: 'cat-1',
            categoryCode: 'PERSONNEL',
            categoryLabel: 'Personnel',
            budgetAmount: 50000,
            spentAmount: 48000,
            variance: -2000,
            variancePct: -4,
            alert: false,
          },
          {
            donorCategoryId: 'cat-2',
            categoryCode: 'TRAVEL',
            categoryLabel: 'Travel',
            budgetAmount: 10000,
            spentAmount: 12500,
            variance: 2500,
            variancePct: 25,
            alert: true,
          },
        ],
        totalBudget: 60000,
        totalSpent: 64500,
        totalOverhead: 4000,
        fundsCarried: 35500,
        fxRateUsed: 0.001524,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    svc = new PdfRenderService();
  });

  it('produces a non-empty Buffer with PDF magic header', async () => {
    const buf = await svc.render(makeInput());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('ends with valid PDF trailer %%EOF', async () => {
    const buf = await svc.render(makeInput());
    expect(buf.slice(-6).toString().trim()).toBe('%%EOF');
  });

  it('handles report with no notes', async () => {
    const buf = await svc.render(makeInput({ notes: null }));
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('handles report with 0 categories (empty aggregation)', async () => {
    const buf = await svc.render(
      makeInput({
        aggregation: {
          lines: [],
          totalBudget: 0,
          totalSpent: 0,
          totalOverhead: 0,
          fundsCarried: 0,
          fxRateUsed: 1,
        },
      }),
    );
    expect(buf.length).toBeGreaterThan(500);
  });

  it('size grows when more categories are added (write proof)', async () => {
    const baseInput = makeInput({
      aggregation: {
        lines: [
          {
            donorCategoryId: 'cat-1',
            categoryCode: 'A',
            categoryLabel: 'A',
            budgetAmount: 100,
            spentAmount: 100,
            variance: 0,
            variancePct: 0,
            alert: false,
          },
        ],
        totalBudget: 100,
        totalSpent: 100,
        totalOverhead: 0,
        fundsCarried: 0,
        fxRateUsed: 1,
      },
    });
    const richInput = makeInput({
      aggregation: {
        lines: Array.from({ length: 20 }, (_, i) => ({
          donorCategoryId: `c-${i}`,
          categoryCode: `C${i}`,
          categoryLabel: `Category ${i}`,
          budgetAmount: 1000,
          spentAmount: 950,
          variance: -50,
          variancePct: -5,
          alert: false,
        })),
        totalBudget: 20000,
        totalSpent: 19000,
        totalOverhead: 0,
        fundsCarried: 1000,
        fxRateUsed: 1,
      },
    });
    const small = await svc.render(baseInput);
    const big = await svc.render(richInput);
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('handles long donor name + project title without crashing', async () => {
    const buf = await svc.render(
      makeInput({
        donorName: 'A very long donor name that may wrap on the right column with extra text',
        projectTitle: 'PROJECT-ABCD-2026-EXTRAVAGANT-RESEARCH — Lorem ipsum dolor sit amet consectetur adipiscing elit',
      }),
    );
    expect(buf.length).toBeGreaterThan(500);
  });
});
