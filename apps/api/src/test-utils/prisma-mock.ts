import { mockDeep, mockReset, type DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Type d'un PrismaService entièrement mocké en profondeur.
 * Chaque délégué (`prisma.purchaseRequest`, `prisma.journalEntry`, …) et
 * chaque méthode (`findFirst`, `findUnique`, `create`, …) est un `jest.Mock`
 * typé d'après le client Prisma réel.
 */
export type PrismaMock = DeepMockProxy<PrismaService>;

/**
 * Factory de `PrismaService` mocké via `mockDeep` (jest-mock-extended).
 *
 * Pourquoi ce helper plutôt qu'un objet littéral `{ x: { findFirst: jest.fn() } }` :
 *  - **auto-stube toute méthode** — y compris celles ajoutées par un refactor
 *    en aval (ex : `tx.journalEntry.findFirst` introduit par le passage
 *    `count() → findFirst()` des générateurs de numéro de séquence). C'est la
 *    cause racine du finding F2 (cf. docs/audit-codebase-2026-06-02.md) : les
 *    mocks littéraux ne stubaient pas `findFirst`, d'où ~28 tests rouges.
 *  - **typage Prisma préservé** (`DeepMockProxy<PrismaService>`).
 *  - **`$transaction` par défaut re-passe le mock comme `tx`**, ce qui rend
 *    fonctionnels les services qui font
 *    `prisma.$transaction(async (tx) => { await tx.xxx.findFirst(...) })`
 *    sans configuration spécifique par test. La forme tableau
 *    (`prisma.$transaction([op1, op2])`) est résolue via `Promise.all`.
 *
 * `mockDeep` renvoie `undefined` par défaut pour toute méthode non configurée :
 * ne re-stuber dans le `beforeEach` du spec que les retours dont les assertions
 * dépendent réellement.
 *
 * Usage standard dans un spec :
 * ```ts
 * import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
 *
 * let prisma: PrismaMock;
 * let svc: MyService;
 * beforeEach(() => {
 *   prisma = createPrismaMock();
 *   svc = new MyService(prisma);
 * });
 * ```
 */
export function createPrismaMock(): PrismaMock {
  const prisma = mockDeep<PrismaService>();
  // `$transaction` par défaut : forme callback → re-passe le mock comme `tx` ;
  // forme tableau → `Promise.all` des opérations.
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => unknown)(prisma);
    }
    return Promise.all(arg as readonly unknown[]);
  });
  return prisma;
}

/**
 * Réinitialise complètement un mock (efface implémentations + historique
 * d'appels). À appeler dans un `beforeEach`/`afterEach` si l'on souhaite
 * repartir d'un mock vierge. Note : recrée généralement le mock via
 * `createPrismaMock()` est préférable car `mockReset` efface aussi le stub
 * `$transaction` par défaut.
 */
export function resetPrismaMock(prisma: PrismaMock): void {
  mockReset(prisma);
}
