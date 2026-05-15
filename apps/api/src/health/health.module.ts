import { Module, Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  /**
   * Liveness probe. Route exposée sans authentification :
   *  - Load-balancers / Kubernetes l'interrogent avant qu'un user soit auth.
   *  - Aucune donnée sensible n'est renvoyée — juste un status + timestamp.
   */
  @Get()
  @Public()
  check(): { status: string; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
