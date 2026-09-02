import { Module } from '@nestjs/common';
import {
  COGNITO_ADMIN_CLIENT_FACTORY,
  createCognitoAdminClient,
} from '../tenant-users/cognito-admin';
import { ScimAdminController } from './scim-admin.controller';
import { ScimAdminService } from './scim-admin.service';
import { ScimAuthGuard } from './scim-auth.guard';
import { ScimAuthService } from './scim-auth.service';
import { ScimController } from './scim.controller';
import { ScimResponseInterceptor } from './scim-response.interceptor';
import { ScimService } from './scim.service';

@Module({
  controllers: [ScimController, ScimAdminController],
  providers: [
    ScimService,
    ScimAdminService,
    ScimAuthService,
    ScimAuthGuard,
    ScimResponseInterceptor,
    {
      provide: COGNITO_ADMIN_CLIENT_FACTORY,
      useValue: createCognitoAdminClient,
    },
  ],
})
export class ScimModule {}
