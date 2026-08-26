import { configureDatabaseUrl } from '../src/config/database';

describe('configureDatabaseUrl', () => {
  it('preserves an explicitly configured URL', () => {
    const environment = { DATABASE_URL: 'postgresql://explicit/database' };
    expect(configureDatabaseUrl(environment)).toBe(environment.DATABASE_URL);
  });

  it('composes and encodes a URL from infrastructure values', () => {
    const environment = {
      DATABASE_HOST: 'database.internal',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'attendance data',
      DATABASE_USERNAME: 'api@service',
      DATABASE_PASSWORD: 'p@ss:/word',
    };

    expect(configureDatabaseUrl(environment)).toBe(
      'postgresql://api%40service:p%40ss%3A%2Fword@database.internal:5432/attendance%20data?schema=public',
    );
    expect(environment).toHaveProperty('DATABASE_URL');
  });

  it('rejects incomplete component configuration', () => {
    expect(() =>
      configureDatabaseUrl({ DATABASE_HOST: 'database.internal' }),
    ).toThrow('Database configuration is incomplete');
  });
});
