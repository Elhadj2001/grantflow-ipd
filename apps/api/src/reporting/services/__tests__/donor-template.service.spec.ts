import { Prisma } from '@prisma/client';
import { DonorTemplateService } from '../donor-template.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DonorTemplateNotFoundException,
  DuplicateCodeException,
  EntityNotFoundException,
} from '../../../common/exceptions/business.exception';

describe('DonorTemplateService', () => {
  let prisma: {
    donorReportTemplate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    donorCategory: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    accountMapping: { upsert: jest.Mock; findMany: jest.Mock };
    glAccount: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: DonorTemplateService;

  const tplId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    prisma = {
      donorReportTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      donorCategory: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      accountMapping: { upsert: jest.fn(), findMany: jest.fn() },
      glAccount: { findMany: jest.fn() },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    svc = new DonorTemplateService(prisma as unknown as PrismaService);
  });

  describe('findOne', () => {
    it('returns template with categories + mappings', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue({ id: tplId, code: 'TPL' });
      const r = await svc.findOne(tplId);
      expect(r).toMatchObject({ id: tplId, code: 'TPL' });
    });

    it('throws DonorTemplateNotFoundException when missing', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(tplId)).rejects.toBeInstanceOf(DonorTemplateNotFoundException);
    });
  });

  describe('create', () => {
    it('creates template only when no categories', async () => {
      prisma.donorReportTemplate.create.mockResolvedValue({ id: tplId, code: 'NEW' });
      const r = await svc.create({
        code: 'NEW',
        name: 'New',
        currency: 'XOF',
        format: {},
        categories: [],
      } as never);
      expect(r.id).toBe(tplId);
      expect(prisma.donorCategory.createMany).not.toHaveBeenCalled();
    });

    it('creates template + categories + resolves parentCode → parentId', async () => {
      prisma.donorReportTemplate.create.mockResolvedValue({ id: tplId, code: 'NEW' });
      prisma.donorCategory.findMany.mockResolvedValue([
        { id: 'cat-1', code: 'PARENT' },
        { id: 'cat-2', code: 'CHILD' },
      ]);
      await svc.create({
        code: 'NEW',
        name: 'New',
        currency: 'XOF',
        format: {},
        categories: [
          { code: 'PARENT', label: 'Parent', sortOrder: 0 },
          { code: 'CHILD', label: 'Child', parentCode: 'PARENT', sortOrder: 1 },
        ],
      } as never);
      expect(prisma.donorCategory.createMany).toHaveBeenCalled();
      // CHILD should be updated to set parentId = cat-1
      expect(prisma.donorCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-2' },
        data: { parentId: 'cat-1' },
      });
    });

    it('translates P2002 to DuplicateCodeException', async () => {
      prisma.donorReportTemplate.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(
        svc.create({ code: 'DUP', name: 'X', currency: 'XOF', format: {}, categories: [] } as never),
      ).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  describe('addMappings', () => {
    it('throws DonorTemplateNotFoundException when template missing', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue(null);
      await expect(
        svc.addMappings(tplId, {
          mappings: [{ glAccountCode: '601', categoryCode: 'X', sign: 1 }],
        } as never),
      ).rejects.toBeInstanceOf(DonorTemplateNotFoundException);
    });

    it('throws EntityNotFoundException when gl_account missing', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue({
        id: tplId,
        categories: [{ id: 'cat-1', code: 'X' }],
      });
      prisma.glAccount.findMany.mockResolvedValue([]); // no account exists
      await expect(
        svc.addMappings(tplId, {
          mappings: [{ glAccountCode: '999', categoryCode: 'X', sign: 1 }],
        } as never),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('throws EntityNotFoundException when category code missing', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue({
        id: tplId,
        categories: [{ id: 'cat-1', code: 'X' }],
      });
      prisma.glAccount.findMany.mockResolvedValue([{ code: '601' }]);
      await expect(
        svc.addMappings(tplId, {
          mappings: [{ glAccountCode: '601', categoryCode: 'MISSING', sign: 1 }],
        } as never),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('upserts mappings and returns updated template', async () => {
      prisma.donorReportTemplate.findUnique
        .mockResolvedValueOnce({
          id: tplId,
          categories: [{ id: 'cat-1', code: 'X' }],
        })
        .mockResolvedValueOnce({
          id: tplId,
          code: 'TPL',
          categories: [{ id: 'cat-1', code: 'X' }],
          mappings: [
            { id: 'm-1', glAccountCode: '601', donorCategoryId: 'cat-1', sign: 1 },
          ],
        });
      prisma.glAccount.findMany.mockResolvedValue([{ code: '601' }]);
      prisma.accountMapping.upsert.mockResolvedValue({ id: 'm-1' });
      const r = await svc.addMappings(tplId, {
        mappings: [{ glAccountCode: '601', categoryCode: 'X', sign: 1 }],
      } as never);
      expect(r.code).toBe('TPL');
      expect(prisma.accountMapping.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
