import { Logger } from '@nestjs/common';
import { EligibilityEngineService } from '../eligibility-engine.service';
import type { EligibilityContext } from '../eligibility-context';
import type { EligibilityRule } from '../rules/rule.interface';
import { OK, blocked, warning, type Verdict } from '../verdict';

const CTX = { pr: { id: 'pr-1', grantId: 'g-1' } } as unknown as EligibilityContext;

/** Construit une règle stub déterministe (avec délai optionnel pour le test parallèle). */
function stub(
  code: string,
  verdict: Verdict,
  severity: 'blocking' | 'warning' = 'blocking',
  delayMs = 0,
): EligibilityRule {
  return {
    code,
    severity,
    check: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return verdict;
    },
  };
}

describe('EligibilityEngineService.validate (US-048 orchestrator)', () => {
  it('Test 1 — toutes règles OK → ok=true, aucun blocked/warning', async () => {
    const rules = Array.from({ length: 7 }, (_, i) => stub(`R${i + 1}`, OK));
    const svc = new EligibilityEngineService(rules);
    const res = await svc.validate(CTX);
    expect(res.ok).toBe(true);
    expect(res.blockedVerdicts).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(Object.keys(res.verdictsByRule)).toHaveLength(7);
  });

  it('Test 2 — une règle blocking → ok=false, 1 blocked', async () => {
    const rules = [
      stub('B1', blocked('ELIG_B1', 'refus')),
      ...Array.from({ length: 6 }, (_, i) => stub(`R${i + 1}`, OK)),
    ];
    const res = await new EligibilityEngineService(rules).validate(CTX);
    expect(res.ok).toBe(false);
    expect(res.blockedVerdicts).toHaveLength(1);
    expect(res.blockedVerdicts[0].code).toBe('ELIG_B1');
    expect(res.warnings).toEqual([]);
  });

  it('Test 3 — 2 blocking + 1 warning + 4 ok → ok=false, 2 blocked, 1 warning, 7 codes', async () => {
    const rules = [
      stub('B1', blocked('ELIG_B1', 'refus 1')),
      stub('B2', blocked('ELIG_B2', 'refus 2')),
      stub('W1', warning('ELIG_W1', 'attention'), 'warning'),
      ...Array.from({ length: 4 }, (_, i) => stub(`R${i + 1}`, OK)),
    ];
    const res = await new EligibilityEngineService(rules).validate(CTX);
    expect(res.ok).toBe(false);
    expect(res.blockedVerdicts).toHaveLength(2);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].code).toBe('ELIG_W1');
    expect(Object.keys(res.verdictsByRule)).toHaveLength(7);
  });

  it('Test 4 — exécution parallèle (durée < somme des délais)', async () => {
    const rules = [stub('D1', OK, 'blocking', 60), stub('D2', OK, 'blocking', 60), stub('D3', OK, 'blocking', 60)];
    const svc = new EligibilityEngineService(rules);
    const start = Date.now();
    const res = await svc.validate(CTX);
    const elapsed = Date.now() - start;
    expect(res.ok).toBe(true);
    // Séquentiel = ~180ms ; parallèle ≈ 60ms. Marge généreuse.
    expect(elapsed).toBeLessThan(150);
  });

  it('Test 5 — log Pino structuré event=eligibility_validation émis', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await new EligibilityEngineService([stub('R1', OK)]).validate(CTX);
      expect(spy).toHaveBeenCalled();
      const payload = spy.mock.calls[0][0] as { event?: string; ok?: boolean; prId?: string };
      expect(payload.event).toBe('eligibility_validation');
      expect(payload.ok).toBe(true);
      expect(payload.prId).toBe('pr-1');
    } finally {
      spy.mockRestore();
    }
  });
});
