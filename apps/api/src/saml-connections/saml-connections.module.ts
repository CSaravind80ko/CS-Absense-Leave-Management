import { Module } from '@nestjs/common';
import {
  COGNITO_ADMIN_CLIENT_FACTORY,
  createCognitoAdminClient,
} from '../tenant-users/cognito-admin';
import { SamlConnectionsController } from './saml-connections.controller';
import { SamlConnectionsService } from './saml-connections.service';
import {
  S3SamlMetadataStorage,
  SAML_METADATA_STORAGE,
  SamlMetadataFetcher,
  SamlMetadataValidator,
} from './saml-metadata';

@Module({
  controllers: [SamlConnectionsController],
  providers: [
    SamlConnectionsService,
    SamlMetadataFetcher,
    SamlMetadataValidator,
    S3SamlMetadataStorage,
    {
      provide: SAML_METADATA_STORAGE,
      useExisting: S3SamlMetadataStorage,
    },
    {
      provide: COGNITO_ADMIN_CLIENT_FACTORY,
      useValue: createCognitoAdminClient,
    },
  ],
})
export class SamlConnectionsModule {}
