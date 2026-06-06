import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import { SepaGenerationFailedException } from '../../common/exceptions/business.exception';

/**
 * Génération XML SEPA pain.001.001.03 (Customer Credit Transfer Initiation).
 *
 * Couvre le scope F4a — uniquement les virements (TRF), pas les
 * prélèvements (qui sont en pain.008). Multidevises supporté : chaque
 * transaction `CdtTrfTxInf` porte sa propre devise via `InstdAmt Ccy=`.
 *
 * Validation officielle ISO 20022 → outil externe (xmllint en CI,
 * validateur banque au premier paiement réel). Côté code on parse la
 * structure pour vérifier la non-régression (présence des nœuds clés).
 */
export interface SepaDebtor {
  /** Nom donneur d'ordre (IPD). */
  name: string;
  /** IBAN compte payeur (BankAccount.iban). */
  iban: string;
  /** BIC compte payeur (BankAccount.bic). */
  bic: string;
}

export interface SepaCreditor {
  /** Nom bénéficiaire (supplier.name). */
  name: string;
  /** IBAN bénéficiaire (supplier.iban — déjà validé en amont). */
  iban: string;
  /** BIC bénéficiaire (supplier.bic). */
  bic: string;
}

export interface SepaTransaction {
  /** Identifiant de transaction unique (utilisé par EndToEndId). */
  endToEndId: string;
  /** Montant à transférer (Decimal converti en string 2-dec). */
  amount: string;
  /** Devise ISO 4217 (ex 'EUR', 'XOF'). */
  currency: string;
  creditor: SepaCreditor;
  /** Libellé pour information bénéficiaire (souvent invoiceNumber). */
  remittanceInfo: string;
}

export interface SepaPayload {
  /** Identifiant du message SEPA (paymentRun.runNumber). */
  messageId: string;
  /** Date de génération (ISO 8601 avec timezone). */
  createdAt: Date;
  /** Date d'exécution souhaitée (paymentRun.runDate). */
  executionDate: Date;
  debtor: SepaDebtor;
  transactions: SepaTransaction[];
}

@Injectable()
export class SepaService {
  private readonly logger = new Logger(SepaService.name);

  /**
   * Construit le XML pain.001.001.03 pour un PaymentRun. Le résultat est
   * une chaîne UTF-8 indentée, prête à être streamée vers la banque ou
   * stockée dans MinIO (`paymentRun.sepaFileKey`).
   *
   * @throws SepaGenerationFailedException si la construction xmlbuilder2
   *   plante ou si un champ obligatoire manque (IBAN/BIC empty, etc).
   */
  generate(payload: SepaPayload): string {
    if (!payload.transactions || payload.transactions.length === 0) {
      throw new SepaGenerationFailedException(payload.messageId, 'no transactions in payload');
    }
    if (!payload.debtor.iban || !payload.debtor.bic) {
      throw new SepaGenerationFailedException(payload.messageId, 'debtor missing IBAN/BIC');
    }
    for (const tx of payload.transactions) {
      if (!tx.creditor.iban || !tx.creditor.bic) {
        throw new SepaGenerationFailedException(
          payload.messageId,
          `creditor ${tx.creditor.name} missing IBAN/BIC`,
        );
      }
    }

    try {
      // Somme de contrôle exacte en Prisma.Decimal (F10). Les montants sont
      // des chaînes 2-décimales ; le constructeur Decimal les parse sans
      // perte float, contrairement à une addition Number().
      const ctrlSum = payload.transactions
        .reduce((s, t) => s.plus(new Prisma.Decimal(t.amount)), new Prisma.Decimal(0))
        .toFixed(2);
      const nbOfTxs = payload.transactions.length;

      const doc = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('Document', {
          xmlns: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
          'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        })
        .ele('CstmrCdtTrfInitn');

      // ---------- Group Header ----------
      doc
        .ele('GrpHdr')
          .ele('MsgId').txt(payload.messageId).up()
          .ele('CreDtTm').txt(payload.createdAt.toISOString().slice(0, 19)).up()
          .ele('NbOfTxs').txt(String(nbOfTxs)).up()
          .ele('CtrlSum').txt(ctrlSum).up()
          .ele('InitgPty')
            .ele('Nm').txt(payload.debtor.name).up()
          .up()
        .up();

      // ---------- Payment Information (1 seul PmtInf bloc — multi-tx) ----------
      const pmtInf = doc.ele('PmtInf');
      pmtInf.ele('PmtInfId').txt(`${payload.messageId}-PMT`).up();
      pmtInf.ele('PmtMtd').txt('TRF').up();
      pmtInf.ele('NbOfTxs').txt(String(nbOfTxs)).up();
      pmtInf.ele('CtrlSum').txt(ctrlSum).up();
      pmtInf
        .ele('PmtTpInf')
          .ele('SvcLvl')
            .ele('Cd').txt('SEPA').up()
          .up()
        .up();
      pmtInf.ele('ReqdExctnDt').txt(payload.executionDate.toISOString().slice(0, 10)).up();
      pmtInf
        .ele('Dbtr')
          .ele('Nm').txt(payload.debtor.name).up()
        .up();
      pmtInf
        .ele('DbtrAcct')
          .ele('Id')
            .ele('IBAN').txt(payload.debtor.iban.replace(/\s/g, '')).up()
          .up()
        .up();
      pmtInf
        .ele('DbtrAgt')
          .ele('FinInstnId')
            .ele('BIC').txt(payload.debtor.bic).up()
          .up()
        .up();
      pmtInf.ele('ChrgBr').txt('SLEV').up();

      // ---------- Transactions ----------
      for (const tx of payload.transactions) {
        const txEl = pmtInf.ele('CdtTrfTxInf');
        txEl
          .ele('PmtId')
            .ele('EndToEndId').txt(tx.endToEndId).up()
          .up();
        txEl
          .ele('Amt')
            .ele('InstdAmt', { Ccy: tx.currency }).txt(Number(tx.amount).toFixed(2)).up()
          .up();
        txEl
          .ele('CdtrAgt')
            .ele('FinInstnId')
              .ele('BIC').txt(tx.creditor.bic).up()
            .up()
          .up();
        txEl
          .ele('Cdtr')
            .ele('Nm').txt(tx.creditor.name).up()
          .up();
        txEl
          .ele('CdtrAcct')
            .ele('Id')
              .ele('IBAN').txt(tx.creditor.iban.replace(/\s/g, '')).up()
            .up()
          .up();
        txEl
          .ele('RmtInf')
            .ele('Ustrd').txt(tx.remittanceInfo.slice(0, 140)).up()
          .up();
      }

      const xml = doc.end({ prettyPrint: true });
      this.logger.log(
        { messageId: payload.messageId, nbOfTxs, ctrlSum },
        'SEPA pain.001.001.03 generated',
      );
      return xml;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error({ messageId: payload.messageId, err: reason }, 'SEPA generation failed');
      throw new SepaGenerationFailedException(payload.messageId, reason);
    }
  }

  /**
   * Validation structurelle minimale (test de non-régression). NE FAIT PAS
   * une validation XSD ISO 20022 complète — pour ça utiliser xmllint en CI
   * ou l'outil de validation de la banque au 1er paiement réel.
   *
   * Vérifie la présence des nœuds racine et au moins une transaction.
   */
  validateStructure(xml: string): { valid: boolean; missing: string[] } {
    const required = [
      '<Document',
      '<CstmrCdtTrfInitn>',
      '<GrpHdr>',
      '<MsgId>',
      '<CreDtTm>',
      '<NbOfTxs>',
      '<CtrlSum>',
      '<PmtInf>',
      '<PmtMtd>TRF</PmtMtd>',
      '<CdtTrfTxInf>',
      '<EndToEndId>',
      '<InstdAmt',
      '<IBAN>',
      '<BIC>',
    ];
    const missing = required.filter((tag) => !xml.includes(tag));
    return { valid: missing.length === 0, missing };
  }
}
