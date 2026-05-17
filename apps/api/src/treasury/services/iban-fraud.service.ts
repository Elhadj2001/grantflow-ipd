import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fenêtre temporelle (en jours) pendant laquelle un changement d'IBAN
 * est considéré suspect. Au-delà, le changement est jugé stable.
 *
 * 90 jours = bon équilibre entre fraude réaliste (un attaquant qui pousse
 * un IBAN frauduleux quelques semaines avant un gros décaissement) et
 * faux positifs (changement légitime d'agence bancaire).
 */
export const IBAN_ALERT_WINDOW_DAYS = 90;

export interface IbanAlert {
  paymentId: string;
  invoiceId: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  currentIban: string | null;
  previousIban: string | null;
  changedAt: string; // ISO
  daysSinceChange: number;
  changedBy: string | null;
  changeReason: string | null;
}

/**
 * Service anti-fraude IBAN. À chaque préparation d'un PaymentRun, on
 * compare l'IBAN courant de chaque fournisseur avec son historique :
 * tout changement détecté dans les `IBAN_ALERT_WINDOW_DAYS` derniers
 * jours déclenche une alerte qui doit être explicitement acquittée par
 * le DAF avant approval.
 */
@Injectable()
export class IbanFraudService {
  private readonly logger = new Logger(IbanFraudService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Audit anti-fraude d'un PaymentRun.
   *
   * Stratégie : pour chaque payment du run, on récupère les 2 dernières
   * entrées de `ref.supplier_iban_history` (courante + précédente). Si
   * la précédente a `effective_to` ≥ now() - 90 jours, c'est qu'un
   * changement récent a eu lieu — alerte.
   */
  async checkPaymentRun(runId: string): Promise<IbanAlert[]> {
    const payments = await this.prisma.payment.findMany({
      where: { paymentRunId: runId },
      select: {
        id: true,
        invoiceId: true,
        invoice: {
          select: {
            id: true,
            supplier: {
              select: { id: true, code: true, name: true, iban: true },
            },
          },
        },
      },
    });
    if (payments.length === 0) return [];

    const alerts: IbanAlert[] = [];
    const now = Date.now();
    const windowMs = IBAN_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    for (const p of payments) {
      const supplier = p.invoice.supplier;
      // 2 dernières entrées (courante + précédente)
      const history = await this.prisma.supplierIbanHistory.findMany({
        where: { supplierId: supplier.id },
        orderBy: { effectiveFrom: 'desc' },
        take: 2,
      });
      if (history.length < 2) continue; // Pas d'historique → pas d'alerte

      const current = history[0];
      const previous = history[1];
      // La ligne précédente doit avoir été clôturée — on lit son
      // effective_to (date du switch).
      if (!previous.effectiveTo) continue;
      const changedAt = previous.effectiveTo;
      const daysSinceChange = Math.floor((now - changedAt.getTime()) / (24 * 60 * 60 * 1000));
      if (changedAt.getTime() < now - windowMs) continue;

      alerts.push({
        paymentId: p.id,
        invoiceId: p.invoiceId,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.name,
        currentIban: current.iban,
        previousIban: previous.iban,
        changedAt: changedAt.toISOString(),
        daysSinceChange,
        changedBy: current.changedBy,
        changeReason: current.changeReason,
      });
    }

    if (alerts.length > 0) {
      this.logger.warn(
        { runId, alertCount: alerts.length, suppliers: alerts.map((a) => a.supplierCode) },
        'IBAN_FRAUD_ALERTS detected on payment run',
      );
    }
    return alerts;
  }
}
