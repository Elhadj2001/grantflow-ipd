/**
 * Génère une fixture TER (PDF + Excel) pour sprint 6.2 à partir d'un
 * StatementResult synthétique. Sortie dans tests/fixtures/.
 *
 * Usage :
 *   npx ts-node --transpile-only scripts/generate-ter-fixture.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { StatementRenderService } from '../apps/api/src/reporting/services/statement-render.service';
import type { StatementResult } from '../apps/api/src/reporting/services/financial-statement-generator.service';

const period = {
  code: '2026-01',
  start: new Date('2026-01-01'),
  end: new Date('2026-01-31'),
};

const terResult: StatementResult = {
  type: 'TER',
  periodId: 'fixture-2026-01',
  periodCode: period.code,
  lines: [
    // EMPLOIS
    { section: 'EMPLOIS', label: '601 — Achats matières premières', accountCode: '601', debit: 1_250_000, credit: 0, balance: 1_250_000, sortOrder: 0 },
    { section: 'EMPLOIS', label: '6041 — Réactifs et consommables', accountCode: '6041', debit: 3_400_000, credit: 0, balance: 3_400_000, sortOrder: 1 },
    { section: 'EMPLOIS', label: '622 — Locations', accountCode: '622', debit: 450_000, credit: 0, balance: 450_000, sortOrder: 2 },
    { section: 'EMPLOIS', label: '626 — Postes & telecom', accountCode: '626', debit: 75_000, credit: 0, balance: 75_000, sortOrder: 3 },
    { section: 'EMPLOIS', label: '661 — Rémunérations directes', accountCode: '661', debit: 4_800_000, credit: 0, balance: 4_800_000, sortOrder: 4 },
    { section: 'EMPLOIS', label: '664 — Charges sociales', accountCode: '664', debit: 980_000, credit: 0, balance: 980_000, sortOrder: 5 },
    { section: 'EMPLOIS', label: '789 — Reprises sur fonds dédiés (reprise)', accountCode: '789', debit: 0, credit: 200_000, balance: 200_000, sortOrder: 6 },
    // RESSOURCES
    { section: 'RESSOURCES', label: '754 — Subventions USAID', accountCode: '754', debit: 0, credit: 8_500_000, balance: 8_500_000, sortOrder: 10 },
    { section: 'RESSOURCES', label: '754 — Subventions WHO', accountCode: '754', debit: 0, credit: 2_400_000, balance: 2_400_000, sortOrder: 11 },
    { section: 'RESSOURCES', label: '756 — Dons manuels reçus', accountCode: '756', debit: 0, credit: 105_000, balance: 105_000, sortOrder: 12 },
    { section: 'RESSOURCES', label: '689 — Dotations aux fonds dédiés', accountCode: '689', debit: 150_000, credit: 0, balance: 150_000, sortOrder: 13 },
  ],
  totals: {
    leftTotal: 11_155_000,
    rightTotal: 11_155_000,
    balanced: true,
    totalEmplois: 11_155_000,
    totalRessources: 11_155_000,
  },
};

async function main() {
  const svc = new StatementRenderService();
  const input = {
    statement: terResult,
    periodCode: period.code,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: new Date('2026-02-01T08:30:00Z'),
    generatedBy: 'DAF Institut Pasteur de Dakar',
  };
  const pdf = await svc.renderPdf(input);
  const xlsx = svc.renderExcel(input);

  const outDir = resolve(process.cwd(), 'tests', 'fixtures');
  mkdirSync(outDir, { recursive: true });
  const pdfPath = resolve(outDir, 'sprint-6.2-TER-2026-01.pdf');
  const xlsxPath = resolve(outDir, 'sprint-6.2-TER-2026-01.xlsx');
  writeFileSync(pdfPath, pdf);
  writeFileSync(xlsxPath, xlsx);
  console.log(`Wrote ${pdfPath} (${pdf.length} bytes)`);
  console.log(`Wrote ${xlsxPath} (${xlsx.length} bytes)`);
  console.log('Sanity check:');
  console.log(`  PDF magic   = ${pdf.slice(0, 4).toString()}`);
  console.log(`  XLSX magic  = ${xlsx.slice(0, 2).toString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
