import { Module } from '@nestjs/common';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

@Module({
  controllers: [TenantUsersController],
  providers: [TenantUsersService],
})
export class TenantUsersModule {}
