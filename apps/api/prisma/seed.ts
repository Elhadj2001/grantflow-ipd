/**
 * Seed initial GRANTFLOW IPD
 *
 * Charge :
 *  - Plan comptable SYSCEBNL          (seed/syscebnl-accounts.json)
 *  - Rôles RBAC                        (seed/roles.json)
 *  - Bailleurs                         (seed/donors.json)
 *  - Codes TVA / retenues Sénégal      (seed/tax-codes.json)
 *  - Périodes fiscales 2026            (seed/fiscal-periods-2026.json)
 *  - 5 utilisateurs de test
 *  - 3 projets démo + grants + budget lines
 *
 * Les fixtures sont la source unique de vérité — toute modification du plan
 * comptable ou des bailleurs doit se faire dans les JSON, jamais ici.
 */
// Side-effect : charge le .env de la racine AVANT toute import qui aurait
// besoin de DATABASE_URL. Doit rester en TOUTE PREMIÈRE position — voir
// load-env.ts pour le détail (hoisting des imports en CJS).
import './load-env';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient, type DonorType } from '@prisma/client';

const prisma = new PrismaClient();
const SEED_DIR = path.join(__dirname, '..', '..', '..', 'seed');

type AccountFixture = {
  code: string;
  label: string;
  class: string;
  is_movement: boolean;
  syscebnl_specific: boolean;
  description?: string;
};
type RoleFixture = { code: string; label: string; description?: string };
type DonorFixture = { code: string; label: string; type: DonorType; country?: string };
type TaxCodeFixture = { code: string; label: string; rate: number; account_code?: string };
type FiscalPeriodFixture = {
  code: string;
  period_type: string;
  start_date: string;
  end_date: string;
};

function loadFixture<T>(filename: string, rootKey: string): T[] {
  const raw = fs.readFileSync(path.join(SEED_DIR, filename), 'utf-8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  const data = json[rootKey];
  if (!Array.isArray(data)) {
    throw new Error(`Fixture ${filename} : clé "${rootKey}" absente ou non-tableau`);
  }
  return data as T[];
}

async function seedGlAccounts() {
  const accounts = loadFixture<AccountFixture>('syscebnl-accounts.json', 'accounts');
  for (const a of accounts) {
    await prisma.glAccount.upsert({
      where: { code: a.code },
      update: {},
      create: {
        code: a.code,
        label: a.label,
        class: a.class,
        isMovement: a.is_movement,
        syscebnlSpecific: a.syscebnl_specific,
        description: a.description ?? null,
      },
    });
  }
  console.log(`✅ ${accounts.length} comptes SYSCEBNL chargés`);
}

async function seedRoles() {
  const roles = loadFixture<RoleFixture>('roles.json', 'roles');
  for (const r of roles) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, label: r.label, description: r.description },
    });
  }
  console.log(`✅ ${roles.length} rôles chargés`);
}

async function seedDonors() {
  const donors = loadFixture<DonorFixture>('donors.json', 'donors');
  for (const d of donors) {
    await prisma.donor.upsert({
      where: { code: d.code },
      update: {},
      create: { code: d.code, label: d.label, type: d.type, country: d.country },
    });
  }
  console.log(`✅ ${donors.length} bailleurs chargés`);
}

async function seedTaxCodes() {
  const codes = loadFixture<TaxCodeFixture>('tax-codes.json', 'tax_codes');
  for (const c of codes) {
    await prisma.taxCode.upsert({
      where: { code: c.code },
      update: {},
      create: {
        code: c.code,
        label: c.label,
        rate: c.rate,
        accountCode: c.account_code,
      },
    });
  }
  console.log(`✅ ${codes.length} codes TVA chargés`);
}

async function seedFiscalPeriods() {
  const periods = loadFixture<FiscalPeriodFixture>('fiscal-periods-2026.json', 'periods');
  for (const p of periods) {
    await prisma.fiscalPeriod.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        periodType: p.period_type,
        startDate: new Date(p.start_date),
        endDate: new Date(p.end_date),
      },
    });
  }
  console.log(`✅ ${periods.length} périodes fiscales chargées`);
}

async function seedUsers() {
  const users = [
    { email: 'admin@pasteur.sn',  fullName: 'Admin IPD',           roleCode: 'SUPER_ADMIN' },
    { email: 'daf@pasteur.sn',    fullName: 'Mme DIOP (DAF)',      roleCode: 'DAF' },
    { email: 'compta@pasteur.sn', fullName: 'M. SECK (Compta)',    roleCode: 'COMPTABLE' },
    { email: 'pi@pasteur.sn',     fullName: 'Dr. SARR (PI)',       roleCode: 'PI' },
    { email: 'amadou@pasteur.sn', fullName: 'A. NIANG (stagiaire)', roleCode: 'DEMANDEUR' },
  ];
  for (const u of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.roleCode } });
    const user = await prisma.appUser.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, fullName: u.fullName },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
  console.log(`✅ ${users.length} utilisateurs démo créés`);
}

async function seedDemoProjects() {
  const projects = [
    { code: 'MADIBA-VAC-2024', title: 'Production vaccinale MADIBA',     donor: 'BMGF',
      grantRef: 'BMGF-2023-117',   amount: 485000,  currency: 'EUR', overhead: 0.13 },
    { code: 'CEPI-MADIBA-022', title: 'Plateforme vaccin pan-corona CEPI', donor: 'CEPI',
      grantRef: 'CEPI-2024-022',   amount: 1200000, currency: 'USD', overhead: 0.10 },
    { code: 'EDCTP-RIA-2022',  title: 'Essai clinique antiviral RIA',     donor: 'EDCTP',
      grantRef: 'EDCTP-RIA-2022',  amount: 850000,  currency: 'EUR', overhead: 0.07 },
  ];

  for (const p of projects) {
    const proj = await prisma.project.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        title: p.title,
        startDate: new Date('2024-03-01'),
        endDate: new Date('2027-02-28'),
      },
    });
    const donor = await prisma.donor.findUniqueOrThrow({ where: { code: p.donor } });
    const grant = await prisma.grantAgreement.upsert({
      where: { reference: p.grantRef },
      update: {},
      create: {
        reference: p.grantRef,
        donorId: donor.id,
        projectId: proj.id,
        amount: p.amount,
        currency: p.currency,
        overheadRate: p.overhead,
        startDate: new Date('2024-03-01'),
        endDate: new Date('2027-02-28'),
        status: 'active',
      },
    });
    const budgetLines = [
      { code: 'L01', label: 'Consommables laboratoire',  amount: 38000 },
      { code: 'L02', label: 'Équipements scientifiques', amount: 145000 },
      { code: 'L03', label: 'Personnel scientifique',    amount: 180000 },
      { code: 'L04', label: 'Missions et déplacements',  amount: 22000 },
      { code: 'L05', label: 'Overhead',                  amount: Math.round(p.amount * p.overhead) },
    ];
    for (const bl of budgetLines) {
      await prisma.budgetLine.upsert({
        where: { grantId_code: { grantId: grant.id, code: bl.code } },
        update: {},
        create: {
          grantId: grant.id,
          code: bl.code,
          label: bl.label,
          budgetedAmount: bl.amount,
        },
      });
    }
  }
  console.log(`✅ ${projects.length} projets, ${projects.length} grants et budget lines créés`);
}

async function main() {
  console.log('🌱 Seed GRANTFLOW IPD — démarrage...');
  await seedGlAccounts();
  await seedRoles();
  await seedDonors();
  await seedTaxCodes();
  await seedFiscalPeriods();
  await seedUsers();
  await seedDemoProjects();
  console.log('🎉 Seed terminé avec succès.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
