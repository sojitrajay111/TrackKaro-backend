import { Controller, Get } from '@nestjs/common';

import { Public } from '@/common/decorators/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get()
  root() {
    return {
      name: 'TrackKaro API',
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health')
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
