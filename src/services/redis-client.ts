import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  },
  lazyConnect: false,
});

redis.on('error', (err) => console.error('[redis]', err.message));
redis.on('connect', () => console.log('[redis] Connected'));

export async function cacheGet(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    console.warn(`[cache] Read failed for hash=${key.slice(0, 8)}`);
    return null;
  }
}

export async function cacheSet(key: string, entry: CacheEntry): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(entry));
  } catch (err) {
    console.warn(`[cache] Write failed for hash=${key.slice(0, 8)}:`, (err as Error).message);
  }
}

export function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < config.CACHE_TTL * 1000;
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function hashKey(query: string, variables?: Record<string, unknown>): string {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  const serializedVars = JSON.stringify(sortKeys(variables ?? {}));
  const input = `${normalizedQuery}|${serializedVars}`;
  return createHash('sha256').update(input).digest('hex');
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 1000)),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
