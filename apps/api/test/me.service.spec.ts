import { IdentityMembershipService } from '../src/auth/identity-membership.service';
import { MeService } from '../src/me/me.service';

describe('MeService', () => {
  it('returns tenants from verified external identity mappings', async () => {
    const list = jest.fn().mockResolvedValue([
      {
        active: true,
        role: 'HR_ADMIN',
        tenant: {
          id: 'de305d54-75b4-431b-adb2-eb6b9e546014',
          name: 'Example Organization',
          slug: 'example',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
        },
      },
    ]);
    const identities = { list } as unknown as IdentityMembershipService;

    const result = await new MeService(identities).listTenants(
      'connection-1',
      'provider-user-1',
    );

    expect(result).toEqual([
      {
        id: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        name: 'Example Organization',
        slug: 'example',
        timezone: 'Asia/Kolkata',
        role: 'HR_ADMIN',
      },
    ]);
    expect(list).toHaveBeenCalledWith('connection-1', 'provider-user-1');
  });
});
