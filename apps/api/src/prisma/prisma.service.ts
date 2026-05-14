import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'warn',  emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('✅ Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Soft delete utilitaire : marque `deleted_at = now()` au lieu d'un DELETE physique.
   * À utiliser uniquement sur les entités déclarées soft-deletable dans le schéma.
   */
  async softDelete<T extends { deletedAt: Date | null }>(
    model: { update: (args: { where: { id: string }; data: { deletedAt: Date } }) => Promise<T> },
    id: string,
  ): Promise<T> {
    return model.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
