import { PrismaService } from '../src/prisma/prisma.service';
import { MeService } from '../src/me/me.service';

describe('MeService', () => {
  it('returns flattened active tenant memberships', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        role: 'HR_ADMIN',
        tenant: {
          id: 'de305d54-75b4-431b-adb2-eb6b9e546014',
          name: 'Example Organization',
          slug: 'example',
          timezone: 'Asia/Kolkata',
        },
      },
    ]);
    const prisma = {
      tenantMembership: { findMany },
    } as unknown as PrismaService;

    const result = await new MeService(prisma).listTenants('cognito-user-1');

    expect(result).toEqual([
      {
        id: 'de305d54-75b4-431b-adb2-eb6b9e546014',
        name: 'Example Organization',
        slug: 'example',
        timezone: 'Asia/Kolkata',
        role: 'HR_ADMIN',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cognitoSubject: 'cognito-user-1',
          active: true,
          tenant: { status: 'ACTIVE' },
        },
      }),
    );
  });
});
