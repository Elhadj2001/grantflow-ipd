import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialStatementNotBalancedException } from '../../common/exceptions/business.exception';

export type StatementType = 'TER' | 'BILAN' | 'RESULTAT';

export interface StatementLine {
  section: string;
  label: string;
  accountCode: string | null;
  debit: number;
  credit: number;
  balance: number;
  sortOrder: number;
}

export interface StatementResult {
  type: StatementType;
  periodId: string;
  periodCode: string;
  lines: StatementLine[];
  totals: {
    leftTotal: number;
    rightTotal: number;
    balanced: boolean;
    [key: string]: number | boolean | string;
  };
}

/**
 * Sections SYSCEBNL utilisées par le TER (Tableau Emplois/Ressources).
 *
 * Côté EMPLOIS = utilisations de fonds (classe 6 — charges, certaines
 * classes 2 immobilisations, reprises 789 si surplus). Côté RESSOURCES
 * = origines de fonds (classe 7 — produits, dotations 689, augmentations
 * de passif).
 *
 * Pour cette première itération sprint 6.2 on construit un TER simplifié
 * : on agrège les comptes 6x dans EMPLOIS et 7x dans RESSOURCES, en
 * isolant 689 / 789 en lignes dédiées pour respecter le format
 * SYSCEBNL associatif.
 */
export const TER_SECTION_EMPLOIS = 'EMPLOIS';
export const TER_SECTION_RESSOURCES = 'RESSOURCES';

export const BILAN_SECTION_ACTIF = 'ACTIF';
export const BILAN_SECTION_PASSIF = 'PASSIF';

export const RESULTAT_SECTION_CHARGES = 'CHARGES';
export const RESULTAT_SECTION_PRODUITS = 'PRODUITS';

interface AccountBalanceRow {
  account_code: string;
  account_label: string;
  account_class: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

/**
 * Génère les états financiers SYSCEBNL :
 *   - TER       : Tableau des Emplois et Ressources (emplois ↔ ressources)
 *   - BILAN     : actif vs passif (équilibre obligatoire)
 *   - RESULTAT  : charges vs produits (résultat net = produits - charges)
 *
 * Source de vérité : gl.journal_line + gl.journal_entry filtré sur
 * status='posted' ET period_id = ?. Le service NE persiste PAS — il
 * renvoie un StatementResult que le DonorReportService équivalent
 * (FinancialStatementService) va snapshotter dans financial_statement
 * + financial_statement_line.
 *
 * Tolérance d'équilibre : ±1 XOF (arrondis cumulés). Au-delà, on lève
 * FinancialStatementNotBalancedException pour empêcher un état faux
 * d'être verrouillé.
 */
@Injectable()
export class FinancialStatementGeneratorService {
  private readonly logger = new Logger(FinancialStatementGeneratorService.name);

  /** Tolérance d'arrondi cumulé en XOF avant de refuser l'état. */
  public static readonly BALANCE_TOLERANCE = 1;

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Dispatcher
  // ------------------------------------------------------------------

  async generate(
    type: StatementType,
    period: { id: string; code: string },
  ): Promise<StatementResult> {
    const balances = await this.loadBalances(period.id);
    switch (type) {
      case 'TER':
        return this.generateTer(period, balances);
      case 'BILAN':
        return this.generateBilan(period, balances);
      case 'RESULTAT':
        return this.generateResultat(period, balances);
    }
  }

  // ------------------------------------------------------------------
  // TER — Tableau des Emplois et Ressources
  // ------------------------------------------------------------------

  generateTer(
    period: { id: string; code: string },
    balances: AccountBalanceRow[],
  ): StatementResult {
    const lines: StatementLine[] = [];

    // EMPLOIS = comptes 6x (charges), hors 689 isolé. Sens : debit positif.
    const charges = balances.filter(
      (b) => b.account_class === '6' && !b.account_code.startsWith('689'),
    );
    let totalEmplois = 0;
    let sort = 0;
    for (const c of charges) {
      const amount = this.round2(Number(c.balance));
      if (amount === 0) continue;
      lines.push({
        section: TER_SECTION_EMPLOIS,
        label: `${c.account_code} — ${c.account_label}`,
        accountCode: c.account_code,
        debit: this.round2(Number(c.total_debit)),
        credit: this.round2(Number(c.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalEmplois += amount;
    }
    // Reprises 789 figurent côté EMPLOIS dans le TER associatif (diminution
    // des ressources antérieures utilisées maintenant).
    const reprise = balances.find((b) => b.account_code === '789');
    if (reprise && Number(reprise.balance) !== 0) {
      const amount = -this.round2(Number(reprise.balance)); // 789 a un solde créditeur (negatif d-c)
      lines.push({
        section: TER_SECTION_EMPLOIS,
        label: `789 — ${reprise.account_label} (reprise)`,
        accountCode: '789',
        debit: this.round2(Number(reprise.total_debit)),
        credit: this.round2(Number(reprise.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalEmplois += amount;
    }

    // RESSOURCES = comptes 7x (produits), hors 789 traité côté emplois.
    const produits = balances.filter(
      (b) => b.account_class === '7' && b.account_code !== '789',
    );
    let totalRessources = 0;
    for (const p of produits) {
      // produit = solde créditeur, on inverse le signe pour avoir positif
      const amount = -this.round2(Number(p.balance));
      if (amount === 0) continue;
      lines.push({
        section: TER_SECTION_RESSOURCES,
        label: `${p.account_code} — ${p.account_label}`,
        accountCode: p.account_code,
        debit: this.round2(Number(p.total_debit)),
        credit: this.round2(Number(p.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalRessources += amount;
    }
    // Dotation 689 figure côté RESSOURCES (montant à mettre de côté → fonds dédiés).
    const dotation = balances.find((b) => b.account_code === '689');
    if (dotation && Number(dotation.balance) !== 0) {
      const amount = this.round2(Number(dotation.balance));
      lines.push({
        section: TER_SECTION_RESSOURCES,
        label: `689 — ${dotation.account_label} (dotation)`,
        accountCode: '689',
        debit: this.round2(Number(dotation.total_debit)),
        credit: this.round2(Number(dotation.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalRessources += amount;
    }

    totalEmplois = this.round2(totalEmplois);
    totalRessources = this.round2(totalRessources);

    return this.finalize('TER', period, lines, totalEmplois, totalRessources, {
      totalEmplois,
      totalRessources,
    });
  }

  // ------------------------------------------------------------------
  // BILAN — Actif / Passif (simplifié)
  // ------------------------------------------------------------------

  generateBilan(
    period: { id: string; code: string },
    balances: AccountBalanceRow[],
  ): StatementResult {
    const lines: StatementLine[] = [];

    // ACTIF = classes 2 (immobilisations), 3 (stocks), 4 hors 40x
    // (créances), 5 (financier débit). Solde débiteur positif.
    let totalActif = 0;
    let sort = 0;
    for (const b of balances) {
      const cls = b.account_class;
      const code = b.account_code;
      const bal = Number(b.balance);
      // Actif : classes 2/3/5 + classe 4 hors fournisseurs (40x)
      const isActif =
        (cls === '2' || cls === '3' || cls === '5' || (cls === '4' && !code.startsWith('40'))) &&
        bal > 0;
      if (!isActif) continue;
      const amount = this.round2(bal);
      lines.push({
        section: BILAN_SECTION_ACTIF,
        label: `${code} — ${b.account_label}`,
        accountCode: code,
        debit: this.round2(Number(b.total_debit)),
        credit: this.round2(Number(b.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalActif += amount;
    }

    // PASSIF = classes 1 (capitaux propres + fonds dédiés 19), 40x
    // (fournisseurs créditeurs). Solde créditeur positif (inversé).
    let totalPassif = 0;
    for (const b of balances) {
      const cls = b.account_class;
      const code = b.account_code;
      const bal = Number(b.balance);
      const isPassif =
        (cls === '1' || (cls === '4' && code.startsWith('40'))) && bal < 0;
      if (!isPassif) continue;
      const amount = -this.round2(bal); // inversion : passif = créditeur
      lines.push({
        section: BILAN_SECTION_PASSIF,
        label: `${code} — ${b.account_label}`,
        accountCode: code,
        debit: this.round2(Number(b.total_debit)),
        credit: this.round2(Number(b.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalPassif += amount;
    }

    // Résultat de l'exercice — différentiel charges/produits → reporté au passif (capitaux propres).
    const resultat = this.computeResultat(balances);
    if (resultat !== 0) {
      lines.push({
        section: BILAN_SECTION_PASSIF,
        label: `12 — Résultat net de l'exercice`,
        accountCode: '12',
        debit: 0,
        credit: 0,
        balance: this.round2(resultat),
        sortOrder: sort++,
      });
      totalPassif += this.round2(resultat);
    }

    totalActif = this.round2(totalActif);
    totalPassif = this.round2(totalPassif);

    return this.finalize('BILAN', period, lines, totalActif, totalPassif, {
      totalActif,
      totalPassif,
      resultatNet: this.round2(resultat),
    });
  }

  // ------------------------------------------------------------------
  // RESULTAT — Compte de résultat (charges / produits par nature)
  // ------------------------------------------------------------------

  generateResultat(
    period: { id: string; code: string },
    balances: AccountBalanceRow[],
  ): StatementResult {
    const lines: StatementLine[] = [];
    let totalCharges = 0;
    let totalProduits = 0;
    let sort = 0;

    for (const b of balances.filter((x) => x.account_class === '6')) {
      const amount = this.round2(Number(b.balance));
      if (amount === 0) continue;
      lines.push({
        section: RESULTAT_SECTION_CHARGES,
        label: `${b.account_code} — ${b.account_label}`,
        accountCode: b.account_code,
        debit: this.round2(Number(b.total_debit)),
        credit: this.round2(Number(b.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalCharges += amount;
    }
    for (const b of balances.filter((x) => x.account_class === '7')) {
      const amount = -this.round2(Number(b.balance)); // 7x = créditeur → on inverse
      if (amount === 0) continue;
      lines.push({
        section: RESULTAT_SECTION_PRODUITS,
        label: `${b.account_code} — ${b.account_label}`,
        accountCode: b.account_code,
        debit: this.round2(Number(b.total_debit)),
        credit: this.round2(Number(b.total_credit)),
        balance: amount,
        sortOrder: sort++,
      });
      totalProduits += amount;
    }

    totalCharges = this.round2(totalCharges);
    totalProduits = this.round2(totalProduits);
    const resultatNet = this.round2(totalProduits - totalCharges);

    // Le compte de résultat est équilibré par construction : on compare
    // totalProduits vs (totalCharges + resultatNet) — qui est toujours
    // égal. On stocke le résultat dans totals mais on ne lève pas
    // FinancialStatementNotBalancedException ici.
    return {
      type: 'RESULTAT',
      periodId: period.id,
      periodCode: period.code,
      lines,
      totals: {
        leftTotal: totalCharges,
        rightTotal: totalProduits,
        balanced: true,
        totalCharges,
        totalProduits,
        resultatNet,
      },
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Charge la balance par compte (somme debit/credit/solde) pour la
   * période. Inclut tous les comptes mouvementés via journal_entry
   * status='posted'.
   */
  async loadBalances(periodId: string): Promise<AccountBalanceRow[]> {
    return this.prisma.$queryRaw<AccountBalanceRow[]>`
      SELECT
        a.code  AS account_code,
        a.label AS account_label,
        a.class AS account_class,
        COALESCE(SUM(l.debit), 0)::float  AS total_debit,
        COALESCE(SUM(l.credit), 0)::float AS total_credit,
        COALESCE(SUM(l.debit - l.credit), 0)::float AS balance
      FROM ref.gl_account a
      JOIN gl.journal_line l   ON l.account_code = a.code
      JOIN gl.journal_entry e  ON e.id = l.entry_id
      WHERE e.status = 'posted'
        AND e.period_id = ${periodId}::uuid
      GROUP BY a.code, a.label, a.class
      ORDER BY a.code ASC
    `;
  }

  private computeResultat(balances: AccountBalanceRow[]): number {
    const charges = balances
      .filter((b) => b.account_class === '6')
      .reduce((s, b) => s + Number(b.balance), 0);
    const produits = -balances
      .filter((b) => b.account_class === '7')
      .reduce((s, b) => s + Number(b.balance), 0);
    return produits - charges;
  }

  private finalize(
    type: StatementType,
    period: { id: string; code: string },
    lines: StatementLine[],
    leftTotal: number,
    rightTotal: number,
    extraTotals: Record<string, number>,
  ): StatementResult {
    const balanced =
      Math.abs(leftTotal - rightTotal) <= FinancialStatementGeneratorService.BALANCE_TOLERANCE;
    if (!balanced) {
      this.logger.warn(
        { type, leftTotal, rightTotal, diff: leftTotal - rightTotal },
        'statement NOT balanced — generator returned anyway, service will refuse to lock',
      );
    }
    return {
      type,
      periodId: period.id,
      periodCode: period.code,
      lines,
      totals: {
        leftTotal: this.round2(leftTotal),
        rightTotal: this.round2(rightTotal),
        balanced,
        ...extraTotals,
      },
    };
  }

  /**
   * Vérifie l'équilibre et lève FinancialStatementNotBalancedException
   * si la tolérance est dépassée. Appelé par le service de persistence
   * avant le lock.
   */
  assertBalanced(result: StatementResult): void {
    if (result.type === 'RESULTAT') return; // toujours équilibré par construction
    if (!result.totals.balanced) {
      throw new FinancialStatementNotBalancedException(
        result.type,
        Number(result.totals.leftTotal),
        Number(result.totals.rightTotal),
      );
    }
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
