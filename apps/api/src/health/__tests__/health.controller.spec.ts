import { Reflector } from '@nestjs/core';
import { HealthController } from '../health.module';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';

describe('HealthController', () => {
  it('exposes /health as @Public — metadata IS_PUBLIC_KEY is set on the handler', () => {
    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, HealthController.prototype.check);
    expect(isPublic).toBe(true);
  });

  it('returns status=ok with an ISO timestamp', () => {
    const ctrl = new HealthController();
    const res = ctrl.check();
    expect(res.status).toBe('ok');
    expect(res.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // Sprint F-INVOICE-SIM — endpoint /health/features
  describe('features() flag', () => {
    const ORIGINAL = process.env.ENABLE_DEMO_INVOICE_SIMULATOR;
    afterEach(() => {
      process.env.ENABLE_DEMO_INVOICE_SIMULATOR = ORIGINAL;
    });

    it('exposes /health/features as @Public', () => {
      const reflector = new Reflector();
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        HealthController.prototype.features,
      );
      expect(isPublic).toBe(true);
    });

    it('demoInvoiceSimulator=true quand le flag vaut "true"', () => {
      process.env.ENABLE_DEMO_INVOICE_SIMULATOR = 'true';
      expect(new HealthController().features()).toEqual({ demoInvoiceSimulator: true });
    });

    it('demoInvoiceSimulator=false quand le flag est absent ou ≠ "true"', () => {
      delete process.env.ENABLE_DEMO_INVOICE_SIMULATOR;
      expect(new HealthController().features()).toEqual({ demoInvoiceSimulator: false });
      process.env.ENABLE_DEMO_INVOICE_SIMULATOR = 'false';
      expect(new HealthController().features()).toEqual({ demoInvoiceSimulator: false });
    });
  });
});
