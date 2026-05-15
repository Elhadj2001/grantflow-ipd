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
});
