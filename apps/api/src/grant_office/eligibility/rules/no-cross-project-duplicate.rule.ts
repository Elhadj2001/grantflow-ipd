import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { EligibilityRule } from './rule.interface';
import type { EligibilityContext } from '../eligibility-context';
import type { Verdict } from '../verdict';
import { OK, warning } from '../verdict';

/**
 * US-046 — Détection de doublon de facture inter-projet (refacturation).
 *
 * Quand une DA référence un numéro de facture fournisseur, cette règle vérifie
 * qu'aucune autre facture portant le même numéro n'est déjà imputée ailleurs.
 * Un doublon peut signaler une refacturation inter-projet (potentiellement
 * Pasteur Paris) à contrôler manuellement.
 *
 * Règle non bloquante (severity 'warning', ADR-007) : elle alerte le Grant
 * Office sans empêcher la soumission. La précision « cross-project » réelle
 * (jointure BC → grant ≠ ctx.pr.grantId) sera affinée ultérieurement ; ce
 * scaffolding fait un best-effort sur le seul numéro de facture.
 *
 * Nécessite un accès DB → PrismaService injecté.
 */
@Injectable()
export class NoCrossProjectDuplicateRule implements EligibilityRule {
  readonly code = 'ELIG_CROSS_PROJECT_DUPLICATE';
  readonly severity = 'warning' as const;

  constructor(private readonly prisma: PrismaService) {}

  async check(ctx: EligibilityContext): Promise<Verdict> {
    // `supplierInvoiceNumber` n'est pas (encore) un champ typé de l'EligibilityContext :
    // lecture défensive sans modifier le type partagé.
    const supplierInvoiceNumber = (ctx.pr as { supplierInvoiceNumber?: string })
      .supplierInvoiceNumber;

    // La règle ne s'applique qu'aux DA référant une facture : sinon no-op.
    if (!supplierInvoiceNumber) {
      return OK;
    }

    const dupes = await this.prisma.invoice.findMany({
      where: { invoiceNumber: supplierInvoiceNumber },
      select: { id: true, invoiceNumber: true },
    });

    if (dupes.length > 0) {
      return warning(
        this.code,
        `Facture ${supplierInvoiceNumber} déjà imputée ailleurs — vérifier (refacturation inter-projet possible).`,
        { count: dupes.length },
      );
    }

    return OK;
  }
}
