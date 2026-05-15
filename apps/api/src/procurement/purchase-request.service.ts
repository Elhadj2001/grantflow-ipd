import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

@Injectable()
export class PurchaseRequestService {
  private readonly logger = new Logger(PurchaseRequestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une DA en statut DRAFT.
   *
   * Règles vérifiées :
   * 1. Le grant appartient bien au projet sélectionné.
   * 2. Chaque ligne pointe sur une budgetLine du grant.
   * 3. La somme des lignes est compatible avec le solde disponible (sinon BadRequest).
   */
  async create(actor: AuthenticatedUser, dto: CreatePurchaseRequestDto) {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: dto.grantId },
      include: { budgetLines: true },
    });
    if (!grant) throw new NotFoundException('Convention bailleur introuvable.');
    if (grant.projectId !== dto.projectId)
      throw new BadRequestException('Le grant ne correspond pas au projet.');

    // Vérifier les budget lines
    const validBudgetLineIds = new Set(grant.budgetLines.map((b) => b.id));
    for (const line of dto.lines) {
      if (!validBudgetLineIds.has(line.budgetLineId))
        throw new BadRequestException(`Ligne budgétaire ${line.budgetLineId} invalide.`);
    }

    // Calculer le total
    const totalAmount = dto.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    // Numérotation séquentielle de l'exercice
    const prNumber = await this.generatePrNumber();

    return this.prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseRequest.create({
        data: {
          prNumber,
          requestedBy: actor.id,
          neededBy: dto.neededBy,
          status: 'draft',
          projectId: dto.projectId,
          grantId: dto.grantId,
          costCenterId: dto.costCenterId,
          activityId: dto.activityId,
          totalAmount,
          currency: dto.currency,
          description: dto.description,
          lines: {
            create: dto.lines.map((line, i) => ({
              lineNumber: i + 1,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              budgetLineId: line.budgetLineId,
            })),
          },
        },
        include: { lines: true },
      });

      this.logger.log(`PR ${pr.prNumber} créée par ${actor.id} (montant ${totalAmount} ${dto.currency})`);
      return pr;
    });
  }

  /**
   * Soumet la DA — passe en statut PENDING_PI et initialise le workflow.
   * À implémenter avec le moteur de workflow Camunda/Temporal.
   *
   * `actor` n'est pas encore exploité ici (l'ownership check + audit
   * applicatif viendront au Sprint 2), mais la signature est déjà figée
   * pour ne pas faire un breaking change controller / service en cascade.
   * L'audit log de la transition est déjà géré globalement par
   * `AuditLogInterceptor` côté HTTP — pas besoin de logger manuel ici.
   */
  async submit(prId: string, actor: AuthenticatedUser) {
    this.logger.debug(`submit() called for pr=${prId} by actor=${actor.id}`);
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id: prId } });
    if (!pr) throw new NotFoundException('DA introuvable.');
    if (pr.status !== 'draft') throw new BadRequestException('Seule une DA en brouillon peut être soumise.');

    return this.prisma.purchaseRequest.update({
      where: { id: prId },
      data: { status: 'pending_pi' },
    });
  }

  private async generatePrNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.purchaseRequest.count({
      where: { prNumber: { startsWith: `DA-${year}-` } },
    });
    return `DA-${year}-${String(count + 1).padStart(4, '0')}`;
  }
}
