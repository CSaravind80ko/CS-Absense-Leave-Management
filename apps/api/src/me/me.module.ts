import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { IdentityMembershipService } from '../auth/identity-membership.service';

@Module({
  controllers: [MeController],
  providers: [MeService, IdentityMembershipService],
})
export class MeModule {}
