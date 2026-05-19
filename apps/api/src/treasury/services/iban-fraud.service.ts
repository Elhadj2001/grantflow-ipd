import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Détection des changements d'IBAN récents — anti-fraude PaymentRun.
 *
 * Au moment du prepare d'un PaymentRun, on liste les fournisseurs
 * dont l'IBAN courant a été modifié il y a moins de N jours (défaut 30)
 * et on génère une alerte qui bloque l'approbation tant qu'un DAF n'a
 * pas acknowledger avec un motif.
 *
 * Source : `ref.supplier_iban_history`. La ligne "courante" est celle
 * où `effective_to IS NULL`. La précédente (l'ancien IBAN) a un
 * `effective_to` renseigné qui correspond au moment du changement.
 */

const DEFAULT_WINDOW_DAYS = 30;

export interface IbanAlert {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  /** IBAN courant (utilisé dans le paiement). */
  currentIban: string;
  /** IBAN précédent (clôturé). */
  previousIban: string | null;
  /** Date du changement. */
  changedAt: string;
  /** Jours écoulés depuis le changement. */
  daysSinceChange: number;
  /** UUID de l'utilisateur ayant modifié l'IBAN (peut être null si import). */
  changedBy: string | null;
  /** ACK status — false initialement, devient true après acknowledge DAF. */
  acknowledged: boolean;
  /** Email DAF qui a acknowledgé. */
  acknowledgedBy: string | null;
  /** Date ISO de l'acknowledge. */
  acknowledgedAt: string | null;
  /** Motif (obligatoire min 5 chars). */
  acknowledgeReason: string | null;
}

@Injectable()
export class IbanFraudService {
  private readonly logger = new Logger(IbanFraudService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Identifie les fournisseurs concernés par un PaymentRun (via leurs
   * factures) qui ont eu un changement d'IBAN récent.
   *
   * Renvoie un tableau d'alertes — peut être vide. Le service ne
   * persiste pas ; c'est PaymentRunService qui stockera dans `ibanAlerts`.
   */
  async computeAlertsForRun(
    paymentRunId: string,
    windowDays: number = DEFAULT_WINDOW_DAYS,
  ): Promise<IbanAlert[]> {
    // Suppliers concernés par ce run (via les paiements → invoices → supplier)
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        invoices: {
          some: {
            payments: { some: { paymentRunId } },
          },
        },
      },
      select: { id: true, code: true, name: true, iban: true },
    });

    if (suppliers.length === 0) return [];

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const alerts: IbanAlert[] = [];

    for (const s of suppliers) {
      // La ligne précédente (la plus récente avec effective_to renseigné)
      // doit avoir effective_to >= cutoff pour déclencher une alerte.
      const previous = await this.prisma.supplierIbanHistory.findFirst({
        where: {
          supplierId: s.id,
          effectiveTo: { not: null, gte: cutoff },
        },
        orderBy: { effectiveTo: 'desc' },
      });
      if (!previous) continue;

      const changedAt = previous.effectiveTo!;
      const daysSinceChange = Math.floor(
        (Date.now() - changedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      alerts.push({
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        currentIban: s.iban ?? '',
        previousIban: previous.iban,
        changedAt: changedAt.toISOString(),
        daysSinceChange,
        changedBy: previous.changedBy,
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
        acknowledgeReason: null,
      });
    }

    if (alerts.length > 0) {
      this.logger.warn(
        { paymentRunId, alertCount: alerts.length, windowDays },
        'IBAN fraud alerts detected for payment run',
      );
    }

    return alerts;
  }

  /**
   * Vérifie s'il existe des alertes non-acknowledgées dans un payload.
   * Utilisé par PaymentRunService.approve() pour bloquer si nécessaire.
   */
  countUnacknowledged(alerts: IbanAlert[] | null): number {
    if (!alerts) return 0;
    return alerts.filter((a) => !a.acknowledged).length;
  }

  /**
   * Marque toutes les alertes comme acknowledgées (mutation immutable :
   * renvoie un nouveau tableau). La traçabilité (qui, quand, pourquoi)
   * est gravée dans chaque alerte ET en audit log côté caller.
   */
  acknowledgeAll(
    alerts: IbanAlert[],
    acknowledger: { email: string; reason: string },
  ): IbanAlert[] {
    const now = new Date().toISOString();
    return alerts.map((a) => ({
      ...a,
      acknowledged: true,
      acknowledgedBy: a.acknowledged ? a.acknowledgedBy : acknowledger.email,
      acknowledgedAt: a.acknowledged ? a.acknowledgedAt : now,
      acknowledgeReason: a.acknowledged ? a.acknowledgeReason : acknowledger.reason,
    }));
  }

  /**
   * Masque un IBAN pour affichage UI / logs (anti-PII).
   * "FR7630006000011234567890189" → "FR76 **** **** **** **89 78".
   */
  maskIban(iban: string | null | undefined): string {
    if (!iban) return '—';
    const clean = iban.replace(/\s/g, '');
    if (clean.length < 8) return '****';
    return `${clean.slice(0, 4)} **** **** **** **${clean.slice(-4, -2)} ${clean.slice(-2)}`;
  }
}
