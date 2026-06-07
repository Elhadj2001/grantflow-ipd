import { OverheadRuleService } from './overhead-rule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateOverheadRuleDto } from './dto/create-overhead-rule.dto';

const actor = { id: 'u1', email: 'daf@x', fullName: 'DAF', roles: ['DAF'] } as AuthenticatedUser;

describe('OverheadRuleService', () => {
  let prisma: PrismaMock;
  let svc: OverheadRuleService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new OverheadRuleService(prisma as unknown as PrismaService);
  });

  it('list() returns active rules', async () => {
    prisma.overheadRule.findMany.mockResolvedValue([] as never);
    await expect(svc.list()).resolves.toEqual([]);
  });

  it('findById() throws when missing', async () => {
    prisma.overheadRule.findFirst.mockResolvedValue(null as never);
    await expect(svc.findById('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('create() persists a rule', async () => {
    prisma.overheadRule.create.mockResolvedValue({ id: 'r1', name: 'GENERIC-DEFAULT' } as never);
    const dto = {
      name: 'GENERIC-DEFAULT',
      defaultRate: 0.1,
      appliesToSubcontracting: true,
      appliesToEquipment: true,
      appliesToPersonnel: true,
      appliesToMissions: true,
      appliesToConsumables: true,
    } as unknown as CreateOverheadRuleDto;
    await expect(svc.create(actor, dto)).resolves.toMatchObject({ id: 'r1' });
    expect(prisma.overheadRule.create).toHaveBeenCalledTimes(1);
  });
});
