import { NotImplementedException } from '@nestjs/common';
import { EligibilityEngineService } from '../eligibility-engine.service';
import type { EligibilityContext } from '../eligibility-context';

describe('EligibilityEngineService (US-040 placeholder)', () => {
  let svc: EligibilityEngineService;

  beforeEach(() => {
    svc = new EligibilityEngineService();
  });

  it('instancie sans erreur', () => {
    expect(svc).toBeInstanceOf(EligibilityEngineService);
  });

  it('validate() lève NotImplementedException (orchestration = US-048)', async () => {
    await expect(svc.validate({} as unknown as EligibilityContext)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
