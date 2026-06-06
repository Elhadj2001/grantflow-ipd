import { Prisma } from '@prisma/client';
import type { ExchangeRate } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ExchangeRateService } from '../exchange-rate.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ExchangeRateNotFoundException,
  FixedRateExistsException,
  ForbiddenRoleException,
  ImmutableFixedRateException,
  SameCurrencyException,
  UnknownCurrencyException,
} from '../../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import type { CreateExchangeRateDto } from '../dto/create-exchange-rate.dto';

describe('ExchangeRateService', () => {
  let prisma: {
    exchangeRate: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let svc: ExchangeRateService;

  const fixedRow: ExchangeRate = {
    id: 'fff00000-1111-1111-1111-111111111111',
    fromCurrency: 'EUR',
    toCurrency: 'XOF',
    rate: new Prisma.Decimal('655.957'),
    rateDate: new Date('1999-01-04'),
    source: 'BCEAO_FIXED',
    isFixed: true,
  };

  const variableRow: ExchangeRate = {
    id: 'aaa00000-2222-2222-2222-222222222222',
    fromCurrency: 'USD',
    toCurrency: 'XOF',
    rate: new Prisma.Decimal('598.1'),
    rateDate: new Date('2026-05-14'),
    source: 'BCEAO_DAILY',
    isFixed: false,
  };

  const daf: AuthenticatedUser = { id: 'u1', email: 'daf@x', fullName: 'D AF', roles: ['DAF'] };
  const superAdmin: AuthenticatedUser = {
    id: 'u2', email: 'sa@x', fullName: 'S A', roles: ['SUPER_ADMIN'],
  };

  beforeEach(() => {
    prisma = {
      exchangeRate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    svc = new ExchangeRateService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('lookup — UEMOA fixed parity', () => {
    it('returns the fixed row regardless of the date parameter', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(fixedRow);
      const res = await svc.lookup({ from: 'EUR', to: 'XOF', date: '2026-05-14' });
      expect(res.rate.toString()).toBe('655.957');
      expect(res.isFixed).toBe(true);
      expect(res.isFallback).toBe(false);
      // Verifies we only checked the fixed shortcut, not the variable fallback.
      expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(1);
    });

    it('returns the fixed row even when date is BEFORE the parity declaration (1995)', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(fixedRow);
      const res = await svc.lookup({ from: 'EUR', to: 'XOF', date: '1995-01-01' });
      expect(res.rate.toString()).toBe('655.957');
    });

    it('falls back to variable lookup when no fixed row matches', async () => {
      prisma.exchangeRate.findFirst
        .mockResolvedValueOnce(null) // no fixed row
        .mockResolvedValueOnce(variableRow); // most recent variable
      const res = await svc.lookup({ from: 'USD', to: 'XOF', date: '2026-05-14' });
      expect(res.rate.toString()).toBe('598.1');
      expect(res.isFixed).toBe(false);
      expect(res.isFallback).toBe(false);
    });

    it('isFallback=true when the matched date is older than requested', async () => {
      prisma.exchangeRate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...variableRow, rateDate: new Date('2026-05-10') });
      const res = await svc.lookup({ from: 'USD', to: 'XOF', date: '2026-05-14' });
      expect(res.isFallback).toBe(true);
    });

    it('throws 404 when no rate found anywhere', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      await expect(svc.lookup({ from: 'USD', to: 'XOF', date: '2026-05-14' })).rejects.toBeInstanceOf(
        ExchangeRateNotFoundException,
      );
    });

    it('throws 400 SameCurrencyException when from === to', async () => {
      await expect(svc.lookup({ from: 'XOF', to: 'XOF' })).rejects.toBeInstanceOf(
        SameCurrencyException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('create — fixed parity guards', () => {
    function newRate(o: Partial<CreateExchangeRateDto> = {}): CreateExchangeRateDto {
      return {
        fromCurrency: 'USD',
        toCurrency: 'XOF',
        rate: 598.1,
        rateDate: '2026-05-14',
        isFixed: false,
        ...o,
      } as CreateExchangeRateDto;
    }

    it('rejects POST EUR→XOF (variable) when a fixed row exists — FIXED_RATE_EXISTS', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(fixedRow);
      await expect(
        svc.create(daf, newRate({ fromCurrency: 'EUR', toCurrency: 'XOF' })),
      ).rejects.toBeInstanceOf(FixedRateExistsException);
    });

    it('rejects POST isFixed=true when caller is not SUPER_ADMIN', async () => {
      await expect(svc.create(daf, newRate({ isFixed: true }))).rejects.toBeInstanceOf(
        ForbiddenRoleException,
      );
    });

    it('accepts POST isFixed=true from SUPER_ADMIN', async () => {
      prisma.exchangeRate.create.mockResolvedValue(fixedRow);
      const res = await svc.create(superAdmin, newRate({ isFixed: true }));
      expect(res).toEqual(fixedRow);
    });

    it('accepts POST USD→XOF (no fixed for that pair)', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      prisma.exchangeRate.create.mockResolvedValue(variableRow);
      const res = await svc.create(daf, newRate());
      expect(res).toEqual(variableRow);
    });

    it('rejects same currency', async () => {
      await expect(
        svc.create(daf, newRate({ fromCurrency: 'XOF', toCurrency: 'XOF' })),
      ).rejects.toBeInstanceOf(SameCurrencyException);
    });
  });

  // ------------------------------------------------------------------
  describe('update — immutability of fixed rates', () => {
    it('rejects PATCH on a fixed row from a DAF', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(fixedRow);
      await expect(svc.update(daf, fixedRow.id, { rate: 1 } as never)).rejects.toBeInstanceOf(
        ImmutableFixedRateException,
      );
    });

    it('accepts PATCH on a fixed row from SUPER_ADMIN', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(fixedRow);
      prisma.exchangeRate.update.mockResolvedValue({ ...fixedRow, source: 'BCEAO_CORRECTED' });
      const res = await svc.update(superAdmin, fixedRow.id, { source: 'BCEAO_CORRECTED' } as never);
      expect(res.source).toBe('BCEAO_CORRECTED');
    });

    it('accepts PATCH on a variable row from DAF', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(variableRow);
      prisma.exchangeRate.update.mockResolvedValue({ ...variableRow, rate: new Prisma.Decimal('600') });
      const res = await svc.update(daf, variableRow.id, { rate: 600 } as never);
      expect(res.rate.toString()).toBe('600');
    });
  });

  // ------------------------------------------------------------------
  describe('remove — immutability of fixed rates', () => {
    it('rejects DELETE on fixed row from DAF', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(fixedRow);
      await expect(svc.remove(daf, fixedRow.id)).rejects.toBeInstanceOf(
        ImmutableFixedRateException,
      );
    });

    it('accepts DELETE on fixed row from SUPER_ADMIN', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(fixedRow);
      prisma.exchangeRate.delete.mockResolvedValue(fixedRow);
      await expect(svc.remove(superAdmin, fixedRow.id)).resolves.toBeUndefined();
    });

    it('accepts DELETE on variable row from DAF', async () => {
      prisma.exchangeRate.findUnique.mockResolvedValue(variableRow);
      prisma.exchangeRate.delete.mockResolvedValue(variableRow);
      await expect(svc.remove(daf, variableRow.id)).resolves.toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere helper', () => {
    it('builds rateDate range from fromDate + toDate', () => {
      const w = ExchangeRateService.buildWhere({
        page: 1, pageSize: 20, fromDate: '2026-01-01', toDate: '2026-12-31',
      } as never);
      expect(w.rateDate).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-12-31') });
    });

    it('omits rateDate when neither bound is provided', () => {
      const w = ExchangeRateService.buildWhere({ page: 1, pageSize: 20 } as never);
      expect(w.rateDate).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Fix fix-approval-workflow-currency-conversion
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // convertToXof — Sprint S1 / US-007 (contrat figé)
  //
  // Bloc isolé utilisant `mockDeep<PrismaService>()` (jest-mock-extended) —
  // amorce de résorption du finding F2 : un mock profond auto-stube toute
  // méthode Prisma, on ne casse donc plus sur l'ajout d'un appel (ex. le
  // bug `findFirst is not a function`). beforeEach LOCAL pour ne pas polluer
  // les autres describe (qui gardent le mock littéral historique).
  //
  // Ce bloc REMPLACE l'ancien bloc convertToXof (mock littéral) — pas de
  // duplication : les cas sont déplacés ici et complétés (warn spy, Decimal).
  // ------------------------------------------------------------------
  describe('convertToXof — Sprint S1 (US-007)', () => {
    let prismaMock: DeepMockProxy<PrismaService>;
    let service: ExchangeRateService;

    beforeEach(() => {
      prismaMock = mockDeep<PrismaService>();
      service = new ExchangeRateService(prismaMock as unknown as PrismaService);
    });

    it('Test 1 — XOF passe-through, aucun appel BD', async () => {
      const result = await service.convertToXof(10000, 'XOF');
      expect(result).toEqual({
        xofAmount: 10000,
        fxRate: 1,
        fxRateDate: expect.any(Date),
        isIndicativeFallback: false,
      });
      expect(prismaMock.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it('Test 2 — EUR parité BCEAO exacte, aucun appel BD', async () => {
      const result = await service.convertToXof(100000, 'EUR');
      expect(result.xofAmount).toBe(65595700); // 100000 * 655.957
      expect(result.fxRate).toBe(655.957);
      expect(result.isIndicativeFallback).toBe(false);
      expect(prismaMock.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it('Test 3 — USD avec taux BD → utilise le taux + sa rate_date', async () => {
      prismaMock.exchangeRate.findFirst.mockResolvedValueOnce({
        id: 'x',
        fromCurrency: 'USD',
        toCurrency: 'XOF',
        rate: new Prisma.Decimal(605),
        rateDate: new Date('2026-06-01'),
        source: null,
        isFixed: false,
      } as ExchangeRate);
      const result = await service.convertToXof(100, 'USD', new Date('2026-06-10'));
      expect(result.xofAmount).toBe(60500);
      expect(result.fxRate).toBe(605);
      expect(result.isIndicativeFallback).toBe(false);
      expect(result.fxRateDate).toEqual(new Date('2026-06-01'));
    });

    it('Test 4 — USD sans taux BD → fallback indicatif (600) + warn loggé', async () => {
      prismaMock.exchangeRate.findFirst.mockResolvedValue(null);
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
      const result = await service.convertToXof(100, 'USD');
      expect(result.xofAmount).toBe(60000); // 100 * 600
      expect(result.fxRate).toBe(600);
      expect(result.isIndicativeFallback).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'fx_indicative_fallback_used', currency: 'USD' }),
        expect.stringContaining('CG must seed ref.exchange_rate'),
      );
    });

    it('Test 5 — devise inconnue → UnknownCurrencyException', async () => {
      prismaMock.exchangeRate.findFirst.mockResolvedValue(null);
      await expect(service.convertToXof(100, 'JPY')).rejects.toThrow(
        UnknownCurrencyException,
      );
    });

    it('Test 6 — Prisma.Decimal en entrée + précision (arrondi au franc)', async () => {
      const amount = new Prisma.Decimal('100.50');
      const result = await service.convertToXof(amount, 'EUR');
      // 100.50 * 655.957 = 65923.6785 → Math.round → 65924
      expect(result.xofAmount).toBe(65924);
      expect(result.fxRate).toBe(655.957);
    });

    it('Test 7 — GBP sans taux BD → fallback indicatif (800)', async () => {
      // Couverture d'une 2ᵉ devise fallback (valeur 800, distincte de l'USD).
      prismaMock.exchangeRate.findFirst.mockResolvedValue(null);
      const result = await service.convertToXof(100, 'GBP');
      expect(result.xofAmount).toBe(80000);
      expect(result.fxRate).toBe(800);
      expect(result.isIndicativeFallback).toBe(true);
    });
  });
});
