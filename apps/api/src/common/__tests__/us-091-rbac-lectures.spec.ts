/**
 * US-091 (F-S8-17/18/19/20) — lectures sensibles gardées.
 *
 * Le RolesGuard global renvoie `true` quand @Roles est ABSENT : une route
 * sans décorateur est ouverte à tout authentifié. Ce spec fige les
 * métadonnées @Roles des routes corrigées par l'audit v2 — c'est
 * exactement ce que lit le guard (pattern note-technique.controller.spec).
 */
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { PaymentRunController } from '../../treasury/payment-run.controller';
import { BankAccountController } from '../../treasury/bank-account.controller';
import { ReportingController } from '../../reporting/reporting.controller';

const reflector = new Reflector();
const rolesOf = (fn: unknown): string[] =>
  reflector.get<string[]>(ROLES_KEY, fn as () => unknown) ?? [];

const FINANCE = ['TRESORIER', 'COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN'];

describe('US-091 — RBAC des lectures sensibles (audit v2)', () => {
  it('F-S8-17 : les 5 lectures payment-runs/paiements portent les rôles de la liste', () => {
    for (const handler of [
      PaymentRunController.prototype.findOne,
      PaymentRunController.prototype.payments,
      PaymentRunController.prototype.journalEntries,
      PaymentRunController.prototype.paymentDetail,
      PaymentRunController.prototype.historyForInvoice,
    ]) {
      expect(rolesOf(handler)).toEqual(FINANCE);
    }
    // BAILLEUR exclu partout (il ne doit pas voir les fournisseurs payés).
    expect(rolesOf(PaymentRunController.prototype.findOne)).not.toContain('BAILLEUR');
  });

  it('F-S8-18 : téléchargements des états financiers gardés (BAILLEUR inclus, filtré locked au service)', () => {
    const expected = ['CONTROLEUR', 'DAF', 'COMPTABLE', 'BAILLEUR', 'SUPER_ADMIN'];
    expect(rolesOf(ReportingController.prototype.downloadStatementPdf)).toEqual(expected);
    expect(rolesOf(ReportingController.prototype.downloadStatementExcel)).toEqual(expected);
  });

  it('F-S8-19 : lectures des comptes bancaires (IBAN) réservées aux rôles finance', () => {
    const expected = ['TRESORIER', 'COMPTABLE', 'DAF', 'SUPER_ADMIN'];
    expect(rolesOf(BankAccountController.prototype.list)).toEqual(expected);
    expect(rolesOf(BankAccountController.prototype.findOne)).toEqual(expected);
    expect(rolesOf(BankAccountController.prototype.list)).not.toContain('BAILLEUR');
    expect(rolesOf(BankAccountController.prototype.list)).not.toContain('DEMANDEUR');
  });

  it('F-S8-20 : lectures des templates alignées sur les écritures (CG/DAF/SA)', () => {
    const expected = ['CONTROLEUR', 'DAF', 'SUPER_ADMIN'];
    expect(rolesOf(ReportingController.prototype.listTemplates)).toEqual(expected);
    expect(rolesOf(ReportingController.prototype.findTemplate)).toEqual(expected);
  });
});
