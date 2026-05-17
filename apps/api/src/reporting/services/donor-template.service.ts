import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DonorReportTemplate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DonorTemplateNotFoundException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../common/exceptions/business.exception';
import type { AddMappingsDto, CreateDonorTemplateDto } from '../dto/donor-template.dto';

const PG_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class DonorTemplateService {
  private readonly logger = new Logger(DonorTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMany() {
    return this.prisma.donorReportTemplate.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        donor: { select: { code: true, label: true } },
        _count: { select: { categories: true, mappings: true } },
      },
    });
  }

  async findOne(id: string) {
    const t = await this.prisma.donorReportTemplate.findUnique({
      where: { id },
      include: {
        donor: true,
        categories: { orderBy: { sortOrder: 'asc' } },
        mappings: { orderBy: { glAccountCode: 'asc' } },
      },
    });
    if (!t) throw new DonorTemplateNotFoundException(id);
    return t;
  }

  async create(dto: CreateDonorTemplateDto): Promise<DonorReportTemplate> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const template = await tx.donorReportTemplate.create({
          data: {
            code: dto.code,
            name: dto.name,
            donorId: dto.donorId ?? null,
            currency: dto.currency,
            format: dto.format as unknown as Prisma.InputJsonValue,
          },
        });
        if (dto.categories.length > 0) {
          // 1ʳᵉ passe : crée toutes les catégories sans parentId
          await tx.donorCategory.createMany({
            data: dto.categories.map((c) => ({
              templateId: template.id,
              code: c.code,
              label: c.label,
              sortOrder: c.sortOrder,
            })),
          });
          // 2ème passe : résout les parentCode → parentId
          const created = await tx.donorCategory.findMany({
            where: { templateId: template.id },
            select: { id: true, code: true },
          });
          const idByCode = new Map(created.map((c) => [c.code, c.id]));
          for (const c of dto.categories) {
            if (!c.parentCode) continue;
            const parentId = idByCode.get(c.parentCode);
            const selfId = idByCode.get(c.code);
            if (parentId && selfId) {
              await tx.donorCategory.update({
                where: { id: selfId },
                data: { parentId },
              });
            }
          }
        }
        this.logger.log(
          { templateId: template.id, code: template.code, categories: dto.categories.length },
          'donor template created',
        );
        return template;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateCodeException('DonorReportTemplate', dto.code);
      }
      throw e;
    }
  }

  async addMappings(templateId: string, dto: AddMappingsDto) {
    const template = await this.prisma.donorReportTemplate.findUnique({
      where: { id: templateId },
      include: { categories: { select: { id: true, code: true } } },
    });
    if (!template) throw new DonorTemplateNotFoundException(templateId);
    const categoryByCode = new Map(template.categories.map((c) => [c.code, c.id]));

    // Vérifie que tous les comptes existent (sinon FK violation cryptique)
    const wantedAccounts = Array.from(new Set(dto.mappings.map((m) => m.glAccountCode)));
    const existingAccounts = await this.prisma.glAccount.findMany({
      where: { code: { in: wantedAccounts } },
      select: { code: true },
    });
    const existingSet = new Set(existingAccounts.map((a) => a.code));
    const missingAccounts = wantedAccounts.filter((c) => !existingSet.has(c));
    if (missingAccounts.length > 0) {
      throw new EntityNotFoundException('GlAccount', { missing: missingAccounts });
    }
    // Vérifie que toutes les catégories existent
    const missingCategories = dto.mappings
      .map((m) => m.categoryCode)
      .filter((c) => !categoryByCode.has(c));
    if (missingCategories.length > 0) {
      throw new EntityNotFoundException('DonorCategory', { missing: missingCategories });
    }

    // upsert pour permettre la mise à jour d'un mapping existant (sign)
    const ops = dto.mappings.map((m) =>
      this.prisma.accountMapping.upsert({
        where: {
          templateId_glAccountCode: {
            templateId,
            glAccountCode: m.glAccountCode,
          },
        },
        create: {
          templateId,
          glAccountCode: m.glAccountCode,
          donorCategoryId: categoryByCode.get(m.categoryCode)!,
          sign: m.sign,
        },
        update: {
          donorCategoryId: categoryByCode.get(m.categoryCode)!,
          sign: m.sign,
        },
      }),
    );
    await this.prisma.$transaction(ops);
    this.logger.log(
      { templateId, added: dto.mappings.length },
      'donor template mappings upserted',
    );
    return this.findOne(templateId);
  }
}
