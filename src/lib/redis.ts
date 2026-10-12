import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    // Retry with backoff up to 10 seconds, but do not crash the process
    return Math.min(times * 200, 10000);
  },
});

redisConnection.on('error', (err) => {
  // Prevent unhandled error events from crashing node process
  if (process.env.NODE_ENV !== 'production') {
    // Keep it quiet in dev when redis isn't running locally
  } else {
    console.warn('[Redis] Connection error on default client:', err.message);
  }
});

// Dedicated duplicate connection factory for blocking BullMQ workers
export function createWorkerConnection(): Redis {
  const conn = redisConnection.duplicate({
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  conn.on('error', (err) => {
    console.warn('[Redis] Connection error on worker client:', err.message);
  });

  return conn;
}

export const checkQueue = new Queue('monitor-checks', { connection: redisConnection });
export const alertQueue = new Queue('alerts', { connection: redisConnection });
