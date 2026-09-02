import 'reflect-metadata';
import { ApplicationRole } from '@prisma/client';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { SamlConnectionsController } from '../src/saml-connections/saml-connections.controller';

describe('SamlConnectionsController authorization', () => {
  it('restricts every SAML onboarding endpoint to tenant administrators', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, SamlConnectionsController),
    ).toEqual([ApplicationRole.TENANT_ADMIN]);
  });
});
