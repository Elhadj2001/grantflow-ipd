import type { SegregationOfDutiesService } from '../common/sod/segregation-of-duties.service';

/**
 * Mock no-op de la garde SoD (G1/F3) pour les specs de services qui
 * instancient directement leur service. `enforce` ne lève jamais par défaut —
 * neutre vis-à-vis des tests existants. Les specs SoD dédiés vérifient le vrai
 * service (segregation-of-duties.service.spec.ts).
 */
export function createSodMock(): jest.Mocked<SegregationOfDutiesService> {
  return { enforce: jest.fn() } as unknown as jest.Mocked<SegregationOfDutiesService>;
}
