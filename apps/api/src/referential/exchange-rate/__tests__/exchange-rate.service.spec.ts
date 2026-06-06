import { Prisma } from '@prisma/client';
import type { ExchangeRate } from '@prisma/client';
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
  describe('convertToXof — US-004 (source unique conversion XOF, ADR-005)', () => {
    it('XOF → no-op (fxRate=1, montant arrondi au franc entier, pas d\'appel BD)', async () => {
      const res = await svc.convertToXof(123_456.78, 'XOF');
      // Le XOF n'a pas de sous-unité → Math.round (123 456.78 → 123 457).
      expect(res.xofAmount).toBe(123_457);
      expect(res.fxRate).toBe(1);
      expect(res.fxRateDate).toBeInstanceOf(Date);
      expect(res.isIndicativeFallback).toBe(false);
      expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it('EUR → parité fixe BCEAO 655.957 (en dur, sans appel BD)', async () => {
      const res = await svc.convertToXof(100_000, 'EUR');
      expect(res.fxRate).toBe(655.957);
      // 100 000 EUR = 65 595 700 XOF (régression du bug approval-workflow
      // où 100k EUR sautait CG et DAF).
      expect(res.xofAmount).toBe(65_595_700);
      expect(res.fxRateDate).toBeInstanceOf(Date);
      expect(res.isIndicativeFallback).toBe(false);
      // EUR est traité en dur → aucun lookup BD.
      expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it('USD avec taux BD → utilise le taux + sa rate_date, isIndicativeFallback=false', async () => {
      // Pas de parité fixe USD/XOF → cherche un taux variable récent.
      prisma.exchangeRate.findFirst
        .mockResolvedValueOnce(null) // no fixed
        .mockResolvedValueOnce(variableRow); // variable 598.1, rateDate 2026-05-14
      const res = await svc.convertToXof(1000, 'USD');
      expect(res.fxRate).toBe(598.1);
      expect(res.xofAmount).toBe(598_100); // Math.round(1000 * 598.1)
      expect(res.fxRateDate).toEqual(variableRow.rateDate);
      expect(res.isIndicativeFallback).toBe(false);
    });

    it('USD sans taux BD → fallback indicatif FALLBACK_INDICATIVE_TO_XOF (600), flaggé', async () => {
      // Pas de fixed, pas de variable → lookup lève ; convertToXof retombe
      // sur le fallback indicatif.
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      const res = await svc.convertToXof(10_000, 'USD');
      expect(res.fxRate).toBe(600);
      expect(res.xofAmount).toBe(6_000_000);
      expect(res.fxRateDate).toBeInstanceOf(Date);
      expect(res.isIndicativeFallback).toBe(true);
    });

    it('GBP sans taux BD → fallback indicatif 800', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      const res = await svc.convertToXof(100, 'GBP');
      expect(res.fxRate).toBe(800);
      expect(res.xofAmount).toBe(80_000);
      expect(res.isIndicativeFallback).toBe(true);
    });

    it('devise inconnue (ni BD ni fallback) → UnknownCurrencyException', async () => {
      // JPY n'est pas dans FALLBACK_INDICATIVE_TO_XOF.
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      await expect(svc.convertToXof(100, 'JPY')).rejects.toBeInstanceOf(
        UnknownCurrencyException,
      );
    });
  });
});
