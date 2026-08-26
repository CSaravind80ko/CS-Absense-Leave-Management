const DATABASE_COMPONENTS = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
] as const;

export function configureDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.DATABASE_URL) {
    return environment.DATABASE_URL;
  }

  const missing = DATABASE_COMPONENTS.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(
      `Database configuration is incomplete; missing ${missing.join(', ')}`,
    );
  }

  const host = environment.DATABASE_HOST as string;
  const port = environment.DATABASE_PORT as string;
  if (!/^\d+$/.test(port)) {
    throw new Error('DATABASE_PORT must be numeric');
  }

  const username = encodeURIComponent(environment.DATABASE_USERNAME as string);
  const password = encodeURIComponent(environment.DATABASE_PASSWORD as string);
  const database = encodeURIComponent(environment.DATABASE_NAME as string);
  const url = `postgresql://${username}:${password}@${host}:${port}/${database}?schema=public`;
  environment.DATABASE_URL = url;
  return url;
}
