import { ExpenseNatureService } from './expense-nature.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';

describe('ExpenseNatureService', () => {
  let prisma: PrismaMock;
  let svc: ExpenseNatureService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new ExpenseNatureService(prisma as unknown as PrismaService);
  });

  it('list() returns active natures (deletedAt null)', async () => {
    prisma.expenseNature.findMany.mockResolvedValue([{ code: 'OFFICE_SUPPLIES' }] as never);
    await expect(svc.list()).resolves.toHaveLength(1);
    expect(prisma.expenseNature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('findByCode() throws EntityNotFoundException when missing', async () => {
    prisma.expenseNature.findFirst.mockResolvedValue(null as never);
    await expect(svc.findByCode('NOPE')).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('findByCode() returns the nature when found', async () => {
    prisma.expenseNature.findFirst.mockResolvedValue({ code: 'OFFICE_SUPPLIES' } as never);
    await expect(svc.findByCode('OFFICE_SUPPLIES')).resolves.toMatchObject({ code: 'OFFICE_SUPPLIES' });
  });
});
