import { Injectable, Logger } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { randomUUID } from 'crypto';
import type { Payment, PaymentRun, Supplier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import {
  EntityNotFoundException,
  SepaGenerationFailedException,
  SepaNotGeneratedException,
  SepaRunNotReadyException,
} from '../../common/exceptions/business.exception';

export const SEPA_BUCKET = 'grantflow-sepa';
const ISO_NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

interface PaymentWithJoins extends Payment {
  invoice: { id: string; invoiceNumber: string; supplier: Supplier };
}

interface RunWithJoins extends PaymentRun {
  payments: PaymentWithJoins[];
  bankAccount: {
    id: string;
    code: string;
    label: string;
    accountNumber: string;
    bic: string | null;
    bankName: string;
    currency: string;
  } | null;
}

export interface SepaGenerationResult {
  sepaFileKey: string;
  xmlString: string;
  /** Première lignes du XML pour preview (1024 chars max). */
  xmlSummary: string;
  nbOfTxs: number;
  ctrlSum: number;
}

/**
 * Génération d'un fichier SEPA pain.001.001.03 (Credit Transfer Initiation)
 * à partir d'un PaymentRun. Le XML est stocké dans MinIO bucket
 * `grantflow-sepa` et la clé est persistée sur `payment_run.sepa_file_key`.
 *
 * Standard : ISO 20022 Customer Credit Transfer Initiation, version 03 — la
 * plus largement supportée par les banques européennes en 2026.
 *
 * Conformité minimale :
 *  - <GrpHdr> : MsgId (run_number), CreDtTm ISO 8601, NbOfTxs, CtrlSum, InitgPty
 *  - <PmtInf> : 1 seule structure (1 run = 1 lot) avec PmtMtdcd=TRF,
 *    BtchBookg=true, ReqdExctnDt, Dbtr (IPD), DbtrAcct (IBAN bank account),
 *    DbtrAgt (BIC)
 *  - <CdtTrfTxInf> : 1 par paiement avec EndToEndId, InstdAmt, CdtrAcct,
 *    Cdtr, RmtInf > Ustrd
 */
@Injectable()
export class SepaService {
  private readonly logger = new Logger(SepaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Génère ou re-génère le fichier SEPA pour un run. Idempotent : si le
   * fichier existe déjà et qu'aucun paiement n'a changé, on retourne
   * l'existant ; sinon on en produit un nouveau et on remplace.
   */
  async generatePaymentRunXml(runId: string): Promise<SepaGenerationResult> {
    const run = await this.prisma.paymentRun.findUnique({
      where: { id: runId },
      include: {
        bankAccount: {
          select: {
            id: true,
            code: true,
            label: true,
            accountNumber: true,
            bic: true,
            bankName: true,
            currency: true,
          },
        },
        payments: {
          where: { status: { in: ['prepared', 'executed'] } },
          orderBy: { createdAt: 'asc' },
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                supplier: true,
              },
            },
          },
        },
      },
    });
    if (!run) throw new EntityNotFoundException('PaymentRun', { id: runId });

    if (run.status !== 'prepared' && run.status !== 'executed') {
      throw new SepaRunNotReadyException(runId, run.status);
    }
    if (!run.bankAccount) {
      throw new EntityNotFoundException('BankAccount', { runId });
    }
    if (run.payments.length === 0) {
      throw new SepaGenerationFailedException(runId, 'no payment in prepared/executed status');
    }

    try {
      const xmlString = this.buildXml(run as RunWithJoins);
      const nbOfTxs = run.payments.length;
      const ctrlSum = run.payments.reduce((s, p) => s + Number(p.amount), 0);

      // Stockage MinIO. Clé incrémentée à chaque appel pour conserver
      // l'historique des versions (re-prepare → re-gen).
      const now = new Date();
      const objectKey = `sepa/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${run.runNumber}-${randomUUID().slice(0, 8)}.xml`;
      await this.storage.putObject({
        bucket: SEPA_BUCKET,
        objectKey,
        buffer: Buffer.from(xmlString, 'utf-8'),
        contentType: 'application/xml',
        metadata: {
          'x-run-number': run.runNumber,
          'x-run-id': run.id,
        },
      });

      await this.prisma.paymentRun.update({
        where: { id: runId },
        data: { sepaFileKey: objectKey },
      });

      this.logger.log(
        { runId, runNumber: run.runNumber, objectKey, nbOfTxs, ctrlSum },
        'SEPA pain.001 generated',
      );

      return {
        sepaFileKey: objectKey,
        xmlString,
        xmlSummary: xmlString.slice(0, 1024),
        nbOfTxs,
        ctrlSum,
      };
    } catch (e) {
      if (
        e instanceof SepaGenerationFailedException ||
        e instanceof SepaRunNotReadyException ||
        e instanceof EntityNotFoundException
      ) {
        throw e;
      }
      this.logger.error({ err: e, runId }, 'SEPA generation failed');
      throw new SepaGenerationFailedException(
        runId,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /** Télécharge le fichier SEPA depuis MinIO. */
  async downloadSepaFile(runId: string): Promise<{ buffer: Buffer; filename: string }> {
    const run = await this.prisma.paymentRun.findUnique({
      where: { id: runId },
      select: { id: true, runNumber: true, sepaFileKey: true },
    });
    if (!run) throw new EntityNotFoundException('PaymentRun', { id: runId });
    if (!run.sepaFileKey) throw new SepaNotGeneratedException(runId);

    const obj = await this.storage.getObject(SEPA_BUCKET, run.sepaFileKey);
    return { buffer: obj.buffer, filename: `${run.runNumber}.xml` };
  }

  // ------------------------------------------------------------------
  // Construction XML
  // ------------------------------------------------------------------

  private buildXml(run: RunWithJoins): string {
    const nbOfTxs = run.payments.length;
    const ctrlSum = this.round2(run.payments.reduce((s, p) => s + Number(p.amount), 0));
    const creDtTm = new Date().toISOString();
    const reqdExctnDt = run.runDate.toISOString().slice(0, 10);

    const bank = run.bankAccount!;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Document', { xmlns: ISO_NAMESPACE })
      .ele('CstmrCdtTrfInitn');

    // Group Header
    const grpHdr = doc.ele('GrpHdr');
    grpHdr.ele('MsgId').txt(run.runNumber).up();
    grpHdr.ele('CreDtTm').txt(creDtTm).up();
    grpHdr.ele('NbOfTxs').txt(String(nbOfTxs)).up();
    grpHdr.ele('CtrlSum').txt(ctrlSum.toFixed(2)).up();
    grpHdr.ele('InitgPty').ele('Nm').txt('Institut Pasteur de Dakar').up().up();
    grpHdr.up();

    // Payment Information (1 batch)
    const pmtInf = doc.ele('PmtInf');
    pmtInf.ele('PmtInfId').txt(run.runNumber).up();
    pmtInf.ele('PmtMtd').txt('TRF').up();
    pmtInf.ele('BtchBookg').txt('true').up();
    pmtInf.ele('NbOfTxs').txt(String(nbOfTxs)).up();
    pmtInf.ele('CtrlSum').txt(ctrlSum.toFixed(2)).up();
    pmtInf
      .ele('PmtTpInf')
      .ele('SvcLvl')
      .ele('Cd')
      .txt('SEPA')
      .up()
      .up()
      .up();
    pmtInf.ele('ReqdExctnDt').txt(reqdExctnDt).up();
    pmtInf.ele('Dbtr').ele('Nm').txt('Institut Pasteur de Dakar').up().up();
    pmtInf
      .ele('DbtrAcct')
      .ele('Id')
      .ele('IBAN')
      .txt(this.normalizeIban(bank.accountNumber))
      .up()
      .up()
      .up();
    if (bank.bic) {
      pmtInf
        .ele('DbtrAgt')
        .ele('FinInstnId')
        .ele('BIC')
        .txt(bank.bic.toUpperCase())
        .up()
        .up()
        .up();
    }

    // 1 CdtTrfTxInf par paiement
    for (const p of run.payments) {
      const supplier = p.invoice.supplier;
      const tx = pmtInf.ele('CdtTrfTxInf');
      tx
        .ele('PmtId')
        .ele('EndToEndId')
        .txt(p.invoice.invoiceNumber.slice(0, 35))
        .up()
        .up();
      tx
        .ele('Amt')
        .ele('InstdAmt', { Ccy: p.currency.toUpperCase() })
        .txt(this.round2(Number(p.amount)).toFixed(2))
        .up()
        .up();
      if (supplier.bic) {
        tx
          .ele('CdtrAgt')
          .ele('FinInstnId')
          .ele('BIC')
          .txt(supplier.bic.toUpperCase())
          .up()
          .up()
          .up();
      }
      tx.ele('Cdtr').ele('Nm').txt(supplier.name.slice(0, 70)).up().up();
      if (supplier.iban) {
        tx
          .ele('CdtrAcct')
          .ele('Id')
          .ele('IBAN')
          .txt(this.normalizeIban(supplier.iban))
          .up()
          .up()
          .up();
      }
      tx
        .ele('RmtInf')
        .ele('Ustrd')
        .txt(
          `Facture ${p.invoice.invoiceNumber} - ${supplier.code}`.slice(0, 140),
        )
        .up()
        .up();
      tx.up();
    }

    pmtInf.up();
    return doc.end({ prettyPrint: true });
  }

  private normalizeIban(raw: string): string {
    return raw.replace(/\s+/g, '').toUpperCase();
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
