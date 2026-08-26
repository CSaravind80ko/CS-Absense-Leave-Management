import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { LoginDiscoveryDto } from './dto/login-discovery.dto';
import { IdentityDiscoveryService } from './identity-discovery.service';

@Controller('identity')
export class IdentityDiscoveryController {
  constructor(private readonly discovery: IdentityDiscoveryService) {}

  @Public()
  @Post('discovery')
  @HttpCode(200)
  discover(@Body() input: LoginDiscoveryDto) {
    return this.discovery.discover(input.organization);
  }
}
