import * as XLSX from 'xlsx';
import {
  ExcelRenderService,
  EXCEL_SHEET_ACCOUNTS,
  EXCEL_SHEET_CATEGORIES,
  EXCEL_SHEET_SUMMARY,
  type ExcelRenderInput,
} from '../excel-render.service';

describe('ExcelRenderService', () => {
  let svc: ExcelRenderService;

  function makeInput(overrides: Partial<ExcelRenderInput> = {}): ExcelRenderInput {
    return {
      reportNumber: 'DR-2026-TEST0001',
      donorName: 'WHO',
      templateName: 'WHO standard',
      grantReference: 'WHO-2025',
      projectTitle: 'Project X',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-03-31'),
      currency: 'CHF',
      fxRateUsed: 0.0019,
      generatedAt: new Date('2026-05-17T12:00:00Z'),
      generatedBy: 'CG',
      aggregation: {
        lines: [
          {
            donorCategoryId: 'cat-1',
            categoryCode: 'STAFF',
            categoryLabel: 'Staff',
            budgetAmount: 100,
            spentAmount: 95,
            variance: -5,
            variancePct: -5,
            alert: false,
          },
        ],
        totalBudget: 100,
        totalSpent: 95,
        totalOverhead: 10,
        fundsCarried: 5,
        fxRateUsed: 0.0019,
      },
      accountDetail: [
        { accountCode: '661', accountLabel: 'Rémunérations directes', totalDebit: 50000, totalCredit: 0, netAmount: 50000 },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    svc = new ExcelRenderService();
  });

  it('produces a non-empty xlsx Buffer with magic header', () => {
    const buf = svc.render(makeInput());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    // xlsx is a ZIP archive — magic 'PK'
    expect(buf.slice(0, 2).toString()).toBe('PK');
  });

  it('contains exactly 3 sheets : Summary, Categories, Accounts', () => {
    const buf = svc.render(makeInput());
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual([
      EXCEL_SHEET_SUMMARY,
      EXCEL_SHEET_CATEGORIES,
      EXCEL_SHEET_ACCOUNTS,
    ]);
  });

  it('Summary sheet contains report number and metadata', () => {
    const buf = svc.render(makeInput());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[EXCEL_SHEET_SUMMARY];
    const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const flat = JSON.stringify(json);
    expect(flat).toContain('DR-2026-TEST0001');
    expect(flat).toContain('WHO');
    expect(flat).toContain('CHF');
  });

  it('Categories sheet has header + 1 data row per line', () => {
    const buf = svc.render(makeInput());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[EXCEL_SHEET_CATEGORIES];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(rows[0]).toEqual(['Code', 'Label', 'Budget', 'Spent', 'Variance', 'Variance %', 'Alert']);
    expect(rows.length).toBe(2); // header + 1 line
    expect(rows[1][0]).toBe('STAFF');
  });

  it('Accounts sheet has 1 row per account aggregated', () => {
    const buf = svc.render(
      makeInput({
        accountDetail: [
          { accountCode: '601', accountLabel: 'Achats', totalDebit: 1000, totalCredit: 0, netAmount: 1000 },
          { accountCode: '661', accountLabel: 'Salaires', totalDebit: 5000, totalCredit: 0, netAmount: 5000 },
        ],
      }),
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[EXCEL_SHEET_ACCOUNTS];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(rows.length).toBe(3); // header + 2 accounts
    expect(rows[1][0]).toBe('601');
    expect(rows[2][0]).toBe('661');
  });

  it('handles empty categories + accountDetail gracefully', () => {
    const buf = svc.render(
      makeInput({
        aggregation: {
          lines: [],
          totalBudget: 0,
          totalSpent: 0,
          totalOverhead: 0,
          fundsCarried: 0,
          fxRateUsed: 1,
        },
        accountDetail: [],
      }),
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames.length).toBe(3);
  });
});
