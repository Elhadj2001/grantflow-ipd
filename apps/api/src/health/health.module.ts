import { Module, Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
