import { Prisma } from '@prisma/client';
import type { BankAccount } from '@prisma/client';
import { BankAccountService } from '../bank-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  BankAccountWrongClassException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type { CreateBankAccountDto } from '../../dto/bank-account.dto';

describe('BankAccountService', () => {
  let prisma: {
    bankAccount: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    glAccount: { findUnique: jest.Mock };
  };
  let svc: BankAccountService;

  const fakeBa: BankAccount = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'CBAO-XOF',
    label: 'Compte CBAO XOF Principal',
    accountNumber: 'SN012010100000123456789012',
    bic: 'CBAOSNDA',
    bankName: 'CBAO Sénégal',
    currency: 'XOF',
    glAccountCode: '521',
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };

  function dto(overrides: Partial<CreateBankAccountDto> = {}): CreateBankAccountDto {
    return {
      code: 'CBAO-XOF',
      label: 'Compte CBAO XOF Principal',
      accountNumber: 'SN012010100000123456789012',
      bic: 'CBAOSNDA',
      bankName: 'CBAO Sénégal',
      currency: 'XOF',
      glAccountCode: '521',
      ...overrides,
    } as CreateBankAccountDto;
  }

  beforeEach(() => {
    prisma = {
      bankAccount: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      glAccount: { findUnique: jest.fn() },
    };
    svc = new BankAccountService(prisma as unknown as PrismaService);
  });

  it('lists bank accounts sorted by isActive desc, code asc', async () => {
    prisma.bankAccount.findMany.mockResolvedValue([fakeBa]);
    const r = await svc.findMany();
    expect(r).toEqual([fakeBa]);
    const args = prisma.bankAccount.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isActive: 'desc' }, { code: 'asc' }]);
  });

  it('findOne returns the bank account', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
    const r = await svc.findOne(fakeBa.id);
    expect(r).toEqual(fakeBa);
  });

  it('findOne throws when missing', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue(null);
    await expect(svc.findOne('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  describe('create', () => {
    it('creates when glAccount is class 5', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ code: '521', class: '5', isActive: true });
      prisma.bankAccount.create.mockResolvedValue(fakeBa);
      const r = await svc.create(dto());
      expect(r).toEqual(fakeBa);
      expect(prisma.bankAccount.create).toHaveBeenCalled();
    });

    it('rejects glAccount not in class 5', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ code: '601', class: '6', isActive: true });
      await expect(svc.create(dto({ glAccountCode: '601' }))).rejects.toBeInstanceOf(
        BankAccountWrongClassException,
      );
    });

    it('rejects missing gl_account', async () => {
      prisma.glAccount.findUnique.mockResolvedValue(null);
      await expect(svc.create(dto({ glAccountCode: '999' }))).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('translates P2002 to DuplicateCodeException', async () => {
      prisma.glAccount.findUnique.mockResolvedValue({ code: '521', class: '5', isActive: true });
      const err = Object.assign(new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }), {});
      prisma.bankAccount.create.mockRejectedValue(err);
      await expect(svc.create(dto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  describe('update', () => {
    it('updates without revalidating class when glAccount unchanged', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
      prisma.bankAccount.update.mockResolvedValue({ ...fakeBa, label: 'updated' });
      const r = await svc.update(fakeBa.id, { label: 'updated' });
      expect(r.label).toBe('updated');
      expect(prisma.glAccount.findUnique).not.toHaveBeenCalled();
    });

    it('revalidates class when glAccount changes', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
      prisma.glAccount.findUnique.mockResolvedValue({ code: '522', class: '5', isActive: true });
      prisma.bankAccount.update.mockResolvedValue({ ...fakeBa, glAccountCode: '522' });
      await svc.update(fakeBa.id, { glAccountCode: '522' });
      expect(prisma.glAccount.findUnique).toHaveBeenCalledWith({
        where: { code: '522' },
        select: { code: true, class: true, isActive: true },
      });
    });

    it('rejects when new glAccount is wrong class', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
      prisma.glAccount.findUnique.mockResolvedValue({ code: '401', class: '4', isActive: true });
      await expect(svc.update(fakeBa.id, { glAccountCode: '401' })).rejects.toBeInstanceOf(
        BankAccountWrongClassException,
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft deletes an active bank account', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
      prisma.bankAccount.update.mockResolvedValue({ ...fakeBa, isActive: false });
      const r = await svc.softDelete(fakeBa.id);
      expect(r.isActive).toBe(false);
    });

    it('throws on double soft delete', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue({ ...fakeBa, isActive: false });
      await expect(svc.softDelete(fakeBa.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('restores an inactive bank account', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue({ ...fakeBa, isActive: false });
      prisma.bankAccount.update.mockResolvedValue({ ...fakeBa, isActive: true });
      const r = await svc.restore(fakeBa.id);
      expect(r.isActive).toBe(true);
    });

    it('rejects restore on already-active', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(fakeBa);
      await expect(svc.restore(fakeBa.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  it('wrong-class exception carries the BUSINESS code', async () => {
    prisma.glAccount.findUnique.mockResolvedValue({ code: '601', class: '6', isActive: true });
    try {
      await svc.create(dto({ glAccountCode: '601' }));
      fail('should have thrown');
    } catch (e) {
      expect((e as BankAccountWrongClassException).code).toBe(
        ErrorCode.BUSINESS.BANK_ACCOUNT_WRONG_CLASS,
      );
    }
  });
});
