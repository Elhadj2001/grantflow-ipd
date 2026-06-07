import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';

/**
 * Catalogue typologique des natures de dépense (grant_office.expense_nature).
 *
 * Read-only : le catalogue est la source de vérité du seed (US-032), pas
 * modifiable via l'API. Les écrans front (paramétrage Note Technique,
 * eligibility) consomment `list()` pour proposer les natures.
 */
@Injectable()
export class ExpenseNatureService {
  private readonly logger = new Logger(ExpenseNatureService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Toutes les natures actives (soft delete exclu), triées par catégorie puis code. */
  list() {
    return this.prisma.expenseNature.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
  }

  /** Une nature par code, ou EntityNotFoundException. */
  async findByCode(code: string) {
    const nature = await this.prisma.expenseNature.findFirst({
      where: { code, deletedAt: null },
    });
    if (!nature) {
      throw new EntityNotFoundException('ExpenseNature', { code });
    }
    return nature;
  }
}
