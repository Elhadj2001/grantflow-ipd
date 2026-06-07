import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateOverheadRuleDto } from './dto/create-overhead-rule.dto';
import type { UpdateOverheadRuleDto } from './dto/update-overhead-rule.dto';

/**
 * CRUD basique des règles d'overhead (grant_office.overhead_rule).
 * Référencées par note_technique.overheadRuleId (ADR-006).
 */
@Injectable()
export class OverheadRuleService {
  private readonly logger = new Logger(OverheadRuleService.name);

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.overheadRule.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const rule = await this.prisma.overheadRule.findFirst({ where: { id, deletedAt: null } });
    if (!rule) {
      throw new EntityNotFoundException('OverheadRule', { id });
    }
    return rule;
  }

  async create(actor: AuthenticatedUser, dto: CreateOverheadRuleDto) {
    const rule = await this.prisma.overheadRule.create({
      data: {
        name: dto.name,
        defaultRate: new Prisma.Decimal(dto.defaultRate),
        appliesToSubcontracting: dto.appliesToSubcontracting,
        appliesToEquipment: dto.appliesToEquipment,
        appliesToPersonnel: dto.appliesToPersonnel,
        appliesToMissions: dto.appliesToMissions,
        appliesToConsumables: dto.appliesToConsumables,
      },
    });
    this.logger.log({ event: 'overhead_rule_created', id: rule.id, name: rule.name, actorId: actor.id }, 'overhead rule created');
    return rule;
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateOverheadRuleDto) {
    await this.findById(id);
    const data: Prisma.OverheadRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.defaultRate !== undefined) data.defaultRate = new Prisma.Decimal(dto.defaultRate);
    if (dto.appliesToSubcontracting !== undefined) data.appliesToSubcontracting = dto.appliesToSubcontracting;
    if (dto.appliesToEquipment !== undefined) data.appliesToEquipment = dto.appliesToEquipment;
    if (dto.appliesToPersonnel !== undefined) data.appliesToPersonnel = dto.appliesToPersonnel;
    if (dto.appliesToMissions !== undefined) data.appliesToMissions = dto.appliesToMissions;
    if (dto.appliesToConsumables !== undefined) data.appliesToConsumables = dto.appliesToConsumables;
    const rule = await this.prisma.overheadRule.update({ where: { id }, data });
    this.logger.log({ event: 'overhead_rule_updated', id, actorId: actor.id }, 'overhead rule updated');
    return rule;
  }

  async softDelete(actor: AuthenticatedUser, id: string) {
    await this.findById(id);
    await this.prisma.overheadRule.update({ where: { id }, data: { deletedAt: new Date() } });
    this.logger.log({ event: 'overhead_rule_deleted', id, actorId: actor.id }, 'overhead rule soft-deleted');
  }
}
