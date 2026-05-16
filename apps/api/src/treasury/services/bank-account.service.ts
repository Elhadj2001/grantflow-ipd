import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BankAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  BankAccountWrongClassException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../common/exceptions/business.exception';
import type { CreateBankAccountDto, UpdateBankAccountDto } from '../dto/bank-account.dto';

const ENTITY_NAME = 'BankAccount';
const PG_UNIQUE_VIOLATION = 'P2002';

/**
 * Référentiel des comptes bancaires IPD utilisés par les `PaymentRun` pour
 * décaisser. Chaque entrée référence un compte SYSCEBNL de classe 5
 * (banque/caisse) — la contrainte est vérifiée par le service car la FK
 * `gl_account` autorise toutes les classes.
 */
@Injectable()
export class BankAccountService {
  private readonly logger = new Logger(BankAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMany(): Promise<BankAccount[]> {
    return this.prisma.bankAccount.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async findOne(id: string): Promise<BankAccount> {
    const ba = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!ba) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return ba;
  }

  async create(dto: CreateBankAccountDto): Promise<BankAccount> {
    await this.assertGlAccountIsClass5(dto.glAccountCode);
    try {
      return await this.prisma.bankAccount.create({
        data: {
          code: dto.code,
          label: dto.label,
          accountNumber: dto.accountNumber,
          bic: dto.bic ?? null,
          bankName: dto.bankName,
          currency: dto.currency,
          glAccountCode: dto.glAccountCode,
        },
      });
    } catch (e) {
      this.handleWriteError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateBankAccountDto): Promise<BankAccount> {
    const existing = await this.findOne(id);
    if (dto.glAccountCode && dto.glAccountCode !== existing.glAccountCode) {
      await this.assertGlAccountIsClass5(dto.glAccountCode);
    }
    try {
      return await this.prisma.bankAccount.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          accountNumber: dto.accountNumber,
          bic: dto.bic,
          bankName: dto.bankName,
          currency: dto.currency,
          glAccountCode: dto.glAccountCode,
          updatedAt: new Date(),
        },
      });
    } catch (e) {
      this.handleWriteError(e, dto.code ?? existing.code);
    }
  }

  /** Soft delete : passe `is_active=false`. Préserve l'historique des runs. */
  async softDelete(id: string): Promise<BankAccount> {
    const ba = await this.findOne(id);
    if (!ba.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);
    return this.prisma.bankAccount.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() },
    });
  }

  async restore(id: string): Promise<BankAccount> {
    const ba = await this.findOne(id);
    if (ba.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.bankAccount.update({
      where: { id },
      data: { isActive: true, updatedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Vérifie que le compte GL est en classe 5 (banque/caisse). Sinon le
   * `PostingService.postPayment` ne pourra pas créer d'écriture BQ valide.
   */
  private async assertGlAccountIsClass5(glAccountCode: string): Promise<void> {
    const gl = await this.prisma.glAccount.findUnique({
      where: { code: glAccountCode },
      select: { code: true, class: true, isActive: true },
    });
    if (!gl) {
      throw new EntityNotFoundException('GlAccount', { code: glAccountCode });
    }
    if (gl.class !== '5') {
      throw new BankAccountWrongClassException(glAccountCode, gl.code, gl.class);
    }
  }

  private handleWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'bank account write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }
}
