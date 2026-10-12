import { redisConnection } from './redis';

// In-memory fallback if Redis is unavailable or in serverless environments without Redis
const memoryStore = new Map<string, { timestamps: number[] }>();

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ success: boolean; limit: number; remaining: number; resetSeconds: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const clearBefore = now - windowMs;

  try {
    if (redisConnection && redisConnection.status === 'ready') {
      const redisKey = `ratelimit:${key}`;
      const multi = redisConnection.multi();
      multi.zremrangebyscore(redisKey, 0, clearBefore);
      multi.zadd(redisKey, now, `${now}-${Math.random()}`);
      multi.zcard(redisKey);
      multi.expire(redisKey, windowSeconds);

      const results = await multi.exec();
      const currentCount = (results?.[2]?.[1] as number) || 1;

      const remaining = Math.max(0, limit - currentCount);
      return {
        success: currentCount <= limit,
        limit,
        remaining,
        resetSeconds: windowSeconds,
      };
    }
  } catch (err) {
    // Redis failed or not ready; use in-memory fallback
    console.warn('[RateLimit] Redis unreachable, falling back to memoryStore:', (err as Error).message);
  }

  // Memory fallback
  const entry = memoryStore.get(key) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((ts) => ts > clearBefore);
  entry.timestamps.push(now);
  memoryStore.set(key, entry);

  const count = entry.timestamps.length;
  const remaining = Math.max(0, limit - count);

  return {
    success: count <= limit,
    limit,
    remaining,
    resetSeconds: windowSeconds,
  };
}
