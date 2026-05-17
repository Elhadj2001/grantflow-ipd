import * as XLSX from 'xlsx';
import { StatementRenderService } from '../statement-render.service';
import type { StatementResult } from '../financial-statement-generator.service';

describe('StatementRenderService', () => {
  let svc: StatementRenderService;

  const period = {
    code: '2026-01',
    start: new Date('2026-01-01'),
    end: new Date('2026-01-31'),
  };

  const baseStatement: StatementResult = {
    type: 'TER',
    periodId: 'p1',
    periodCode: period.code,
    lines: [
      { section: 'EMPLOIS', label: '661 — Charges personnel', accountCode: '661', debit: 500, credit: 0, balance: 500, sortOrder: 0 },
      { section: 'RESSOURCES', label: '754 — Subvention', accountCode: '754', debit: 0, credit: 500, balance: 500, sortOrder: 1 },
    ],
    totals: { leftTotal: 500, rightTotal: 500, balanced: true, totalEmplois: 500, totalRessources: 500 },
  };

  beforeEach(() => {
    svc = new StatementRenderService();
  });

  const renderInput = (statement: StatementResult = baseStatement) => ({
    statement,
    periodCode: period.code,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: new Date('2026-02-01T08:30:00Z'),
    generatedBy: 'DAF Test',
  });

  // ---------------------------------------------------------------- PDF

  describe('renderPdf', () => {
    it('produces a non-empty PDF starting with %PDF magic header', async () => {
      const buf = await svc.renderPdf(renderInput());
      expect(buf.length).toBeGreaterThan(1000);
      expect(buf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('produces a PDF ending with %%EOF trailer', async () => {
      const buf = await svc.renderPdf(renderInput());
      const tail = buf.slice(-1024).toString();
      expect(tail).toContain('%%EOF');
    });

    it('PDF size grows with more lines', async () => {
      const small = await svc.renderPdf(renderInput());
      const bigStatement: StatementResult = {
        ...baseStatement,
        lines: Array.from({ length: 30 }, (_, i) => ({
          section: i % 2 === 0 ? 'EMPLOIS' : 'RESSOURCES',
          label: `60${i} — line ${i}`,
          accountCode: `60${i}`,
          debit: 100 * i,
          credit: 0,
          balance: 100 * i,
          sortOrder: i,
        })),
      };
      const big = await svc.renderPdf(renderInput(bigStatement));
      expect(big.length).toBeGreaterThan(small.length);
    });

    it('renders BILAN with ACTIF/PASSIF columns', async () => {
      const bilan: StatementResult = {
        type: 'BILAN',
        periodId: 'p1',
        periodCode: period.code,
        lines: [
          { section: 'ACTIF', label: '521 — Banque', accountCode: '521', debit: 1000, credit: 0, balance: 1000, sortOrder: 0 },
          { section: 'PASSIF', label: '19 — Fonds dédiés', accountCode: '19', debit: 0, credit: 1000, balance: 1000, sortOrder: 1 },
        ],
        totals: { leftTotal: 1000, rightTotal: 1000, balanced: true, totalActif: 1000, totalPassif: 1000 },
      };
      const buf = await svc.renderPdf(renderInput(bilan));
      expect(buf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('renders RESULTAT (always balanced)', async () => {
      const cr: StatementResult = {
        type: 'RESULTAT',
        periodId: 'p1',
        periodCode: period.code,
        lines: baseStatement.lines.map((l) => ({
          ...l,
          section: l.section === 'EMPLOIS' ? 'CHARGES' : 'PRODUITS',
        })),
        totals: { leftTotal: 500, rightTotal: 500, balanced: true, resultatNet: 0 },
      };
      const buf = await svc.renderPdf(renderInput(cr));
      expect(buf.slice(0, 4).toString()).toBe('%PDF');
    });
  });

  // ---------------------------------------------------------------- Excel

  describe('renderExcel', () => {
    it('produces Excel buffer starting with PK (zip magic)', () => {
      const buf = svc.renderExcel(renderInput());
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.slice(0, 2).toString()).toBe('PK');
    });

    it('has 2 sheets named Summary + Detail', () => {
      const buf = svc.renderExcel(renderInput());
      const wb = XLSX.read(buf, { type: 'buffer' });
      expect(wb.SheetNames).toEqual(['Summary', 'Detail']);
    });

    it('Detail sheet has 1 header row + 1 row per line', () => {
      const buf = svc.renderExcel(renderInput());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheet = wb.Sheets['Detail'];
      const rows = XLSX.utils.sheet_to_json<unknown>(sheet, { header: 1 });
      expect(rows[0]).toEqual(['Section', 'Code', 'Label', 'Débit', 'Crédit', 'Balance']);
      expect(rows).toHaveLength(1 + baseStatement.lines.length);
    });

    it('Summary sheet contains total left/right + balanced flag', () => {
      const buf = svc.renderExcel(renderInput());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Summary'], { header: 1 });
      const flat = rows.flat();
      expect(flat).toContain('Total gauche');
      expect(flat).toContain('Équilibré ?');
      expect(flat).toContain('OUI');
    });
  });
});
