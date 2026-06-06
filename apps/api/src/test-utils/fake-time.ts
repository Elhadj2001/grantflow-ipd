/**
 * Outils de gel de l'horloge système pour les suites de tests temporelles.
 *
 * Finding F22 (cf. docs/audit-codebase-2026-06-02.md) : des specs encodent en
 * dur l'année (`DA-2026-XXXX`, `OD-2026-YYYY`, …) et/ou s'appuient sur
 * `new Date()` réel. Ces tests dérivent avec l'horloge réelle et casseraient
 * au changement d'année. On fige donc la date système à une valeur
 * déterministe pour rendre les tests indépendants du moment d'exécution
 * (générateurs de séquence `YYYY-NNNN`, échéances, horodatages par défaut).
 */

/**
 * Fige l'horloge système à une date déterministe pour la suite en cours.
 *
 * `doNotFake: ['nextTick', 'setImmediate']` évite de fausser les primitives
 * utilisées par certaines libs (BullMQ, drivers) et préserve la résolution
 * normale des promesses / files d'attente asynchrones.
 *
 * Usage standard dans un spec temporel :
 * ```ts
 * import { useFakeDate, restoreRealDate } from '../../test-utils/fake-time';
 *
 * describe('XService', () => {
 *   beforeAll(() => useFakeDate('2026-06-15'));
 *   afterAll(() => restoreRealDate());
 *   // ...
 * });
 * ```
 *
 * À appeler en `beforeAll` pour figer toute la suite ; ou en `beforeEach` si
 * la date doit avancer pendant les tests via `jest.setSystemTime` /
 * `jest.advanceTimersByTime`.
 *
 * @param isoDate date ISO à figer (défaut `'2026-06-15'`, dans la fenêtre des
 *   fixtures existantes pour ne pas invalider les attentes pré-existantes).
 */
export function useFakeDate(isoDate = '2026-06-15'): void {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(isoDate));
}

/**
 * Restaure l'horloge réelle. À appeler en `afterAll` des suites qui utilisent
 * {@link useFakeDate}.
 */
export function restoreRealDate(): void {
  jest.useRealTimers();
}
