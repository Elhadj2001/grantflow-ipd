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

  /**
   * Sprint F-INVOICE-SIM — feature flags exposés au frontend (publics,
   * non sensibles). Permet à l'UI de n'afficher le bouton "Simuler la
   * facture (démo)" que si le simulateur est activé côté serveur.
   *
   * On ne renvoie QUE des booléens de feature — aucune valeur de secret.
   */
  @Get('features')
  @Public()
  features(): { demoInvoiceSimulator: boolean } {
    return {
      demoInvoiceSimulator: process.env.ENABLE_DEMO_INVOICE_SIMULATOR === 'true',
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
