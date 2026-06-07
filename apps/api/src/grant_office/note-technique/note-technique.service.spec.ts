import { ConflictException } from '@nestjs/common';
import { NoteTechniqueService } from './note-technique.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import type { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';

const actor = { id: 'u1', email: 'go@x', fullName: 'GO', roles: ['CONTROLEUR'] } as AuthenticatedUser;

describe('NoteTechniqueService', () => {
  let prisma: PrismaMock;
  let svc: NoteTechniqueService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new NoteTechniqueService(prisma as unknown as PrismaService);
  });

  it('list() returns empty', async () => {
    prisma.noteTechnique.findMany.mockResolvedValue([] as never);
    await expect(svc.list({})).resolves.toEqual([]);
  });

  it('findById() throws when missing', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(null as never);
    await expect(svc.findById('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('create() creates in draft + serializes BigInt XOF to number', async () => {
    prisma.appUser.findUnique.mockResolvedValue({ id: 'app-1' } as never);
    prisma.noteTechnique.create.mockResolvedValue({
      id: 'nt1',
      grantId: 'g1',
      status: 'draft',
      ownFundsContributionXof: BigInt(500000),
    } as never);
    const dto = {
      grantId: 'g1',
      budgetCode: 'BC-1',
      reportingFinalDate: new Date('2026-12-31'),
      reportingIntermediateDates: [],
      ownFundsContributionXof: 500000,
      singleActorAuthorized: false,
    } as unknown as CreateNoteTechniqueDto;
    const r = await svc.create(actor, dto);
    expect(r.status).toBe('draft');
    expect(r.ownFundsContributionXof).toBe(500000);
    expect(typeof r.ownFundsContributionXof).toBe('number');
  });

  it('update() rejects when status is not draft (ConflictException)', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue({ id: 'nt1', status: 'active' } as never);
    await expect(svc.update(actor, 'nt1', {} as unknown as UpdateNoteTechniqueDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
