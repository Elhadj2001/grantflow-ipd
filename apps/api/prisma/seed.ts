/**
 * Seed initial GRANTFLOW IPD
 *
 * Charge :
 *  - Plan comptable SYSCEBNL          (seed/syscebnl-accounts.json)
 *  - Rôles RBAC                        (seed/roles.json)
 *  - Bailleurs                         (seed/donors.json)
 *  - Fournisseurs de démo              (seed/suppliers.json)
 *  - Codes TVA / retenues Sénégal      (seed/tax-codes.json)
 *  - Périodes fiscales 2026            (seed/fiscal-periods-2026.json)
 *  - 11 utilisateurs de test (1 par rôle RBAC ; ACHETEUR/MAGASINIER/BAILLEUR
 *    ajoutés sprint amorce-démo)
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
import { PrismaClient, Prisma, type DonorType } from '@prisma/client';

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
type SupplierFixture = {
  code: string;
  name: string;
  vatNumber?: string;
  address?: string;
  country?: string;
  paymentTermsDays?: number;
  currencyDefault?: string;
  /** Sprint F-PO-EMAIL : destinataire du BC PDF (best-effort). */
  contactEmail?: string;
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

/**
 * Fournisseurs de démo — seed/suppliers.json source de vérité.
 *
 * Clé d'unicité : `code`. Upsert préserve les données existantes (history
 * IBAN, riskScore éventuellement mis à jour à l'usage) — on ne réécrase
 * que les colonnes du fichier de fixtures.
 *
 * iban/bic restent volontairement null : le scénario démo s'arrête à la
 * comptabilisation (classes 4/6) ; le volet trésorerie/SEPA (classe 5)
 * nécessitera un enrichissement ultérieur de la fixture quand on
 * activera le paiement SEPA pour la démo.
 */
async function seedSuppliers() {
  const suppliers = loadFixture<SupplierFixture>('suppliers.json', 'suppliers');
  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { code: s.code },
      update: {
        name: s.name,
        vatNumber: s.vatNumber ?? null,
        address: s.address ?? null,
        country: s.country ?? null,
        paymentTermsDays: s.paymentTermsDays ?? 30,
        currencyDefault: s.currencyDefault ?? 'XOF',
        contactEmail: s.contactEmail ?? null,
      },
      create: {
        code: s.code,
        name: s.name,
        vatNumber: s.vatNumber ?? null,
        address: s.address ?? null,
        country: s.country ?? null,
        paymentTermsDays: s.paymentTermsDays ?? 30,
        currencyDefault: s.currencyDefault ?? 'XOF',
        contactEmail: s.contactEmail ?? null,
      },
    });
  }
  console.log(`✅ ${suppliers.length} fournisseurs chargés`);
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

/**
 * Parités fixes BCEAO/UEMOA — seed obligatoire avant tout calcul XOF/EUR.
 *
 * 1 EUR = 655,957 XOF (décret 04/01/1999, garantie BCEAO).
 * On insère les deux sens (EUR→XOF et XOF→EUR) avec `isFixed=true` :
 * le service ExchangeRate les détecte et les retourne quelle que soit
 * la date de demande.
 */
async function seedFixedExchangeRates() {
  const FIXED_EUR_XOF = 655.957;
  const rates = [
    { from: 'EUR', to: 'XOF', rate: FIXED_EUR_XOF },
    { from: 'XOF', to: 'EUR', rate: 1 / FIXED_EUR_XOF },
  ];
  for (const r of rates) {
    await prisma.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency_rateDate: {
          fromCurrency: r.from,
          toCurrency: r.to,
          rateDate: new Date('1999-01-04'),
        },
      },
      update: { isFixed: true, rate: r.rate, source: 'BCEAO_FIXED' },
      create: {
        fromCurrency: r.from,
        toCurrency: r.to,
        rate: r.rate,
        rateDate: new Date('1999-01-04'),
        source: 'BCEAO_FIXED',
        isFixed: true,
      },
    });
  }
  console.log(`✅ ${rates.length} parités fixes BCEAO (EUR↔XOF) chargées`);
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
  // Note : tout ajout ici DOIT être propagé dans docker/keycloak/realm.json
  // (mêmes emails, mots de passe non temporaires conformes à la password
  // policy length(10)+digit+lower+upper+notUsername). Le seed Prisma crée
  // app_user.* ; Keycloak gère l'authentification réelle.
  const users = [
    { email: 'admin@pasteur.sn',      fullName: 'Admin IPD',             roleCode: 'SUPER_ADMIN' },
    { email: 'daf@pasteur.sn',        fullName: 'Mme DIOP (DAF)',        roleCode: 'DAF' },
    { email: 'compta@pasteur.sn',     fullName: 'M. SECK (Compta)',      roleCode: 'COMPTABLE' },
    { email: 'tres@pasteur.sn',       fullName: 'Mme FALL (Trésorier)',  roleCode: 'TRESORIER' },
    { email: 'pi@pasteur.sn',         fullName: 'Dr. SARR (PI)',         roleCode: 'PI' },
    { email: 'amadou@pasteur.sn',     fullName: 'A. NIANG (stagiaire)',  roleCode: 'DEMANDEUR' },
    { email: 'cg@pasteur.sn',         fullName: 'Mme KANE (CG)',         roleCode: 'CONTROLEUR' },
    { email: 'caissier@pasteur.sn',   fullName: 'M. NDIAYE (Caissier)',  roleCode: 'CAISSIER' },
    // Sprint amorce-démo : 3 rôles indispensables au scénario E2E
    // (BC / Réception / Bailleur lecture).
    { email: 'acheteur@pasteur.sn',   fullName: 'M. BA (Acheteur)',      roleCode: 'ACHETEUR' },
    { email: 'magasinier@pasteur.sn', fullName: 'M. THIAM (Magasin)',    roleCode: 'MAGASINIER' },
    { email: 'bailleur@pasteur.sn',   fullName: 'Auditeur USAID (lecture)', roleCode: 'BAILLEUR' },
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

/**
 * Caisse en espèces par défaut (CAISSE-PRINCIPALE). Plafonds raisonnables
 * pour un usage labo : 100k par DA, 200k par jour/utilisateur, 500k de
 * solde maxi. Custodian = caissier@pasteur.sn.
 */
async function seedDefaultCashBox() {
  const custodian = await prisma.appUser.findUnique({
    where: { email: 'caissier@pasteur.sn' },
    select: { id: true },
  });
  await prisma.cashBox.upsert({
    where: { code: 'CAISSE-PRINCIPALE' },
    update: {},
    create: {
      code: 'CAISSE-PRINCIPALE',
      label: 'Caisse principale IPD (XOF)',
      custodianUserId: custodian?.id,
      currency: 'XOF',
      currentBalance: 500_000,
      ceiling: 500_000,
      perRequestMax: 100_000,
      perDayUserMax: 200_000,
    },
  });
  console.log('✅ Caisse principale chargée');
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

type DonorTemplateFixture = {
  code: string;
  name: string;
  donorCode?: string;
  currency: string;
  format?: Record<string, unknown>;
  categories: { code: string; label: string; parentCode?: string; sortOrder: number }[];
  mappings: { glAccount: string; category: string; sign?: number }[];
};

async function seedDonorReportTemplates() {
  // Tolère l'absence du fichier (utile si le seed est appelé avant
  // que sprint-6.1 n'ait livré la fixture)
  const fixturePath = path.join(SEED_DIR, 'donor-templates.json');
  if (!fs.existsSync(fixturePath)) {
    console.log('⚠️  donor-templates.json absent — skip seed templates');
    return;
  }
  const templates = loadFixture<DonorTemplateFixture>('donor-templates.json', 'templates');
  for (const t of templates) {
    // Résout le donor par code (tolère l'absence — Wellcome Trust pas seedé)
    let donorId: string | null = null;
    if (t.donorCode) {
      const donor = await prisma.donor.findUnique({ where: { code: t.donorCode } });
      donorId = donor?.id ?? null;
    }
    const tpl = await prisma.donorReportTemplate.upsert({
      where: { code: t.code },
      update: {
        name: t.name,
        donorId,
        currency: t.currency,
        format: (t.format ?? {}) as Prisma.InputJsonValue,
      },
      create: {
        code: t.code,
        name: t.name,
        donorId,
        currency: t.currency,
        format: (t.format ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Catégories (upsert par (templateId, code))
    for (const c of t.categories) {
      await prisma.donorCategory.upsert({
        where: { templateId_code: { templateId: tpl.id, code: c.code } },
        update: { label: c.label, sortOrder: c.sortOrder },
        create: {
          templateId: tpl.id,
          code: c.code,
          label: c.label,
          sortOrder: c.sortOrder,
        },
      });
    }

    // Mappings (upsert par (templateId, glAccount))
    const cats = await prisma.donorCategory.findMany({
      where: { templateId: tpl.id },
      select: { id: true, code: true },
    });
    const idByCode = new Map(cats.map((c) => [c.code, c.id]));
    for (const m of t.mappings) {
      const categoryId = idByCode.get(m.category);
      if (!categoryId) {
        console.warn(`  ⚠ template ${t.code}: catégorie "${m.category}" inconnue, mapping ignoré`);
        continue;
      }
      // Vérifie que le gl_account existe — sinon skip (tolérance pour
      // les seeds sur des plans comptables partiels en dev)
      const acct = await prisma.glAccount.findUnique({ where: { code: m.glAccount } });
      if (!acct) {
        console.warn(`  ⚠ template ${t.code}: gl_account "${m.glAccount}" absent, mapping ignoré`);
        continue;
      }
      await prisma.accountMapping.upsert({
        where: {
          templateId_glAccountCode: { templateId: tpl.id, glAccountCode: m.glAccount },
        },
        update: { donorCategoryId: categoryId, sign: m.sign ?? 1 },
        create: {
          templateId: tpl.id,
          glAccountCode: m.glAccount,
          donorCategoryId: categoryId,
          sign: m.sign ?? 1,
        },
      });
    }
    console.log(`  ✅ template ${t.code} (${t.categories.length} cats, ${t.mappings.length} mappings)`);
  }
  console.log(`✅ ${templates.length} donor templates chargés`);
}

async function main() {
  console.log('🌱 Seed GRANTFLOW IPD — démarrage...');
  await seedGlAccounts();
  await seedRoles();
  await seedDonors();
  await seedSuppliers();
  await seedTaxCodes();
  await seedFixedExchangeRates();
  await seedFiscalPeriods();
  await seedUsers();
  await seedDefaultCashBox();
  await seedDemoProjects();
  // Templates bailleur (livrés par Sprint 6.1). On tolère l'absence de la
  // table en base (P2021) pour que le seed reste utilisable sur une base
  // antérieure à sprint-6.1.
  try {
    await seedDonorReportTemplates();
  } catch (e) {
    const err = e as { code?: string; meta?: { table?: string } };
    if (err.code === 'P2021') {
      console.log(
        `⚠️  Table ${err.meta?.table ?? 'reporting.donor_report_template'} absente — sprint-6.1 pas encore appliqué, skip.`,
      );
    } else {
      throw e;
    }
  }
  console.log('🎉 Seed terminé avec succès.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
