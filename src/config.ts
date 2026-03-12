function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const val = Number(raw);
  if (Number.isNaN(val)) throw new Error(`Invalid ${key}: "${raw}" is not a number`);
  return val;
}

export const config = {
  PORT: 3000,
  GRAPHQL_ENDPOINT: process.env.GRAPHQL_ENDPOINT ?? 'https://www.dnd5eapi.co/graphql',
  REDIS_URL: 'redis://redis:6379',
  CACHE_TTL: envNumber('CACHE_TTL', 3600),
  UPSTREAM_TIMEOUT: envNumber('UPSTREAM_TIMEOUT', 30000),
  RATE_LIMIT_WINDOW: envNumber('RATE_LIMIT_WINDOW', 60000),
  RATE_LIMIT_MAX: envNumber('RATE_LIMIT_MAX', 60),
  MAX_SESSIONS: envNumber('MAX_SESSIONS', 100),
  SESSION_IDLE_TTL: envNumber('SESSION_IDLE_TTL', 1800000),
  MAX_RESPONSE_SIZE: envNumber('MAX_RESPONSE_SIZE', 102400),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  NODE_ENV: process.env.NODE_ENV ?? 'production',
} as const;
