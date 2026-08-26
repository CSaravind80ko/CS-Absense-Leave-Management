import 'reflect-metadata';
import { ApplicationRole } from '@prisma/client';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { TenantUsersController } from '../src/tenant-users/tenant-users.controller';

describe('TenantUsersController authorization', () => {
  it('restricts every endpoint to tenant administrators', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, TenantUsersController),
    ).toEqual([ApplicationRole.TENANT_ADMIN]);
  });
});
